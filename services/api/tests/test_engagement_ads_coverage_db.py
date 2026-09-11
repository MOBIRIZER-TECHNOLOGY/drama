"""Engagement, ads, playback grants, push and remote config — the paths a client actually walks.

These modules are the ones a viewer touches on every session and the ones an operator touches with money in
hand, and between them they had the thinnest coverage in the service: the rewarded-ad callback (the only place
in the product where an external party can create a row), the manifest routes (the only thing standing between
a paid episode and anyone holding a URL), and the engagement endpoints that decide what My List shows.

What is pinned here, and why each one is worth a request rather than a type check:

* the SSV callback refuses a callback signed for *another publisher's* ad unit. Google signs every SSV callback
  for every app that uses it, so a valid signature alone only proves someone, somewhere, watched an ad; the
  unit has to be one an operator configured here. It also reads values only from the signed prefix, so a
  parameter appended after `key_id` — which the framework happily parses — is never acted on.
* a client event batch is lossy on purpose: an unknown event name is dropped and a bad numeric prop is dropped,
  and neither takes the rest of the batch with it. Clients ship on their own schedule and a strict endpoint
  here means a single stale build stops reporting entirely.
* a playback URL exists in exactly one response — the play grant, minted after the access check. The episode
  list deliberately carries none, and the manifest routes refuse anything without a valid signature.
* push never reaches a real device from a test: the HTTP boundary is faked, and what is asserted is who was
  eligible, what was sent, and that a dead token is cleared from the session row.
* config resolution: saved values win, missing ones fall back to the deployment defaults, and the ads block is
  filtered by platform server-side.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import base64
import os
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import deps
from app.api.routers import engagement as engagement_router
from app.api.routers import stream as stream_router
from app.core.config import get_settings
from app.core.db import get_session
from app.main import app
from app.models.catalog import AssetStatus, Episode, PublishStatus, Series, SeriesTranslation, VideoAsset
from app.models.engagement import AnalyticsEvent, ContactMessage, Favorite, Like, Report, WatchProgress
from app.models.identity import AdminRole, AdminUser, Platform, Session, User, UserStatus
from app.models.ops import AdPlacement, AuditLog, Experiment, ExperimentAssignment, Setting
from app.models.wallet import AdEvent, CoinLedger, CoinPack, LedgerKind, PackKind, Purchase, PurchaseStatus
from app.services import admob_ssv, push
from app.services import config as config_svc
from app.services import engagement as eng
from app.services.media import content_key, sign_path

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")


# --------------------------------------------------------------------------------------------------
# Fixtures: one viewer, one published series with a free and a paid episode, one encrypted asset.
# --------------------------------------------------------------------------------------------------


@dataclass
class World:
    maker: async_sessionmaker
    user: User
    session_row: Session
    admin: AdminUser
    series: Series
    free_ep: Episode
    paid_ep: Episode
    asset: VideoAsset
    archived: Series


def _user(**kw) -> User:
    return User(
        public_id=uuid.uuid4().hex[:12],
        referral_code=uuid.uuid4().hex[:8].upper(),
        display_name="Test Viewer",
        **kw,
    )


def _session_row(user_id: uuid.UUID, **kw) -> Session:
    defaults = dict(
        user_id=user_id,
        platform=Platform.android,
        refresh_token_hash=uuid.uuid4().hex,
        expires_at=datetime.now(UTC) + timedelta(days=30),
    )
    defaults.update(kw)
    return Session(**defaults)


@pytest.fixture
async def world():
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        user = _user(coin_balance=500)
        admin = AdminUser(
            email=f"{uuid.uuid4().hex[:10]}@katha-test.dev",
            display_name="Ads Owner",
            password_hash="x",
            role=AdminRole.owner,
            is_active=True,
        )
        s.add_all([user, admin])
        await s.flush()

        sess = _session_row(user.id)
        asset = VideoAsset(
            source_key=f"uploads/{uuid.uuid4().hex[:8]}.mp4",
            status=AssetStatus.ready,
            hls_master_key=f"library/cov-{uuid.uuid4().hex[:8]}/hls/S01E01/master.m3u8",
            is_encrypted=True,
        )
        # free_episodes=1, so episode 1 is the hook and episode 2 is behind the paywall.
        series = Series(
            slug=f"cov-{uuid.uuid4().hex[:10]}",
            status=PublishStatus.published,
            free_episodes=1,
            cover_url="library/cov/cover.jpg",
            # Rated for a general audience: an unrated title is treated as adult and would age-gate playback.
            content_rating="U",
            released_at=datetime.now(UTC) - timedelta(days=1),
        )
        archived = Series(slug=f"arc-{uuid.uuid4().hex[:10]}", status=PublishStatus.archived, free_episodes=1)
        s.add_all([sess, asset, series, archived])
        await s.flush()
        s.add_all(
            [
                SeriesTranslation(series_id=series.id, lang="en", title="Coverage Drama"),
                SeriesTranslation(series_id=archived.id, lang="en", title="Pulled From Sale"),
            ]
        )
        free_ep = Episode(
            series_id=series.id,
            number=1,
            title="One",
            status=PublishStatus.published,
            duration_sec=120,
            video_asset_id=asset.id,
        )
        paid_ep = Episode(series_id=series.id, number=2, title="Two", status=PublishStatus.published, duration_sec=130)
        s.add_all([free_ep, paid_ep])
        await s.commit()

        yield World(
            maker=maker,
            user=user,
            session_row=sess,
            admin=admin,
            series=series,
            free_ep=free_ep,
            paid_ep=paid_ep,
            asset=asset,
            archived=archived,
        )
    await engine.dispose()


def _install(maker: async_sessionmaker, *, ctx=None, admin=None) -> None:
    async def _session():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_session] = _session
    if ctx is not None:
        app.dependency_overrides[deps.current_user] = lambda: ctx
        app.dependency_overrides[deps.optional_user] = lambda: ctx
    if admin is not None:
        app.dependency_overrides[deps.current_admin] = lambda: admin


def _uninstall() -> None:
    for key in (get_session, deps.current_user, deps.optional_user, deps.current_admin):
        app.dependency_overrides.pop(key, None)


@pytest.fixture
async def api(world):
    """A signed-in viewer. Auth is bypassed; this suite is about the handlers behind it."""
    ctx = deps.AuthContext(user=world.user, session_id=world.session_row.id)
    _install(world.maker, ctx=ctx, admin=world.admin)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    _uninstall()


@pytest.fixture
async def guest(world):
    """No session at all: what an unauthenticated client, or Google's SSV callback, gets."""
    _install(world.maker)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    _uninstall()


# --------------------------------------------------------------------------------------------------
# Favourites and likes
# --------------------------------------------------------------------------------------------------


async def test_favouriting_is_a_toggle_and_the_series_appears_in_my_list(api, world):
    on = await api.post(f"/v1/series/{world.series.id}/favorite")
    assert on.status_code == 200 and on.json()["active"] is True

    listed = await api.get("/v1/me/list")
    assert listed.status_code == 200
    body = listed.json()
    assert [f["id"] for f in body["favorites"]] == [str(world.series.id)]
    card = body["favorites"][0]
    assert card["title"] == "Coverage Drama"
    # Stored as a key, resolved against the CDN base at response time.
    assert card["cover_url"].endswith("/library/cov/cover.jpg")

    off = await api.post(f"/v1/series/{world.series.id}/favorite")
    assert off.json()["active"] is False
    assert (await api.get("/v1/me/list")).json()["favorites"] == []


async def test_a_favourite_that_is_no_longer_published_drops_out_of_my_list(api, world):
    """My List was the one screen that showed unpublished titles to the public.

    The row stays — the viewer's list is theirs — but the card does not render, because tapping it would lead
    to a 404 on a series that has been pulled.
    """
    assert (await api.post(f"/v1/series/{world.archived.id}/favorite")).json()["active"] is True
    async with world.maker() as s:
        assert await s.get(Favorite, (world.user.id, world.archived.id)) is not None

    assert (await api.get("/v1/me/list")).json()["favorites"] == []


async def test_favouriting_a_series_that_does_not_exist_is_a_404(api):
    assert (await api.post(f"/v1/series/{uuid.uuid4()}/favorite")).status_code == 404


async def test_liking_moves_the_counter_and_unliking_moves_it_back(api, world):
    before = world.series.like_count
    on = await api.post(f"/v1/series/{world.series.id}/like")
    assert on.status_code == 200
    assert on.json() == {"active": True, "count": before + 1}
    async with world.maker() as s:
        assert (await s.get(Series, world.series.id)).like_count == before + 1

    off = await api.post(f"/v1/series/{world.series.id}/like")
    assert off.json() == {"active": False, "count": before}


async def test_liking_a_series_that_does_not_exist_is_a_404(api):
    assert (await api.post(f"/v1/series/{uuid.uuid4()}/like")).status_code == 404


