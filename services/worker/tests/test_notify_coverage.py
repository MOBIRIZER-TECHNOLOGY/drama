"""The two push jobs keyed on an existing row: `send_push` for an admin-composed notification, and
`new_episode_alert` for a release.

Both are re-run by arq on a worker restart, so what matters as much as the send is what they refuse to do
twice: a notification already stamped `sent_at` is not delivered again, and an episode that is not published
raises nobody's phone. Expo and the database are faked; the audience queries are checked as rendered SQL,
following tests/test_notify.py.
"""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.models.catalog import PublishStatus

from worker.jobs import notify


class Rows:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class FakeSession:
    """Answers `get` from a row map and `scalars` from a queue, recording every statement."""

    def __init__(self, *, gets=(), scalars=()):
        self.statements: list = []
        self._gets = list(gets)
        self._scalars = list(scalars)
        self.commits = 0
        self.refreshed: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, model, key):
        return self._gets.pop(0) if self._gets else None

    async def scalars(self, stmt):
        self.statements.append(stmt)
        return Rows(self._scalars.pop(0) if self._scalars else [])

    async def refresh(self, obj, attrs=None):
        self.refreshed.append((obj, attrs))

    async def commit(self):
        self.commits += 1


def _deliveries(monkeypatch, *, delivered=None, failed=0):
    calls: list[dict] = []

    async def deliver(db, *, user_ids, channel, title, body, data=None):
        calls.append({"user_ids": list(user_ids), "channel": channel, "title": title, "body": body, "data": data})
        count = len(user_ids) if delivered is None else delivered
        return SimpleNamespace(delivered=count, failed=failed, dead_tokens=[])

    monkeypatch.setattr(notify.push, "deliver", deliver)
    return calls


def _notification(**kw):
    row = SimpleNamespace(
        id=uuid.uuid4(),
        title="Big news",
        body="Tap in",
        segment={"all": True},
        payload=None,
        sent_at=None,
        delivered=0,
        failed=0,
    )
    for k, v in kw.items():
        setattr(row, k, v)
    return row


def _series(sid, slug="love-again", translations=(), original_language="hi"):
    return SimpleNamespace(
        id=sid,
        slug=slug,
        status=PublishStatus.published,
        original_language=original_language,
        translations=list(translations),
    )


async def test_send_push_delivers_the_row_and_records_the_outcome_on_it(monkeypatch):
    uid = uuid.uuid4()
    row = _notification(payload={"channel": "promo", "route": "rewards"})
    db = FakeSession(gets=[row], scalars=[[uid]])
    monkeypatch.setattr(notify, "SessionLocal", lambda: db)
    calls = _deliveries(monkeypatch, delivered=1, failed=2)

    out = await notify.send_push({}, str(row.id))

    assert out == {"status": "sent", "delivered": 1, "failed": 2}
    assert calls[0]["user_ids"] == [uid]
    assert calls[0]["channel"] == "promo", "the channel comes from the payload the admin composed"
    assert calls[0]["title"] == "Big news" and calls[0]["body"] == "Tap in"
    # The id travels with the message so a tap can be attributed back to this notification.
    assert calls[0]["data"] == {"notification_id": str(row.id), "channel": "promo", "route": "rewards"}
    assert (row.delivered, row.failed) == (1, 2)
    assert row.sent_at is not None and row.sent_at.tzinfo is not None
    assert db.commits == 1


async def test_send_push_falls_back_to_the_announcement_channel_and_the_everyone_segment(monkeypatch):
    """A row composed with neither is the common case in the console, and must still reach the whole audience."""
    uid = uuid.uuid4()
    row = _notification(segment=None, payload=None)
    monkeypatch.setattr(notify, "SessionLocal", lambda: FakeSession(gets=[row], scalars=[[uid]]))
    calls = _deliveries(monkeypatch)

    out = await notify.send_push({}, str(row.id))

    assert out["status"] == "sent"
    assert calls[0]["channel"] == "announcement"
    assert calls[0]["data"] == {"notification_id": str(row.id)}
    assert calls[0]["user_ids"] == [uid], "an absent segment means everyone, resolved through the active query"


