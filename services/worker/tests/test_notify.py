"""Audience resolution and the daily reminders, with the database and Expo faked.

The SQL is checked by rendering the statement the job hands the session: cheap, and it pins exactly the
clauses these fixes added (the idle cutoff on locale segments, the date bound on the check-in scan).
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
    """Records every statement; answers `execute` and `scalars` from what the test queued up."""

    def __init__(self, *, execute=(), scalars=()):
        self.statements: list = []
        self._execute = list(execute)
        self._scalars = list(scalars)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, stmt):
        self.statements.append(stmt)
        return Rows(self._execute.pop(0) if self._execute else [])

    async def scalars(self, stmt):
        self.statements.append(stmt)
        return Rows(self._scalars.pop(0) if self._scalars else [])

    async def refresh(self, obj, attrs=None):
        pass

    async def commit(self):
        pass


class FakeRedis:
    def __init__(self):
        self.sets: dict[str, set[str]] = {}
        self.ttl: dict[str, int] = {}

    async def smembers(self, key):
        return {m.encode() for m in self.sets.get(key, set())}

    async def sadd(self, key, *members):
        self.sets.setdefault(key, set()).update(members)

    async def expire(self, key, seconds):
        self.ttl[key] = seconds


def _series(sid, slug, status=PublishStatus.published):
    return SimpleNamespace(id=sid, status=status, slug=slug, original_language="hi", translations=[])


def _deliveries(monkeypatch):
    calls: list[dict] = []

    async def deliver(db, *, user_ids, channel, title, body, data=None):
        calls.append({"user_ids": list(user_ids), "channel": channel, "data": data})
        return SimpleNamespace(delivered=len(user_ids), failed=0, dead_tokens=[])

    monkeypatch.setattr(notify.push, "deliver", deliver)
    return calls


async def test_a_locale_segment_applies_the_same_idle_cutoff_as_everyone():
    db = FakeSession()
    await notify._resolve_segment(db, {"locale": "hi"})
    sql = str(db.statements[0])
    assert "users.locale =" in sql
    assert "users.last_seen_at >=" in sql and "users.last_seen_at IS NOT NULL" in sql


async def test_all_and_locale_resolve_to_ids_and_unknown_to_nobody():
    uid = uuid.uuid4()
    db = FakeSession(scalars=[[uid]])
    assert await notify._resolve_segment(db, {"all": True}) == [uid]
    assert await notify._resolve_segment(FakeSession(), {"tier": "vip"}) == []


async def test_the_streak_scan_is_bounded_to_yesterday(monkeypatch):
    db = FakeSession(execute=[[]])
    monkeypatch.setattr(notify, "SessionLocal", lambda: db)
    out = await notify.streak_reminder({})
    assert out["status"] == "no_audience"
    sql = str(db.statements[0])
    assert "coin_ledger.created_at >=" in sql


async def test_the_streak_reminder_skips_anyone_already_reached_today(monkeypatch):
    u1, u2 = uuid.uuid4(), uuid.uuid4()
    yesterday = datetime.now(UTC) - timedelta(days=1)
    redis = FakeRedis()
    calls = _deliveries(monkeypatch)
    monkeypatch.setattr(notify, "SessionLocal", lambda: FakeSession(execute=[[(u1, yesterday), (u2, yesterday)]]))

    first = await notify.streak_reminder({"redis": redis})
    assert first["audience"] == 2 and calls[0]["user_ids"] == [u1, u2]

    monkeypatch.setattr(notify, "SessionLocal", lambda: FakeSession(execute=[[(u1, yesterday), (u2, yesterday)]]))
    second = await notify.streak_reminder({"redis": redis})
    assert second == {"status": "no_audience", "skipped": 2}
    assert len(calls) == 1
    assert all(ttl == int(notify.NOTIFIED_TTL.total_seconds()) for ttl in redis.ttl.values())


async def test_resume_reminders_go_out_once_per_series_with_every_viewer(monkeypatch):
    """Three viewers, two series: two deliveries, not three."""
    s1, s2 = uuid.uuid4(), uuid.uuid4()
    u1, u2, u3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    when = datetime.now(UTC) - timedelta(days=2)
    series = [_series(s1, "one"), _series(s2, "two")]
    calls = _deliveries(monkeypatch)
    monkeypatch.setattr(
        notify,
        "SessionLocal",
        lambda: FakeSession(execute=[[(u1, s1, when), (u2, s1, when), (u3, s2, when)]], scalars=[series]),
    )

    out = await notify.resume_reminder({})
    assert out["audience"] == 3 and out["delivered"] == 3
    by_series = {c["data"]["series_id"]: sorted(map(str, c["user_ids"])) for c in calls}
    assert by_series == {str(s1): sorted(map(str, [u1, u2])), str(s2): [str(u3)]}


async def test_resume_reminders_are_not_repeated_after_a_cancelled_run(monkeypatch):
    s1, u1 = uuid.uuid4(), uuid.uuid4()
    when = datetime.now(UTC) - timedelta(days=2)
    redis = FakeRedis()
    calls = _deliveries(monkeypatch)
    series = [_series(s1, "one")]

    def session():
        return FakeSession(execute=[[(u1, s1, when)]], scalars=[list(series)])

    monkeypatch.setattr(notify, "SessionLocal", session)
    assert (await notify.resume_reminder({"redis": redis}))["audience"] == 1
    assert (await notify.resume_reminder({"redis": redis}))["status"] == "no_audience"
    assert len(calls) == 1


async def test_an_unpublished_series_is_not_reminded_about(monkeypatch):
    s1, u1 = uuid.uuid4(), uuid.uuid4()
    when = datetime.now(UTC) - timedelta(days=2)
    calls = _deliveries(monkeypatch)
    series = [_series(s1, "one", status=PublishStatus.draft)]
    monkeypatch.setattr(notify, "SessionLocal", lambda: FakeSession(execute=[[(u1, s1, when)]], scalars=[series]))
    out = await notify.resume_reminder({})
    assert out["audience"] == 0 and calls == []