async def test_the_like_counter_never_goes_negative(world):
    """A like row without a matching count — a hand-fixed row, or a restore — must not underflow the column."""
    async with world.maker() as s:
        s.add(Like(user_id=world.user.id, series_id=world.series.id, created_at=datetime.now(UTC)))
        series = await s.get(Series, world.series.id)
        series.like_count = 0
        await s.commit()

        active, count = await eng.toggle_like(s, world.user.id, world.series.id)
        assert (active, count) == (False, 0)


# --------------------------------------------------------------------------------------------------
# Views, counted once per viewer per day
# --------------------------------------------------------------------------------------------------


class _FakeRedis:
    """Enough of the Redis surface for the view counter: a set, and an expiry that is recorded."""

    def __init__(self):
        self.members: set[str] = set()
        self.expired: list[tuple[str, int]] = []

    async def sadd(self, key: str, member: str) -> int:
        if member in self.members:
            return 0
        self.members.add(member)
        return 1

    async def expire(self, key: str, seconds: int) -> None:
        self.expired.append((key, seconds))


async def _view_count(world) -> int:
    async with world.maker() as s:
        return (await s.get(Series, world.series.id)).view_count


async def test_a_view_is_counted_once_per_viewer_per_day(api, world, monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(engagement_router, "cache_available", lambda: True)
    monkeypatch.setattr(engagement_router, "redis_client", _resolved(fake))

    before = await _view_count(world)
    assert (await api.post(f"/v1/series/{world.series.id}/view")).status_code == 200
    assert await _view_count(world) == before + 1
    # The second play of the day is the same viewer refreshing; Top Picks must not move for it.
    assert (await api.post(f"/v1/series/{world.series.id}/view")).status_code == 200
    assert await _view_count(world) == before + 1
    # The key is given a lifetime, or the de-duplication set grows for ever.
    assert fake.expired and fake.expired[0][1] > 24 * 3600


async def test_a_view_is_still_counted_when_the_cache_is_parked(api, world, monkeypatch):
    """Redis down must cost a little accuracy, never a lost view."""
    monkeypatch.setattr(engagement_router, "cache_available", lambda: False)

    before = await _view_count(world)
    assert (await api.post(f"/v1/series/{world.series.id}/view")).status_code == 200
    assert (await api.post(f"/v1/series/{world.series.id}/view")).status_code == 200
    assert await _view_count(world) == before + 2


async def test_a_redis_error_is_noted_and_the_view_still_lands(api, world, monkeypatch):
    failures: list[int] = []

    async def boom():
        raise ConnectionError("redis is gone")

    monkeypatch.setattr(engagement_router, "cache_available", lambda: True)
    monkeypatch.setattr(engagement_router, "redis_client", boom)
    # Faked so the run of failures is observed without parking the process-wide cache for other tests.
    monkeypatch.setattr(engagement_router, "note_cache_failure", lambda: failures.append(1))

    before = await _view_count(world)
    assert (await api.post(f"/v1/series/{world.series.id}/view")).status_code == 200
    assert await _view_count(world) == before + 1
    assert failures == [1], "a failed cache call must be recorded, or the breaker never trips"


def _resolved(value):
    async def _call():
        return value

    return _call


# --------------------------------------------------------------------------------------------------
# Watch progress, history and continue-watching
# --------------------------------------------------------------------------------------------------


async def test_progress_is_stored_and_completion_is_stamped_once(api, world):
    assert (await api.put(f"/v1/episodes/{world.free_ep.id}/progress", json={"position_sec": 30})).status_code == 200
    async with world.maker() as s:
        row = await s.get(WatchProgress, (world.user.id, world.free_ep.id))
        assert row.position_sec == 30 and row.completed_at is None
        assert row.series_id == world.series.id

    done = await api.put(f"/v1/episodes/{world.free_ep.id}/progress", json={"position_sec": 118, "completed": True})
    assert done.status_code == 200
    async with world.maker() as s:
        first_stamp = (await s.get(WatchProgress, (world.user.id, world.free_ep.id))).completed_at
        assert first_stamp is not None

    # Re-watching does not re-stamp: "first completed at" is what streak and series-complete reporting read.
    await api.put(f"/v1/episodes/{world.free_ep.id}/progress", json={"position_sec": 10, "completed": True})
    async with world.maker() as s:
        row = await s.get(WatchProgress, (world.user.id, world.free_ep.id))
        assert row.completed_at == first_stamp
        assert row.position_sec == 10


async def test_progress_on_an_episode_that_does_not_exist_is_a_404(api):
    r = await api.put(f"/v1/episodes/{uuid.uuid4()}/progress", json={"position_sec": 5})
    assert r.status_code == 404


async def test_a_negative_position_is_clamped_rather_than_stored(world):
    """The schema rejects one from a client; the service is also called from the worker, so it clamps."""
    async with world.maker() as s:
        row = await eng.update_progress(s, world.user.id, world.free_ep.id, -50, False)
        await s.commit()
        assert row.position_sec == 0


async def test_continue_watching_shows_the_latest_episode_per_series(api, world):
    """One row per series, newest first — the shape the Continue rail and My List both render."""
    await api.put(f"/v1/episodes/{world.free_ep.id}/progress", json={"position_sec": 20})
    await api.put(f"/v1/episodes/{world.paid_ep.id}/progress", json={"position_sec": 45})

    history = (await api.get("/v1/me/list")).json()["history"]
    assert len(history) == 1, "two episodes of one series is one entry in Continue Watching, not two"
    item = history[0]
    assert item["episode_id"] == str(world.paid_ep.id)
    assert item["episode_number"] == 2
    assert item["position_sec"] == 45
    assert item["duration_sec"] == 130
    assert item["completed"] is False
    assert item["series"]["id"] == str(world.series.id)


async def test_history_ignores_an_episode_that_is_no_longer_published(world):
    """An episode pulled for a rights problem must not keep offering itself as the thing to resume."""
    async with world.maker() as s:
        draft = Episode(series_id=world.series.id, number=9, status=PublishStatus.draft)
        s.add(draft)
        await s.flush()
        s.add(
            WatchProgress(
                user_id=world.user.id,
                episode_id=draft.id,
                series_id=world.series.id,
                position_sec=5,
                updated_at=datetime.now(UTC),
            )
        )
        await s.commit()
        assert await eng.history(s, world.user.id) == []


async def test_history_is_capped_at_one_row_per_series_up_to_the_limit(world):
    """`limit` counts series, not progress rows — a viewer deep in one show must not fill the whole rail."""
    async with world.maker() as s:
        for number in (1, 2):
            ep = await s.scalar(select(Episode).where(Episode.series_id == world.series.id, Episode.number == number))
            s.add(
                WatchProgress(
                    user_id=world.user.id,
                    episode_id=ep.id,
                    series_id=world.series.id,
                    position_sec=number,
                    updated_at=datetime.now(UTC) + timedelta(seconds=number),
                )
            )
        await s.commit()
        rows = await eng.history(s, world.user.id, limit=1)
        assert len(rows) == 1
        assert rows[0][1].number == 2, "the most recent episode of the series is the one to resume"


async def test_clearing_history_takes_one_series_or_all_of_it(api, world):
    await api.put(f"/v1/episodes/{world.free_ep.id}/progress", json={"position_sec": 20})
    assert len((await api.get("/v1/me/list")).json()["history"]) == 1

    scoped = await api.delete(f"/v1/me/history?series_id={world.series.id}")
    assert scoped.status_code == 200
    assert (await api.get("/v1/me/list")).json()["history"] == []

    await api.put(f"/v1/episodes/{world.free_ep.id}/progress", json={"position_sec": 20})
    assert (await api.delete("/v1/me/history")).status_code == 200
    async with world.maker() as s:
        remaining = (await s.scalars(select(WatchProgress).where(WatchProgress.user_id == world.user.id))).all()
        assert list(remaining) == []


# --------------------------------------------------------------------------------------------------
# Reports and contact
# --------------------------------------------------------------------------------------------------


async def test_a_report_names_the_series_and_the_reporter(api, world):
    r = await api.post("/v1/reports", json={"series_id": str(world.series.id), "reason": "other", "details": "nope"})
    assert r.status_code == 200
    async with world.maker() as s:
        row = await s.scalar(select(Report).where(Report.series_id == world.series.id))
        assert row is not None
        assert row.reporter_id == world.user.id and row.reason == "other" and row.details == "nope"


async def test_a_report_against_an_unpublished_series_is_a_404_not_a_confirmation(api, world):
    """The endpoint is checked against visibility, not existence: otherwise it is an oracle for drafts."""
    unknown = await api.post("/v1/reports", json={"series_id": str(uuid.uuid4()), "reason": "spam"})
    assert unknown.status_code == 404
    archived = await api.post("/v1/reports", json={"series_id": str(world.archived.id), "reason": "spam"})
    assert archived.status_code == 404, "an archived series must not confirm itself through the report form"


async def test_a_report_against_an_episode_checks_the_episode_too(api, world):
    ok = await api.post("/v1/reports", json={"episode_id": str(world.free_ep.id), "reason": "quality"})
    assert ok.status_code == 200
    missing = await api.post("/v1/reports", json={"episode_id": str(uuid.uuid4()), "reason": "quality"})
    assert missing.status_code == 404


async def test_contact_returns_a_reference_that_finds_the_stored_message(guest, world):
    # Unique per run: the test database keeps rows, and the reference has to identify one message.
    email = f"asha-{uuid.uuid4().hex[:8]}@katha-test.dev"
    r = await guest.post(
        "/v1/contact",
        json={"name": "Asha", "email": email, "subject": "Hello", "message": "Please call me back"},
    )
    assert r.status_code == 200
    reference = r.json()["reference"]
    assert len(reference) == 8 and reference == reference.upper()
    async with world.maker() as s:
        row = await s.scalar(select(ContactMessage).where(ContactMessage.email == email))
        assert row is not None
        assert row.id.hex[:8].upper() == reference, "the reference has to lead back to the row"
        assert row.is_read is False


async def test_contact_demands_the_captcha_once_one_is_configured(guest, monkeypatch):
    """With a secret set, an unsolved form is refused rather than silently accepted."""
    monkeypatch.setattr(get_settings(), "turnstile_secret_key", "secret-key")
    refused = await guest.post(
        "/v1/contact",
        json={"name": "Bot", "email": "bot@katha-test.dev", "message": "buy my product"},
    )
    assert refused.status_code == 400
    assert refused.json()["detail"]["code"] == "captcha_failed"


async def test_contact_accepts_a_solved_captcha(guest, world, monkeypatch):
    seen: list[tuple] = []

    async def fake_verify(token: str, secret: str, ip: str | None = None) -> bool:
        seen.append((token, secret, ip))
        return True

    monkeypatch.setattr(get_settings(), "turnstile_secret_key", "secret-key")
    monkeypatch.setattr(engagement_router, "verify_turnstile", fake_verify)
    r = await guest.post(
        "/v1/contact",
        json={
            "name": "Asha",
            "email": f"asha-{uuid.uuid4().hex[:8]}@katha-test.dev",
            "message": "Please call me back",
            "captcha_token": "solved",
        },
    )
    assert r.status_code == 200
    assert seen and seen[0][0] == "solved" and seen[0][1] == "secret-key"


# --------------------------------------------------------------------------------------------------
# The data export
# --------------------------------------------------------------------------------------------------


async def test_the_export_contains_the_account_and_its_money_rows(api, world):
    """Built from the caller's own token — there is no user id parameter — and rate limited, so one call.

    A viewer could delete their account without being able to see what deleting it removes. Everything the
    account holds has to be in here, the disputed rows (coins and payments) most of all.
    """
    async with world.maker() as s:
        pack = CoinPack(sku=f"pack-{uuid.uuid4().hex[:8]}", name="Starter", kind=PackKind.coins, coins=100)
        s.add(pack)
        await s.flush()
        s.add_all(
            [
                CoinLedger(
                    user_id=world.user.id,
                    delta=100,
                    balance_after=600,
                    kind=LedgerKind.signup_bonus,
                    idempotency_key=uuid.uuid4().hex,
                    note="welcome",
                    created_at=datetime.now(UTC),
                ),
                Purchase(
                    user_id=world.user.id,
                    pack_id=pack.id,
                    gateway="razorpay",
                    status=PurchaseStatus.paid,
                    currency="INR",
                    amount=199.00,
                    coins_granted=100,
                    paid_at=datetime.now(UTC),
                ),
                Favorite(user_id=world.user.id, series_id=world.series.id, created_at=datetime.now(UTC)),
                WatchProgress(
                    user_id=world.user.id,
                    episode_id=world.free_ep.id,
                    series_id=world.series.id,
                    position_sec=42,
                    updated_at=datetime.now(UTC),
                ),
            ]
        )
        await s.commit()

    r = await api.get("/v1/me/export")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["profile"]["public_id"] == world.user.public_id
    assert body["profile"]["coin_balance"] == world.user.coin_balance
    assert [(e["kind"], e["delta"], e["note"]) for e in body["coin_ledger"]] == [("signup_bonus", 100, "welcome")]
    assert [(p["status"], p["gateway"], p["amount"]) for p in body["purchases"]] == [("paid", "razorpay", 199.0)]
    assert len(body["watch_history"]) == 1
    watched = body["watch_history"][0]
    assert (watched["series"], watched["position_sec"], watched["completed"]) == (world.series.slug, 42, False)
    assert watched["updated_at"], "a history row without a date is not much of an export"
    assert [f["series"] for f in body["favourites"]] == [world.series.slug]
    assert body["generated_at"]


# --------------------------------------------------------------------------------------------------
# Client events
# --------------------------------------------------------------------------------------------------


async def _events_for(world, name: str) -> list[AnalyticsEvent]:
    async with world.maker() as s:
        return list((await s.scalars(select(AnalyticsEvent).where(AnalyticsEvent.name == name))).all())


async def test_an_unknown_event_name_is_dropped_without_failing_the_batch(api, world):
    """Clients ship on their own schedule. A strict endpoint here means one stale build stops reporting."""
    marker = uuid.uuid4().hex
    r = await api.post(
        "/v1/events",
        json={
            "events": [
                {"name": "not_a_real_event", "props": {"marker": marker}},
                {"name": "app_open", "props": {"marker": marker}},
            ]
        },
        headers={"X-Katha-Platform": "android"},
    )
    assert r.status_code == 200
    assert await _events_for(world, "not_a_real_event") == []
    kept = [e for e in await _events_for(world, "app_open") if (e.props or {}).get("marker") == marker]
    assert len(kept) == 1
    assert kept[0].user_id == world.user.id
    assert kept[0].platform == "android"


async def test_one_unusable_property_does_not_cost_the_whole_event(api, world):
    """Props are filtered to scalars per key: a nested object from a client bug drops that key, nothing else."""
    marker = uuid.uuid4().hex
    r = await api.post(
        "/v1/events",
        json={
            "events": [
                {
                    "name": "rebuffer",
                    "props": {"marker": marker, "duration_ms": {"unexpected": "object"}, "bitrate": 1200},
                }
            ],
            "device": {"model": "Pixel 7", "os": "android 14"},
        },
    )
    assert r.status_code == 200
    rows = [e for e in await _events_for(world, "rebuffer") if (e.props or {}).get("marker") == marker]
    assert len(rows) == 1, "a bad numeric field must not lose the event"
    props = rows[0].props
    assert props["bitrate"] == 1200
    assert "duration_ms" not in props
    assert props["device"]["model"] == "Pixel 7"


async def test_an_absurd_timestamp_is_clamped_to_now(api, world):
    """Clock skew and replays both show up as an event dated next year; the row still has to be usable."""
    marker = uuid.uuid4().hex
    sent = datetime.now(UTC) + timedelta(days=400)
    r = await api.post(
        "/v1/events",
        json={"events": [{"name": "play_start", "ts": sent.isoformat(), "props": {"marker": marker}}]},
    )
    assert r.status_code == 200
    rows = [e for e in await _events_for(world, "play_start") if (e.props or {}).get("marker") == marker]
    assert len(rows) == 1
    assert abs((datetime.now(UTC) - rows[0].ts).total_seconds()) < 300


async def test_a_batch_with_nothing_usable_writes_nothing(api, world):
    before = len(await _events_for(world, "app_open"))
    r = await api.post("/v1/events", json={"events": [{"name": "unknown_one"}, {"name": "unknown_two"}]})
    assert r.status_code == 200
    assert len(await _events_for(world, "app_open")) == before


# --------------------------------------------------------------------------------------------------
# The play grant, and the manifests it unlocks
# --------------------------------------------------------------------------------------------------

MASTER = """#EXTM3U
#EXT-X-VERSION:6
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1080x1920
1080p/index.m3u8
"""

VARIANT = """#EXTM3U
#EXT-X-VERSION:6
#EXT-X-KEY:METHOD=AES-128,URI="katha:key",IV=0xDEADBEEF00000000000000000000CAFE
#EXTINF:4.000000,
seg_0000.ts
#EXT-X-ENDLIST
"""


def _sign(path: str, *, minutes: int = 30, viewer=None) -> str:
    return sign_path(path, user_id=viewer or uuid.uuid4(), expires=datetime.now(UTC) + timedelta(minutes=minutes))


async def test_only_the_play_grant_carries_a_playback_url(api, world):
    """The episode list is a browse response and deliberately holds no media URL; /play is the only source."""
    detail = await api.get(f"/v1/series/{world.series.slug}")
    assert detail.status_code == 200
    episodes = detail.json()["episodes"]
    assert episodes and all("hls_url" not in ep for ep in episodes)
    assert "m3u8" not in detail.text

    grant = await api.post(f"/v1/episodes/{world.free_ep.id}/play")
    assert grant.status_code == 200, grant.text
    body = grant.json()
    assert f"/v1/stream/{world.asset.id}/master.m3u8?" in body["hls_url"]
    assert "sig=" in body["hls_url"] and "uid=" in body["hls_url"]
    assert body["next_episode_id"] == str(world.paid_ep.id)


async def test_a_locked_episode_gets_no_url_at_all(api, world):
    """Episode two is behind the paywall with nothing unlocked, so there is nothing to sign."""
    r = await api.post(f"/v1/episodes/{world.paid_ep.id}/play")
    assert r.status_code == 403
    assert "m3u8" not in r.text


async def test_the_grants_signature_opens_the_master_manifest(api, world, monkeypatch):
    monkeypatch.setattr(stream_router, "_fetch", _returns(MASTER))
    grant = (await api.post(f"/v1/episodes/{world.free_ep.id}/play")).json()
    url = grant["hls_url"].split("/v1/stream/", 1)[1]

    res = await api.get(f"/v1/stream/{url}")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/vnd.apple.mpegurl")
    assert "no-store" in res.headers["cache-control"]
    body = res.text
    # Variants point back here, freshly signed, so the key URL inside them can be per-viewer.
    variant_line = next(line for line in body.splitlines() if not line.startswith("#") and line)
    assert variant_line.startswith(f"/v1/stream/{world.asset.id}/v/1080p/index.m3u8?")
    assert "sig=" in variant_line and "exp=" in variant_line
    # The rendition description is not ours to touch.
    assert "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1080x1920" in body


async def test_the_manifest_is_read_from_the_origin_not_the_public_edge(api, world, monkeypatch):
    """The origin is internal and is never handed to a client; only the segments come from the edge.

    This is the one test that runs the real fetch, with the HTTP client faked, so the URL the service builds
    is asserted rather than assumed.
    """
    fake = _FakeHttp(text=MASTER)
    monkeypatch.setattr(stream_router.httpx, "AsyncClient", fake)
    path = f"/v1/stream/{world.asset.id}/master.m3u8"
    res = await api.get(f"{path}?{_sign(path)}")
    assert res.status_code == 200
    asset_dir = world.asset.hls_master_key.rsplit("/", 1)[0]
    assert fake.fetched == [f"{get_settings().origin_url.rstrip('/')}/{asset_dir}/master.m3u8"]


async def test_a_master_line_that_is_not_a_rendition_is_dropped(api, world, monkeypatch):
    """This value becomes part of a URL fetched from storage; it is matched, never sanitised."""
    monkeypatch.setattr(stream_router, "_fetch", _returns(MASTER + "../../etc/passwd/index.m3u8\n"))
    path = f"/v1/stream/{world.asset.id}/master.m3u8"
    body = (await api.get(f"{path}?{_sign(path)}")).text
    assert "passwd" not in body
    assert "1080p" in body


async def test_the_variant_playlist_mints_a_key_url_and_signs_every_segment(api, world, monkeypatch):
    monkeypatch.setattr(stream_router, "_fetch", _returns(VARIANT))
    path = f"/v1/stream/{world.asset.id}/v/1080p/index.m3u8"
    res = await api.get(f"{path}?{_sign(path)}")
    assert res.status_code == 200
    body = res.text
    assert 'URI="katha:key"' not in body, "the packager's static key URI is exactly what must not be served"
    assert f"/v1/stream/{world.asset.id}/key?" in body
    # Rebuilding the line instead of swapping the URI drops the IV, and every segment decrypts to noise.
    assert "IV=0xDEADBEEF00000000000000000000CAFE" in body and "METHOD=AES-128" in body
    segment = next(line for line in body.splitlines() if "seg_0000.ts" in line)
    assert segment.startswith(get_settings().cdn_base_url.rstrip("/"))
    assert "sig=" in segment


async def test_the_key_is_sixteen_bytes_and_only_with_a_signature(api, world):
    path = f"/v1/stream/{world.asset.id}/key"
    ok = await api.get(f"{path}?{_sign(path)}")
    assert ok.status_code == 200
    assert ok.content == content_key(world.asset.id)
    assert len(ok.content) == 16

    assert (await api.get(path)).status_code == 422, "the signature is not optional"
    tampered = _sign(path).replace("sig=", "sig=z")
    assert (await api.get(f"{path}?{tampered}")).status_code == 403
    assert (await api.get(f"{path}?{_sign(path, minutes=-1)}")).status_code == 403


async def test_a_signature_naming_a_viewer_that_is_not_a_uuid_is_refused(api, world):
    """The signature is valid; the identity it carries is not one that could have come from a play grant."""
    path = f"/v1/stream/{world.asset.id}/key"
    query = sign_path(path, user_id="not-a-uuid", expires=datetime.now(UTC) + timedelta(minutes=5))
    assert (await api.get(f"{path}?{query}")).status_code == 403


@pytest.mark.parametrize("variant", ["..%2F..%2Fetc", "1080p.bak", "x" * 40])
async def test_a_variant_name_outside_the_rendition_shape_is_refused(api, world, variant):
    """The value becomes part of a URL fetched from storage, so it is matched against the shape a packager
    writes, never sanitised into something that looks close enough."""
    path = f"/v1/stream/{world.asset.id}/v/{variant}/index.m3u8"
    assert (await api.get(f"{path}?{_sign(path)}")).status_code == 404


async def test_an_asset_that_is_not_ready_serves_no_key(api, world):
    async with world.maker() as s:
        half = VideoAsset(source_key="uploads/half.mp4", status=AssetStatus.transcoding, hls_master_key=None)
        s.add(half)
        await s.commit()
        asset_id = half.id
    path = f"/v1/stream/{asset_id}/key"
    assert (await api.get(f"{path}?{_sign(path)}")).status_code == 404
    assert (await api.get(f"/v1/stream/{uuid.uuid4()}/key?{_sign(path)}")).status_code == 403


async def test_an_origin_that_will_not_answer_is_a_404_not_a_stack_trace(api, world, monkeypatch):
    monkeypatch.setattr(stream_router.httpx, "AsyncClient", _FakeHttp(raises=httpx.ConnectError("no route")))
    path = f"/v1/stream/{world.asset.id}/master.m3u8"
    assert (await api.get(f"{path}?{_sign(path)}")).status_code == 404


async def test_a_manifest_missing_from_the_origin_is_a_404(api, world, monkeypatch):
    monkeypatch.setattr(stream_router.httpx, "AsyncClient", _FakeHttp(status_code=404, text="not found"))
    path = f"/v1/stream/{world.asset.id}/master.m3u8"
    assert (await api.get(f"{path}?{_sign(path)}")).status_code == 404


async def test_an_unencrypted_playlist_is_refused_rather_than_served(api, world, monkeypatch):
    """Serving it hands out the episode in the clear through a route that promises encryption."""
    monkeypatch.setattr(stream_router, "_fetch", _returns("#EXTM3U\n#EXTINF:4.0,\nseg_0000.ts\n#EXT-X-ENDLIST\n"))
    path = f"/v1/stream/{world.asset.id}/v/1080p/index.m3u8"
    assert (await api.get(f"{path}?{_sign(path)}")).status_code == 404


def _returns(text: str):
    async def _fetch(_url: str) -> str:
        return text

    return _fetch


class _FakeHttp:
    """Stands in for httpx.AsyncClient so no test ever reaches a real origin."""

    def __init__(self, *, status_code: int = 200, text: str = "", raises: Exception | None = None):
        self.status_code = status_code
        self.text = text
        self.raises = raises
        self.fetched: list[str] = []

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url):
        self.fetched.append(url)
        if self.raises:
            raise self.raises
        return httpx.Response(self.status_code, text=self.text)


