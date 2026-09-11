"""Drip release and the IndexNow ping, with the database and the search engines faked.

Two things decide whether a scheduled episode actually reaches anyone: the query that picks it up (the status
and time bounds, and the row lock that stops two workers publishing the same episode twice) and the alert the
job hands to the queue afterwards. Both are asserted here. IndexNow is faked at the HTTP layer because the
payload it posts - host, key location, absolute URLs - is the entire job.
"""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
from sqlalchemy.dialects import postgresql

from worker.jobs import publish


class Rows:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class FakeSession:
    """Answers the one `scalars` the publish job makes, and records the statement it was given."""

    def __init__(self, rows):
        self.rows = rows
        self.statements: list = []
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def scalars(self, stmt):
        self.statements.append(stmt)
        return Rows(self.rows)

    async def commit(self):
        self.commits += 1


class FakeRedis:
    def __init__(self):
        self.jobs: list[tuple] = []

    async def enqueue_job(self, name, *args, **kwargs):
        self.jobs.append((name, args, kwargs))
        return SimpleNamespace(job_id="job")


def _episode(published_at=None):
    return SimpleNamespace(id=uuid.uuid4(), status=publish.PublishStatus.review, published_at=published_at)


async def test_a_due_episode_is_published_and_its_watchers_are_told(monkeypatch):
    ep = _episode()
    db = FakeSession([ep])
    redis = FakeRedis()
    monkeypatch.setattr(publish, "SessionLocal", lambda: db)

    out = await publish.publish_scheduled({"redis": redis})

    assert out == {"published": 1}
    assert ep.status == publish.PublishStatus.published
    assert ep.published_at is not None and ep.published_at.tzinfo is not None
    assert db.commits == 1
    # The push is queued, not sent inline: an Expo outage must not stop the release.
    assert redis.jobs == [("new_episode_alert", (str(ep.id),), {})]


async def test_the_scan_takes_only_reviewed_episodes_whose_time_has_come_and_locks_them(monkeypatch):
    """`skip_locked` is what keeps two workers running the same minute from publishing an episode twice."""
    db = FakeSession([])
    monkeypatch.setattr(publish, "SessionLocal", lambda: db)

    assert await publish.publish_scheduled({}) == {"published": 0}

    # Rendered for Postgres: SKIP LOCKED is dialect-specific and the default dialect drops it silently.
    sql = str(db.statements[0].compile(dialect=postgresql.dialect()))
    assert "episodes.status = " in sql
    assert "episodes.scheduled_at IS NOT NULL" in sql and "episodes.scheduled_at <= " in sql
    assert "FOR UPDATE SKIP LOCKED" in sql


async def test_an_episode_that_was_published_before_keeps_its_original_date(monkeypatch):
    """`published_at` is what the catalogue sorts and dates by; a re-run must not move it to today."""
    first = datetime(2024, 1, 1, tzinfo=UTC)
    ep = _episode(published_at=first)
    monkeypatch.setattr(publish, "SessionLocal", lambda: FakeSession([ep]))

    await publish.publish_scheduled({"redis": FakeRedis()})

    assert ep.published_at == first


async def test_publishing_still_happens_when_there_is_no_queue_to_alert_on(monkeypatch):
    """The release is the database write; the notification is a bonus and never a precondition."""
    ep = _episode()
    db = FakeSession([ep])
    monkeypatch.setattr(publish, "SessionLocal", lambda: db)

    assert await publish.publish_scheduled({}) == {"published": 1}
    assert ep.status == publish.PublishStatus.published and db.commits == 1


async def test_nothing_is_enqueued_when_nothing_was_due(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(publish, "SessionLocal", lambda: FakeSession([]))
    assert await publish.publish_scheduled({"redis": redis}) == {"published": 0}
    assert redis.jobs == []


def _indexnow_settings(key="abc123", base="https://katha.example/"):
    return SimpleNamespace(indexnow_key=key, site_base_url=base)


def _mock_indexnow(monkeypatch, response: httpx.Response):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return response

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        publish.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw)
    )
    return requests


async def test_indexnow_posts_absolute_urls_with_the_key_and_its_location(monkeypatch):
    monkeypatch.setattr(publish, "get_settings", _indexnow_settings)
    requests = _mock_indexnow(monkeypatch, httpx.Response(200, text="ok"))

    out = await publish.indexnow_ping({}, ["/series/love-again", "series/second"])

    assert out == {"status": 200, "urls": 2}
    (request,) = requests
    assert str(request.url) == "https://api.indexnow.org/indexnow"
    payload = httpx.Response(200, content=request.content).json()
    # The base URL's trailing slash and the paths' leading ones must not produce "//" in the middle.
    assert payload["urlList"] == ["https://katha.example/series/love-again", "https://katha.example/series/second"]
    assert payload["host"] == "katha.example"
    assert payload["key"] == "abc123"
    assert payload["keyLocation"] == "https://katha.example/abc123.txt"


async def test_indexnow_reports_whatever_status_the_engine_answered(monkeypatch):
    """422 means the key file did not verify. Reporting it as success would hide a search listing that stopped
    updating, so the status is passed through rather than raised on or flattened to ok."""
    monkeypatch.setattr(publish, "get_settings", _indexnow_settings)
    _mock_indexnow(monkeypatch, httpx.Response(422, text="key mismatch"))

    assert await publish.indexnow_ping({}, ["/a"]) == {"status": 422, "urls": 1}


async def test_indexnow_is_skipped_without_a_key_or_a_site_url(monkeypatch):
    """No key means no verifiable ping; posting anyway would only spend a request to be refused."""
    requests = _mock_indexnow(monkeypatch, httpx.Response(200))

    monkeypatch.setattr(publish, "get_settings", lambda: _indexnow_settings(key=None))
    assert await publish.indexnow_ping({}, ["/a"]) == {"status": "skipped"}

    monkeypatch.setattr(publish, "get_settings", lambda: _indexnow_settings(base=""))
    assert await publish.indexnow_ping({}, ["/a"]) == {"status": "skipped"}

    assert requests == []


async def test_the_publish_cutoff_moves_with_the_clock(monkeypatch):
    """The bound is `now` at call time, not import time: a worker that has been up for days must still see
    an episode scheduled a minute ago."""
    db = FakeSession([])
    monkeypatch.setattr(publish, "SessionLocal", lambda: db)
    before = datetime.now(UTC)
    await publish.publish_scheduled({})
    after = datetime.now(UTC)

    bound = next(v for v in db.statements[0].compile().params.values() if isinstance(v, datetime))
    assert before - timedelta(seconds=1) <= bound <= after + timedelta(seconds=1)