async def test_send_push_never_sends_the_same_notification_twice(monkeypatch):
    """arq re-runs a job cancelled by a worker restart; without this the audience gets the blast again."""
    row = _notification(sent_at=datetime.now(UTC), delivered=500)
    db = FakeSession(gets=[row])
    monkeypatch.setattr(notify, "SessionLocal", lambda: db)
    calls = _deliveries(monkeypatch)

    out = await notify.send_push({}, str(row.id))

    assert out == {"status": "already_sent", "notification_id": str(row.id)}
    assert calls == [] and db.commits == 0
    assert row.delivered == 500, "the earlier result is left intact"


async def test_send_push_on_a_deleted_notification_reports_it_rather_than_raising(monkeypatch):
    missing = uuid.uuid4()
    monkeypatch.setattr(notify, "SessionLocal", lambda: FakeSession())
    calls = _deliveries(monkeypatch)

    assert await notify.send_push({}, str(missing)) == {"status": "missing", "notification_id": str(missing)}
    assert calls == []


async def test_a_single_user_segment_resolves_without_the_idle_cutoff():
    """A test send to one person must arrive even if that person has not opened the app in months."""
    uid = uuid.uuid4()
    db = FakeSession()
    assert await notify._resolve_segment(db, {"user_id": str(uid)}) == [uid]
    assert db.statements == [], "no audience query is needed, so none is made"


async def test_a_new_episode_alert_reaches_favourites_and_recent_watchers_once_each(monkeypatch):
    sid = uuid.uuid4()
    shared, favouriter, watcher = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    episode = SimpleNamespace(id=uuid.uuid4(), series_id=sid, number=13, status=PublishStatus.published)
    series = _series(sid, translations=[SimpleNamespace(lang="en", title="Love Again")])
    db = FakeSession(gets=[episode, series], scalars=[[favouriter, shared], [watcher, shared]])
    monkeypatch.setattr(notify, "SessionLocal", lambda: db)
    calls = _deliveries(monkeypatch)

    out = await notify.new_episode_alert({}, str(episode.id))

    assert out == {"status": "sent", "delivered": 3, "audience": 3}
    assert sorted(map(str, calls[0]["user_ids"])) == sorted(map(str, {shared, favouriter, watcher}))
    assert calls[0]["channel"] == "new_episode"
    assert calls[0]["title"] == "Episode 13 is out"
    assert calls[0]["body"] == "The next episode of Love Again is ready to watch."
    assert calls[0]["data"] == {"series_id": str(sid), "slug": "love-again", "episode": 13}
    assert db.commits == 1


async def test_the_watcher_half_of_the_audience_is_bounded_by_the_idle_cutoff(monkeypatch):
    """Someone who watched this series once, two years ago, is churned; a favourite is a standing request."""
    sid = uuid.uuid4()
    episode = SimpleNamespace(id=uuid.uuid4(), series_id=sid, number=1, status=PublishStatus.published)
    db = FakeSession(gets=[episode, _series(sid)], scalars=[[], []])
    monkeypatch.setattr(notify, "SessionLocal", lambda: db)
    _deliveries(monkeypatch)

    await notify.new_episode_alert({}, str(episode.id))

    favourites_sql, watchers_sql = (str(s) for s in db.statements)
    assert "watch_progress.updated_at >=" in watchers_sql
    assert "DISTINCT" in watchers_sql, "one message per person, not one per episode they have progress on"
    assert "updated_at" not in favourites_sql


async def test_an_episode_still_in_review_alerts_nobody(monkeypatch):
    """The alert is enqueued by the publish job, but also re-run by arq: it must re-check the status itself."""
    episode = SimpleNamespace(id=uuid.uuid4(), series_id=uuid.uuid4(), number=2, status=PublishStatus.review)
    monkeypatch.setattr(notify, "SessionLocal", lambda: FakeSession(gets=[episode]))
    calls = _deliveries(monkeypatch)

    assert await notify.new_episode_alert({}, str(episode.id)) == {"status": "skipped"}
    assert calls == []


async def test_a_deleted_episode_or_series_alerts_nobody(monkeypatch):
    calls = _deliveries(monkeypatch)
    monkeypatch.setattr(notify, "SessionLocal", lambda: FakeSession(gets=[None]))
    assert await notify.new_episode_alert({}, str(uuid.uuid4())) == {"status": "skipped"}

    episode = SimpleNamespace(id=uuid.uuid4(), series_id=uuid.uuid4(), number=2, status=PublishStatus.published)
    monkeypatch.setattr(notify, "SessionLocal", lambda: FakeSession(gets=[episode, None]))
    assert await notify.new_episode_alert({}, str(episode.id)) == {"status": "skipped"}
    assert calls == []