# --------------------------------------------------------------------------------------------------
# The AdMob rewarded callback
# --------------------------------------------------------------------------------------------------


@dataclass
class Ssv:
    private: ec.EllipticCurvePrivateKey
    unit_id: str
    unit_number: str
    retired_unit_id: str
    client: AsyncClient
    user_id: uuid.UUID
    maker: async_sessionmaker


@pytest.fixture
async def ssv(guest, world, monkeypatch):
    """A live AdMob placement, and Google's key set replaced by one generated here.

    The real keys are not needed: the algorithm is ECDSA-SHA256 over the query string, so a local P-256 key
    exercises the same path — including the parts that decide a callback is *not* ours.
    """
    private = ec.generate_private_key(ec.SECP256R1())
    pem = (
        private.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )

    async def fake_keys(**_):
        return {"1": pem}

    monkeypatch.setattr(admob_ssv, "fetch_keys", fake_keys)

    number = str(uuid.uuid4().int)[:10]
    unit_id = f"ca-app-pub-{uuid.uuid4().int % 10**16:016d}/{number}"
    retired_unit_id = f"ca-app-pub-{uuid.uuid4().int % 10**16:016d}/{uuid.uuid4().int % 10**10:010d}"
    async with world.maker() as s:
        s.add_all(
            [
                AdPlacement(
                    name="Rewarded unlock",
                    slot="unlock_rewarded",
                    provider="admob",
                    unit_id=unit_id,
                    platforms=["android"],
                    reward_coins=10,
                    is_active=True,
                ),
                # Turned off by an operator: a callback for it is no longer ours to honour.
                AdPlacement(
                    name="Retired unit",
                    slot="unlock_rewarded",
                    provider="admob",
                    unit_id=retired_unit_id,
                    platforms=["android"],
                    is_active=False,
                ),
            ]
        )
        await s.commit()
    yield Ssv(
        private=private,
        unit_id=unit_id,
        unit_number=number,
        retired_unit_id=retired_unit_id,
        client=guest,
        user_id=world.user.id,
        maker=world.maker,
    )


def _signed_content(ssv: Ssv, **overrides) -> str:
    """Google's parameter order, with only characters that survive a URL round-trip untouched."""
    params = {
        "ad_network": "5450213213286189855",
        "ad_unit": ssv.unit_id,
        "custom_data": "unlock",
        "reward_amount": "10",
        "reward_item": "coins",
        "timestamp": str(int(datetime.now(UTC).timestamp() * 1000)),
        "transaction_id": uuid.uuid4().hex,
        "user_id": str(ssv.user_id),
    }
    params.update({k: v for k, v in overrides.items() if v is not None})
    for key, value in overrides.items():
        if value is None:
            params.pop(key, None)
    return "&".join(f"{k}={v}" for k, v in params.items())


def _sign_callback(ssv: Ssv, content: str, key_id: str = "1") -> str:
    raw = ssv.private.sign(content.encode(), ec.ECDSA(hashes.SHA256()))
    signature = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    return f"{content}&signature={signature}&key_id={key_id}"


async def _call(ssv: Ssv, query: str):
    return await ssv.client.get(f"/v1/ads/admob/ssv?{query}")


async def _event(ssv: Ssv, transaction_id: str) -> AdEvent | None:
    async with ssv.maker() as s:
        return await s.scalar(select(AdEvent).where(AdEvent.ssv_transaction_id == transaction_id))