async def test_a_series_nobody_follows_is_not_announced(monkeypatch):
    """Not an error: most catalogue back-fill publishes episodes of series with no audience yet."""
    sid = uuid.uuid4()
    episode = SimpleNamespace(id=uuid.uuid4(), series_id=sid, number=1, status=PublishStatus.published)
    db = FakeSession(gets=[episode, _series(sid)], scalars=[[], []])
    monkeypatch.setattr(notify, "SessionLocal", lambda: db)
    calls = _deliveries(monkeypatch)

    assert await notify.new_episode_alert({}, str(episode.id)) == {"status": "no_audience"}
    assert calls == [] and db.commits == 0


def test_the_title_falls_back_through_the_original_language_to_the_slug():
    """A series with no English row still needs a name in the message; a slug beats an empty string."""
    hindi = SimpleNamespace(lang="hi", title="Phir Se Pyaar")
    english = SimpleNamespace(lang="en", title="Love Again")
    sid = uuid.uuid4()

    assert notify._title_for(_series(sid, translations=[hindi, english])) == "Love Again"
    assert notify._title_for(_series(sid, translations=[hindi])) == "Phir Se Pyaar"
    assert notify._title_for(_series(sid, translations=[])) == "love-again"
    # An explicit language wins over both fallbacks.
    assert notify._title_for(_series(sid, translations=[hindi, english]), lang="hi") == "Phir Se Pyaar"


async def test_notified_sets_are_per_job_and_per_day():
    """The streak run and the resume run must not read each other's set, or the second would skip everyone."""
    day = datetime(2026, 3, 4, tzinfo=UTC).date()
    assert notify._notified_key("streak", day) == "notify:streak:2026-03-04"
    assert notify._notified_key("resume", day) != notify._notified_key("streak", day)


async def test_without_redis_nothing_is_remembered_and_nothing_is_skipped():
    """Tests and a Redis-less run still deliver; the de-duplication degrades, the send does not."""
    assert await notify._already_notified(None, "streak", datetime.now(UTC).date()) == set()
    await notify._record_notified(None, "streak", datetime.now(UTC).date(), [uuid.uuid4()])


async def test_recording_nobody_leaves_redis_untouched():
    """An empty `sadd` is an error in Redis, so an empty batch must not reach it."""

    class Boom:
        async def sadd(self, *a):
            raise AssertionError("sadd called with no members")

        async def expire(self, *a):
            raise AssertionError("expire called")

    await notify._record_notified(Boom(), "streak", datetime.now(UTC).date(), [])


async def test_the_streak_audience_is_only_yesterday_s_checkins(monkeypatch):
    """A check-in from today means the streak is already safe; one from two days ago means it is already lost."""
    tz_now = datetime.now(UTC)
    today_user, yesterday_user, old_user = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    rows = [
        (today_user, tz_now),
        (yesterday_user, tz_now - timedelta(days=1)),
        (old_user, tz_now - timedelta(days=2)),
    ]

    class ExecSession(FakeSession):
        async def execute(self, stmt):
            self.statements.append(stmt)
            return Rows(rows)

    monkeypatch.setattr(notify, "SessionLocal", lambda: ExecSession())
    calls = _deliveries(monkeypatch)

    out = await notify.streak_reminder({})

    assert out["audience"] == 1
    assert calls[0]["user_ids"] == [yesterday_user]
    assert calls[0]["channel"] == "streak"
    assert calls[0]["title"] == "Your streak ends tonight"
    assert calls[0]["data"] == {"route": "rewards"}


async def test_a_resume_reminder_with_nothing_abandoned_sends_nothing(monkeypatch):
    """The window is deliberately narrow - started between one and three days ago and never finished - so an
    empty evening is normal and must cost one query and no delivery."""

    class ExecSession(FakeSession):
        async def execute(self, stmt):
            self.statements.append(stmt)
            return Rows([])

    db = ExecSession()
    monkeypatch.setattr(notify, "SessionLocal", lambda: db)
    calls = _deliveries(monkeypatch)

    assert await notify.resume_reminder({}) == {"status": "no_audience"}
    assert calls == [] and db.commits == 0

    sql = str(db.statements[0])
    assert "watch_progress.completed_at IS NULL" in sql
    assert sql.count("watch_progress.updated_at") >= 2, "both ends of the window are bounded"