def _transaction(content: str) -> str:
    return dict(pair.split("=", 1) for pair in content.split("&"))["transaction_id"]


async def test_a_genuine_callback_records_the_reward(ssv):
    content = _signed_content(ssv, custom_data="task:daily")
    res = await _call(ssv, _sign_callback(ssv, content))
    assert res.status_code == 200

    row = await _event(ssv, _transaction(content))
    assert row is not None, "a verified completion is the only thing that lets a claim spend it"
    assert row.user_id == ssv.user_id
    assert row.network == "admob"
    assert row.ad_unit_id == ssv.unit_id
    assert (row.purpose, row.ref_id) == ("task", "daily")
    assert row.reward_coins == 10
    assert row.consumed_at is None


async def test_a_callback_for_another_publishers_unit_mints_nothing(ssv):
    """Google signs SSV callbacks for every app that uses it. A valid signature is not a valid reward here."""
    content = _signed_content(ssv, ad_unit=f"ca-app-pub-9999999999999999/{uuid.uuid4().int % 10**10:010d}")
    assert (await _call(ssv, _sign_callback(ssv, content))).status_code == 200
    assert await _event(ssv, _transaction(content)) is None


async def test_a_callback_for_a_placement_an_operator_switched_off_mints_nothing(ssv):
    content = _signed_content(ssv, ad_unit=ssv.retired_unit_id)
    assert (await _call(ssv, _sign_callback(ssv, content))).status_code == 200
    assert await _event(ssv, _transaction(content)) is None


async def test_the_numeric_form_of_a_configured_unit_is_accepted(ssv):
    """AdMob reports the unit's numeric id; operators enter the full `ca-app-pub-…/…` the SDK wants."""
    content = _signed_content(ssv, ad_unit=ssv.unit_number)
    assert (await _call(ssv, _sign_callback(ssv, content))).status_code == 200
    row = await _event(ssv, _transaction(content))
    assert row is not None and row.ad_unit_id == ssv.unit_number


async def test_a_tampered_reward_does_not_verify(ssv):
    """The whole point of the signature: an amount edited in flight must not pay out."""
    content = _signed_content(ssv)
    signed = _sign_callback(ssv, content)
    tampered = signed.replace("reward_amount=10", "reward_amount=99999")
    assert (await _call(ssv, tampered)).status_code == 200
    assert await _event(ssv, _transaction(content)) is None


async def test_a_signature_from_another_key_does_not_verify(ssv):
    content = _signed_content(ssv)
    other = ec.generate_private_key(ec.SECP256R1())
    raw = other.sign(content.encode(), ec.ECDSA(hashes.SHA256()))
    forged = f"{content}&signature={base64.urlsafe_b64encode(raw).decode().rstrip('=')}&key_id=1"
    assert (await _call(ssv, forged)).status_code == 200
    assert await _event(ssv, _transaction(content)) is None


async def test_a_parameter_appended_after_the_signature_is_never_read(ssv, world):
    """The framework parses the whole query string. Only the signed prefix may be acted on.

    Appending a second `user_id` after `key_id` is how a genuine callback for one account would be redirected
    to another; the callback is refused outright rather than having its parse argued about per parameter.
    """
    victim = uuid.uuid4()
    async with world.maker() as s:
        other = _user()
        s.add(other)
        await s.commit()
        victim = other.id

    content = _signed_content(ssv)
    smuggled = f"{_sign_callback(ssv, content)}&user_id={victim}"
    assert (await _call(ssv, smuggled)).status_code == 200
    assert await _event(ssv, _transaction(content)) is None
    async with world.maker() as s:
        assert await s.scalar(select(AdEvent).where(AdEvent.user_id == victim)) is None


async def test_a_stale_callback_is_refused(ssv):
    old = int((datetime.now(UTC) - timedelta(hours=3)).timestamp() * 1000)
    content = _signed_content(ssv, timestamp=str(old))
    assert (await _call(ssv, _sign_callback(ssv, content))).status_code == 200
    assert await _event(ssv, _transaction(content)) is None


async def test_a_callback_with_no_transaction_id_is_refused(ssv):
    content = _signed_content(ssv, transaction_id=None)
    assert (await _call(ssv, _sign_callback(ssv, content))).status_code == 200
    async with ssv.maker() as s:
        # Nothing to look up by; what matters is that no row appeared for this unit.
        rows = (await s.scalars(select(AdEvent).where(AdEvent.ad_unit_id == ssv.unit_id))).all()
        assert list(rows) == []


async def test_an_over_long_value_is_treated_as_absent(ssv):
    """Longer than the column that would store it, so it is dropped rather than truncated into a near-match."""
    content = _signed_content(ssv, transaction_id="x" * 200)
    assert (await _call(ssv, _sign_callback(ssv, content))).status_code == 200
    assert await _event(ssv, "x" * 200) is None


async def test_a_callback_with_no_reward_amount_is_still_a_completion(ssv):
    """Not every rewarded unit is configured with an amount; the completion is what a claim spends."""
    content = _signed_content(ssv, reward_amount=None)
    assert (await _call(ssv, _sign_callback(ssv, content))).status_code == 200
    row = await _event(ssv, _transaction(content))
    assert row is not None and row.reward_coins is None


async def test_a_reward_amount_that_is_not_a_number_is_refused(ssv):
    content = _signed_content(ssv, reward_amount="ten")
    assert (await _call(ssv, _sign_callback(ssv, content))).status_code == 200
    assert await _event(ssv, _transaction(content)) is None


async def test_a_reward_amount_outside_the_plausible_range_is_refused(ssv):
    content = _signed_content(ssv, reward_amount="500000")
    assert (await _call(ssv, _sign_callback(ssv, content))).status_code == 200
    assert await _event(ssv, _transaction(content)) is None


async def test_a_callback_naming_a_user_that_is_not_ours_is_refused(ssv):
    unknown = _signed_content(ssv, user_id=str(uuid.uuid4()))
    assert (await _call(ssv, _sign_callback(ssv, unknown))).status_code == 200
    assert await _event(ssv, _transaction(unknown)) is None

    malformed = _signed_content(ssv, user_id="not-a-uuid")
    assert (await _call(ssv, _sign_callback(ssv, malformed))).status_code == 200
    assert await _event(ssv, _transaction(malformed)) is None


async def test_a_retry_of_the_same_completion_pays_once(ssv):
    """Google retries anything that is not a 200, so the same completion arrives twice on a network hiccup."""
    content = _signed_content(ssv)
    signed = _sign_callback(ssv, content)
    assert (await _call(ssv, signed)).status_code == 200
    assert (await _call(ssv, signed)).status_code == 200
    async with ssv.maker() as s:
        rows = (await s.scalars(select(AdEvent).where(AdEvent.ssv_transaction_id == _transaction(content)))).all()
        assert len(rows) == 1


async def test_an_unrecognised_purpose_falls_back_to_an_unlock(ssv):
    """`custom_data` is the client's, and the conservative reading of anything unexpected is a plain unlock."""
    content = _signed_content(ssv, custom_data="mystery:42")
    assert (await _call(ssv, _sign_callback(ssv, content))).status_code == 200
    row = await _event(ssv, _transaction(content))
    assert row is not None and row.purpose == "unlock" and row.ref_id == "42"


async def test_a_callback_shaped_unlike_googles_is_refused(ssv):
    """No `key_id` at all: the framework would still parse the rest, and nobody signed it."""
    content = _signed_content(ssv)
    raw = ssv.private.sign(content.encode(), ec.ECDSA(hashes.SHA256()))
    signature = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    res = await ssv.client.get(f"/v1/ads/admob/ssv?{content}&signature={signature}&key_id=1&extra=1")
    assert res.status_code == 200
    assert await _event(ssv, _transaction(content)) is None


async def test_a_callback_signed_by_an_unknown_key_id_is_refused(ssv):
    content = _signed_content(ssv)
    assert (await _call(ssv, _sign_callback(ssv, content, key_id="99"))).status_code == 200
    assert await _event(ssv, _transaction(content)) is None


# --------------------------------------------------------------------------------------------------
# Ad placements in the console
# --------------------------------------------------------------------------------------------------


def _placement(**kw) -> dict:
    body = {
        "name": "Rewarded unlock",
        "slot": "unlock_rewarded",
        "provider": "admob",
        "unit_id": f"ca-app-pub-{uuid.uuid4().int % 10**16:016d}/{uuid.uuid4().int % 10**10:010d}",
        "platforms": ["android", "web"],
        "reward_coins": 10,
        "frequency_cap_sec": 300,
        "is_active": True,
        "sort_order": 0,
    }
    body.update(kw)
    return body


async def _audit(world, target_id: str) -> list[AuditLog]:
    async with world.maker() as s:
        return list(
            (
                await s.scalars(select(AuditLog).where(AuditLog.target_id == target_id).order_by(AuditLog.created_at))
            ).all()
        )


async def test_a_placement_is_created_updated_and_deleted_with_an_audit_trail(api, world):
    """Turning a placement on is a money decision, so the log carries what changed, not just that it did."""
    created = await api.post("/v1/admin/ad-placements", json=_placement())
    assert created.status_code == 201, created.text
    row = created.json()
    assert row["platforms"] == ["android", "web"], "stored in a fixed order so two equal rows compare equal"
    assert row["reward_coins"] == 10
    assert row["created_at"] and row["updated_at"]

    updated = await api.put(
        f"/v1/admin/ad-placements/{row['id']}", json=_placement(unit_id=row["unit_id"], is_active=False, name="Paused")
    )
    assert updated.status_code == 200
    assert updated.json()["is_active"] is False and updated.json()["name"] == "Paused"

    entries = await _audit(world, row["id"])
    assert [e.action for e in entries] == ["ad_placement.create", "ad_placement.update"]
    assert entries[1].before["is_active"] is True and entries[1].after["is_active"] is False
    assert entries[1].admin_email == world.admin.email

    gone = await api.delete(f"/v1/admin/ad-placements/{row['id']}")
    assert gone.status_code == 200
    assert [e.action for e in await _audit(world, row["id"])][-1] == "ad_placement.delete"
    async with world.maker() as s:
        assert await s.get(AdPlacement, uuid.UUID(row["id"])) is None


async def test_the_list_counts_every_row_even_when_it_is_filtered(api):
    """`total` and `active` are a health figure — "are we showing ads at all?" — not a subtotal of the page."""
    live = (await api.post("/v1/admin/ad-placements", json=_placement(slot="unlock_rewarded"))).json()
    banner = (await api.post("/v1/admin/ad-placements", json=_placement(slot="home_rail", is_active=False))).json()

    everything = (await api.get("/v1/admin/ad-placements")).json()
    ids = {p["id"] for p in everything["items"]}
    assert {live["id"], banner["id"]} <= ids
    assert everything["total"] == len(everything["items"])

    filtered = (await api.get("/v1/admin/ad-placements?slot=home_rail")).json()
    assert {p["id"] for p in filtered["items"]} >= {banner["id"]}
    assert live["id"] not in {p["id"] for p in filtered["items"]}
    assert filtered["total"] == everything["total"], "the counts are over the table, not the filtered view"
    assert filtered["active"] == everything["active"]

    active_only = (await api.get("/v1/admin/ad-placements?active_only=true")).json()
    assert live["id"] in {p["id"] for p in active_only["items"]}
    assert banner["id"] not in {p["id"] for p in active_only["items"]}


async def test_a_reward_does_not_survive_a_change_to_a_slot_that_cannot_pay_it(api):
    created = (await api.post("/v1/admin/ad-placements", json=_placement())).json()
    assert created["reward_coins"] == 10
    moved = await api.put(
        f"/v1/admin/ad-placements/{created['id']}",
        json=_placement(unit_id=created["unit_id"], slot="player_pre", reward_coins=25),
    )
    assert moved.status_code == 200
    assert moved.json()["reward_coins"] is None, "a payout left behind by changing the slot is nobody's intention"


async def test_moving_a_unit_onto_another_rows_slot_is_a_conflict(api):
    first = (await api.post("/v1/admin/ad-placements", json=_placement())).json()
    second = (await api.post("/v1/admin/ad-placements", json=_placement())).json()

    clash = await api.put(f"/v1/admin/ad-placements/{second['id']}", json=_placement(unit_id=first["unit_id"]))
    assert clash.status_code == 409
    assert clash.json()["detail"]["code"] == "placement_exists"

    # Saving a row over itself with the same unit is not a conflict with itself.
    same = await api.put(f"/v1/admin/ad-placements/{second['id']}", json=_placement(unit_id=second["unit_id"]))
    assert same.status_code == 200


async def test_editing_a_placement_that_is_gone_is_a_404(api):
    missing = uuid.uuid4()
    assert (await api.put(f"/v1/admin/ad-placements/{missing}", json=_placement())).status_code == 404
    assert (await api.delete(f"/v1/admin/ad-placements/{missing}")).status_code == 404


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("slot", "interstitial_everywhere"),
        ("provider", "some-network"),
        ("platforms", ["android", "tizen"]),
        ("platforms", []),
    ],
)
async def test_a_placement_no_client_could_render_is_refused_at_the_edge(api, field, value):
    """Slot, provider and platform are a closed set shared with the console and the clients.

    An empty platform list is the one worth spelling out: it is a row that can never be served, and storing it
    turns "the placement is live" into something that quietly means nothing.
    """
    r = await api.post("/v1/admin/ad-placements", json=_placement(**{field: value}))
    assert r.status_code == 422, r.text


async def test_an_editor_cannot_change_where_ads_run(world):
    """Ad placements are a finance decision; an editor account may not turn one on."""
    async with world.maker() as s:
        editor = AdminUser(
            email=f"{uuid.uuid4().hex[:10]}@katha-test.dev",
            display_name="Editor",
            password_hash="x",
            role=AdminRole.editor,
            is_active=True,
        )
        s.add(editor)
        await s.commit()

    _install(world.maker, admin=editor)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.post("/v1/admin/ad-placements", json=_placement())).status_code == 403
        # Reading the screen is still allowed: the refusal is about changing what runs, not about looking.
        assert (await c.get("/v1/admin/ad-placements")).status_code == 200
    _uninstall()


# --------------------------------------------------------------------------------------------------
# Push
# --------------------------------------------------------------------------------------------------


def test_a_channel_is_on_unless_the_viewer_turned_it_off():
    user = _user()
    assert push.wants(user, "new_episode") is True
    user.notification_prefs = {"new_episode": False, "offer": True}
    assert push.wants(user, "new_episode") is False
    assert push.wants(user, "offer") is True
    # Purchase confirmations are not marketing and have no opt-out to respect.
    assert push.wants(user, "transactional") is True


def test_only_an_expo_token_is_a_token():
    assert push.is_expo_token("ExponentPushToken[abc]") is True
    assert push.is_expo_token("ExpoPushToken[abc]") is True
    assert push.is_expo_token("fcm-raw-token") is False
    assert push.is_expo_token(None) is False


async def test_only_live_sessions_of_active_accounts_are_eligible(world):
    """Delivery eligibility is decided in one place: a real token, a live session, an active account, opted in."""
    token = f"ExponentPushToken[{uuid.uuid4().hex[:12]}]"
    async with world.maker() as s:
        opted_out = _user(notification_prefs={"new_episode": False})
        banned = _user(status=UserStatus.banned)
        s.add_all([opted_out, banned])
        await s.flush()
        s.add_all(
            [
                # Two live sessions of the same device: the token must not be sent twice.
                _session_row(world.user.id, push_token=token),
                _session_row(world.user.id, push_token=token),
                _session_row(world.user.id, push_token="fcm-raw-token"),
                _session_row(
                    world.user.id, push_token=f"ExponentPushToken[{uuid.uuid4().hex[:8]}]", revoked_at=datetime.now(UTC)
                ),
                _session_row(
                    world.user.id,
                    push_token=f"ExponentPushToken[{uuid.uuid4().hex[:8]}]",
                    expires_at=datetime.now(UTC) - timedelta(days=1),
                ),
                _session_row(opted_out.id, push_token=f"ExponentPushToken[{uuid.uuid4().hex[:8]}]"),
                _session_row(banned.id, push_token=f"ExponentPushToken[{uuid.uuid4().hex[:8]}]"),
            ]
        )
        await s.commit()

        by_user = await push.tokens_for(s, [world.user.id, opted_out.id, banned.id], "new_episode")
        assert by_user == {world.user.id: [token]}

        # The same viewer on a channel they did not silence is reachable again.
        other_channel = await push.tokens_for(s, [opted_out.id], "offer")
        assert list(other_channel) == [opted_out.id]

        assert await push.tokens_for(s, [], "new_episode") == {}


class _FakeExpo:
    """Expo's HTTP surface, faked. No test in this file may reach a real push service."""

    def __init__(self, *, tickets=None, status_code: int = 200, raises: Exception | None = None):
        self.tickets = tickets if tickets is not None else []
        self.status_code = status_code
        self.raises = raises
        self.calls: list[tuple] = []

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None, headers=None):
        self.calls.append((url, json, headers))
        if self.raises:
            raise self.raises
        tickets = self.tickets[: len(json)] if isinstance(self.tickets, list) else self.tickets
        return httpx.Response(self.status_code, json={"data": tickets})


async def test_nothing_to_send_makes_no_request(monkeypatch):
    expo = _FakeExpo()
    monkeypatch.setattr(push.httpx, "AsyncClient", expo)
    result = await push.send([])
    assert (result.delivered, result.failed) == (0, 0)
    assert expo.calls == []


async def test_a_send_reports_what_landed_and_what_is_dead(monkeypatch):
    expo = _FakeExpo(
        tickets=[
            {"status": "ok"},
            {"status": "error", "details": {"error": "DeviceNotRegistered"}},
            {"status": "error", "details": {"error": "MessageRateExceeded"}},
        ]
    )
    monkeypatch.setattr(push.httpx, "AsyncClient", expo)
    monkeypatch.setattr(get_settings(), "expo_access_token", "expo-secret")

    messages = [push.Message(token=f"ExponentPushToken[{i}]", title="T", body="B") for i in range(3)]
    result = await push.send(messages)
    assert result.delivered == 1
    assert result.failed == 2
    assert result.dead_tokens == ["ExponentPushToken[1]"], "only a dead device is worth unregistering"

    url, payload, headers = expo.calls[0]
    assert url == get_settings().expo_push_url
    assert headers["authorization"] == "Bearer expo-secret"
    assert payload[0]["to"] == "ExponentPushToken[0]"
    assert payload[0]["priority"] == "high"


async def test_expo_refusing_the_batch_fails_it_without_raising(monkeypatch):
    """A push failure must never roll back the work that triggered it."""
    monkeypatch.setattr(push.httpx, "AsyncClient", _FakeExpo(status_code=502))
    result = await push.send([push.Message(token="ExponentPushToken[a]", title="T", body="B")])
    assert (result.delivered, result.failed, result.dead_tokens) == (0, 1, [])


async def test_a_transport_error_fails_the_batch_without_raising(monkeypatch):
    monkeypatch.setattr(push.httpx, "AsyncClient", _FakeExpo(raises=httpx.ConnectTimeout("expo is slow")))
    result = await push.send([push.Message(token="ExponentPushToken[a]", title="T", body="B")])
    assert (result.delivered, result.failed) == (0, 1)


async def test_fewer_tickets_than_messages_counts_the_remainder_as_failed(monkeypatch):
    monkeypatch.setattr(push.httpx, "AsyncClient", _FakeExpo(tickets=[{"status": "ok"}]))
    messages = [push.Message(token=f"ExponentPushToken[{i}]", title="T", body="B") for i in range(3)]
    result = await push.send(messages)
    assert result.delivered == 1
    assert result.failed == 2, "a message Expo said nothing about was not delivered"


async def test_a_large_audience_is_sent_in_expo_sized_batches(monkeypatch):
    expo = _FakeExpo(tickets=[{"status": "ok"}] * push.EXPO_BATCH)
    monkeypatch.setattr(push.httpx, "AsyncClient", expo)
    messages = [push.Message(token=f"ExponentPushToken[{i}]", title="T", body="B") for i in range(105)]
    result = await push.send(messages)
    assert len(expo.calls) == 2
    assert len(expo.calls[0][1]) == push.EXPO_BATCH and len(expo.calls[1][1]) == 5
    assert result.delivered == 105


async def test_delivering_prunes_the_tokens_expo_says_are_dead(world, monkeypatch):
    """A service that keeps retrying dead tokens quietly loses its sending reputation."""
    dead = f"ExponentPushToken[{uuid.uuid4().hex[:12]}]"
    async with world.maker() as s:
        receiver = _user()
        s.add(receiver)
        await s.flush()
        s.add(_session_row(receiver.id, push_token=dead))
        await s.commit()
        user_id = receiver.id

    expo = _FakeExpo(tickets=[{"status": "error", "details": {"error": "DeviceNotRegistered"}}])
    monkeypatch.setattr(push.httpx, "AsyncClient", expo)
    monkeypatch.setattr(get_settings(), "expo_access_token", None)

    async with world.maker() as s:
        result = await push.deliver(
            s, user_ids=[user_id], channel="new_episode", title="New episode", body="Tonight", data={"series": "x"}
        )
        await s.commit()
    assert result.dead_tokens == [dead]
    # The payload carries the channel, which is what an opened notification is attributed to.
    assert expo.calls[0][1][0]["data"]["channel"] == "new_episode"
    assert "authorization" not in expo.calls[0][2]

    async with world.maker() as s:
        rows = (await s.scalars(select(Session).where(Session.user_id == user_id))).all()
        assert [r.push_token for r in rows] == [None]


async def test_clearing_no_tokens_is_a_no_op(world):
    async with world.maker() as s:
        assert await push.clear_dead_tokens(s, []) is None


async def test_registering_a_device_puts_the_token_on_the_session(api, world):
    token = f"ExponentPushToken[{uuid.uuid4().hex[:12]}]"
    ok = await api.put("/v1/auth/me/push-token", json={"token": token})
    assert ok.status_code == 200
    async with world.maker() as s:
        assert (await s.get(Session, world.session_row.id)).push_token == token

    cleared = await api.delete("/v1/auth/me/push-token")
    assert cleared.status_code == 200
    async with world.maker() as s:
        assert (await s.get(Session, world.session_row.id)).push_token is None


async def test_a_token_expo_cannot_deliver_to_is_refused_at_registration(api, world):
    """A raw FCM token stored here is a device that silently never receives anything."""
    r = await api.put("/v1/auth/me/push-token", json={"token": "fcm-raw-token-value"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "bad_push_token"
    async with world.maker() as s:
        assert (await s.get(Session, world.session_row.id)).push_token is None


async def test_a_revoked_session_cannot_register_for_push(world):
    async with world.maker() as s:
        revoked = _session_row(world.user.id, revoked_at=datetime.now(UTC))
        s.add(revoked)
        await s.commit()
        session_id = revoked.id

    _install(world.maker, ctx=deps.AuthContext(user=world.user, session_id=session_id))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.put("/v1/auth/me/push-token", json={"token": f"ExponentPushToken[{uuid.uuid4().hex[:8]}]"})
        assert r.status_code == 401
    _uninstall()


# --------------------------------------------------------------------------------------------------
# Remote config
# --------------------------------------------------------------------------------------------------


async def test_a_namespace_merges_saved_values_over_the_defaults(world):
    async with world.maker() as s:
        auth = await config_svc.namespace(s, "auth")
        assert auth["email"] is True and auth["facebook"] is False

        # An unknown namespace has no defaults to merge, and is not an error.
        assert await config_svc.namespace(s, f"nothing-{uuid.uuid4().hex[:6]}") == {}


def test_a_secret_saved_anywhere_in_a_namespace_is_found():
    """Settings are served to clients, so a secret saved here is a secret published."""
    found = config_svc.find_secret_keys(
        {
            "site": {"name": "Katha"},
            "stripe": {"secret_key": "sk_live_x", "public_key": "pk_live_x"},
            "tokens": [{"api_token": "t"}],
        }
    )
    assert "stripe.secret_key" in found
    assert "tokens[0].api_token" in found
    assert "stripe.public_key" not in found, "a publishable key is exactly what belongs here"
    assert "site.name" not in found


def test_the_numbers_the_economy_reads_are_validated_before_they_are_saved():
    """Every one of these is read with `int(...)` on an unlock or a sign-up; a bad save used to be a 500 later."""
    assert config_svc.validate_namespace_values("economy", {"episode_price": 50, "free_episodes": 5}) == []
    assert config_svc.validate_namespace_values("economy", {"episode_price": None}) == []
    assert config_svc.validate_namespace_values("economy", {"episode_price": "50"}) == [
        "episode_price must be a whole number between 0 and 100000"
    ]
    assert config_svc.validate_namespace_values("economy", {"free_episodes": -1}) != []
    # True is an int in Python and is not a price.
    assert config_svc.validate_namespace_values("economy", {"episode_price": True}) != []
    assert config_svc.validate_namespace_values("rewards", {"daily_rewards": [10, 15, 20]}) == []
    assert config_svc.validate_namespace_values("rewards", {"daily_rewards": []}) != []
    assert config_svc.validate_namespace_values("rewards", {"daily_rewards": [1] * 40}) != []
    assert config_svc.validate_namespace_values("rewards", {"daily_rewards": "10,15"}) != []
    assert config_svc.validate_namespace_values("rewards", {"daily_rewards": None}) == []
    assert config_svc.validate_namespace_values(f"unknown-{uuid.uuid4().hex[:4]}", {"anything": "goes"}) == []


@pytest.fixture
async def economy_row(world):
    """Takes the `economy` namespace over for one test and puts back whatever was there."""
    async with world.maker() as s:
        existing = await s.get(Setting, "economy")
        previous = dict(existing.data) if existing else None
        if existing is None:
            s.add(Setting(namespace="economy", data={"episode_price": 77}, updated_at=datetime.now(UTC)))
        else:
            existing.data = {"episode_price": 77}
        await s.commit()
    yield
    async with world.maker() as s:
        row = await s.get(Setting, "economy")
        if previous is None:
            await s.delete(row)
        else:
            row.data = previous
        await s.commit()


async def test_a_saved_value_wins_and_the_rest_fall_back_to_the_deployments_defaults(world, economy_row, monkeypatch):
    monkeypatch.setattr(get_settings(), "default_free_episodes", 3)
    async with world.maker() as s:
        built = await config_svc.build(s, user_id=None, platform="web")
    assert built["economy"]["episode_price"] == 77, "what an operator saved is what the client gets"
    assert built["economy"]["free_episodes"] == 3, "a key nobody saved falls back to the deployment default"
    assert built["economy"]["currency"] == "INR"


async def test_referral_coins_resolve_from_one_place(world, monkeypatch):
    monkeypatch.setattr(get_settings(), "default_referral_reward_coins", 111)
    monkeypatch.setattr(get_settings(), "default_referee_reward_coins", 22)
    async with world.maker() as s:
        assert await config_svc.referral_reward_coins(s) == 111
        assert await config_svc.referee_reward_coins(s) == 22


async def test_android_is_offered_play_alone_when_play_billing_is_configured(world, monkeypatch):
    """Selling digital content any other way on Android is what gets a build rejected."""
    s_ = get_settings()
    monkeypatch.setattr(s_, "google_play_package_name", "com.katha.app")
    monkeypatch.setattr(s_, "google_play_service_account_file", "/tmp/sa.json")
    monkeypatch.setattr(s_, "razorpay_key_id", "rzp_test")
    monkeypatch.setattr(s_, "razorpay_key_secret", "rzp_secret")
    monkeypatch.setattr(s_, "stripe_secret_key", "sk_test")

    async with world.maker() as s:
        android = await config_svc.build(s, user_id=None, platform="android")
        web = await config_svc.build(s, user_id=None, platform="web")
    assert android["payments"]["gateways"] == ["play"]
    assert web["payments"]["gateways"] == ["razorpay", "stripe"]


async def test_a_gateway_that_is_not_configured_is_never_offered(world, monkeypatch):
    s_ = get_settings()
    monkeypatch.setattr(s_, "google_play_package_name", None)
    monkeypatch.setattr(s_, "razorpay_key_id", None)
    monkeypatch.setattr(s_, "razorpay_key_secret", None)
    monkeypatch.setattr(s_, "stripe_secret_key", "sk_test")
    async with world.maker() as s:
        built = await config_svc.build(s, user_id=None, platform="android")
    assert built["payments"]["gateways"] == ["stripe"], "an unconfigured gateway must not reach a client"


async def test_the_firebase_block_is_absent_until_it_is_usable(world, monkeypatch):
    s_ = get_settings()
    monkeypatch.setattr(s_, "firebase_web_api_key", None)
    async with world.maker() as s:
        assert (await config_svc.build(s, user_id=None, platform="web"))["firebase"] is None

    monkeypatch.setattr(s_, "firebase_web_api_key", "AIza-test")
    monkeypatch.setattr(s_, "firebase_web_auth_domain", "katha.firebaseapp.com")
    async with world.maker() as s:
        firebase = (await config_svc.build(s, user_id=None, platform="web"))["firebase"]
    assert firebase["api_key"] == "AIza-test" and firebase["auth_domain"] == "katha.firebaseapp.com"


async def test_the_notification_channels_a_client_may_offer_come_from_the_server(world):
    async with world.maker() as s:
        built = await config_svc.build(s, user_id=None, platform="web")
    assert built["notifications"]["channels"] == list(push.CHANNELS)
    assert "transactional" not in built["notifications"]["channels"]


async def test_an_experiment_assignment_is_made_once_and_then_reused(world):
    key = f"exp-{uuid.uuid4().hex[:8]}"
    async with world.maker() as s:
        s.add(
            Experiment(
                key=key,
                variants={"control": {}, "b": {}},
                allocation={"control": 50, "b": 50},
                started_at=datetime.now(UTC) - timedelta(days=1),
            )
        )
        await s.commit()

    async with world.maker() as s:
        first = await config_svc.variant_map(s, world.user.id)
        await s.commit()
    assert first[key] in {"control", "b"}

    async with world.maker() as s:
        rows = (
            await s.scalars(
                select(ExperimentAssignment).where(
                    ExperimentAssignment.user_id == world.user.id, ExperimentAssignment.experiment_key == key
                )
            )
        ).all()
        assert len(rows) == 1, "assignment is sticky: one row, written once"
        second = await config_svc.variant_map(s, world.user.id)
    assert second[key] == first[key]


async def test_a_finished_experiment_assigns_nobody(world):
    key = f"exp-{uuid.uuid4().hex[:8]}"
    async with world.maker() as s:
        s.add(
            Experiment(
                key=key,
                variants={"control": {}},
                allocation={"control": 100},
                started_at=datetime.now(UTC) - timedelta(days=10),
                ended_at=datetime.now(UTC) - timedelta(days=1),
            )
        )
        await s.commit()
        assert key not in await config_svc.variant_map(s, world.user.id)


async def test_when_nothing_is_running_nobody_is_assigned(world):
    """Parked inside a transaction that is rolled back, so the assertion is about an empty experiment set
    rather than about whatever else the shared test database happens to hold."""
    async with world.maker() as s:
        await s.execute(update(Experiment).values(started_at=None))
        assert await config_svc.variant_map(s, world.user.id) == {}
        await s.rollback()


async def test_a_guest_is_in_no_experiment(world):
    async with world.maker() as s:
        assert await config_svc.variant_map(s, None) == {}


async def test_active_placements_reach_only_the_platform_they_were_enabled_for(api, world):
    """Leaving the filtering to the client is how a placement goes live somewhere it was never enabled."""
    created = (await api.post("/v1/admin/ad-placements", json=_placement(platforms=["android"]))).json()

    android = await api.get("/v1/config", headers={"X-Katha-Platform": "android"})
    assert android.status_code == 200
    ads = android.json()["ads"]
    assert ads["enabled"] is True
    mine = [p for p in ads["placements"] if p["id"] == created["id"]]
    assert len(mine) == 1
    assert mine[0]["reward_coins"] == 10 and mine[0]["frequency_cap_sec"] == 300
    assert mine[0]["unit_id"] == created["unit_id"]

    web = await api.get("/v1/config", headers={"X-Katha-Platform": "web"})
    assert created["id"] not in {p["id"] for p in web.json()["ads"]["placements"]}


async def test_config_carries_no_playback_url_and_no_secret(api, world):
    r = await api.get("/v1/config", headers={"X-Katha-Platform": "android"})
    assert r.status_code == 200
    body = r.json()
    assert "m3u8" not in r.text
    # Everything in /v1/config is published to every client. The scanner's own reading of this payload is that
    # the only credential-shaped key in it is the Turnstile *site* key, which is public by design and is the
    # one name the "public" exemption does not cover.
    assert config_svc.find_secret_keys(body) == ["site.captcha_site_key"]
    assert body["platform"] == "android"
    assert isinstance(body["flags"], dict)
    assert isinstance(body["languages"], list)


async def test_an_experiment_variant_reaches_the_signed_in_client(api, world):
    key = f"exp-{uuid.uuid4().hex[:8]}"
    async with world.maker() as s:
        s.add(
            Experiment(
                key=key,
                variants={"control": {}},
                allocation={"control": 100},
                started_at=datetime.now(UTC) - timedelta(hours=1),
            )
        )
        await s.commit()

    r = await api.get("/v1/config")
    assert r.status_code == 200
    assert r.json()["variants"][key] == "control"
    # The assignment is persisted by the endpoint's own commit, not left in a rolled-back session.
    async with world.maker() as s:
        stored = await s.get(ExperimentAssignment, (world.user.id, key))
        assert stored is not None and stored.variant == "control"


async def test_a_guests_config_has_no_variants(guest):
    r = await guest.get("/v1/config")
    assert r.status_code == 200
    assert r.json()["variants"] == {}
