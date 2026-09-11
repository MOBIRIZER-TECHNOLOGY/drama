"""The admin console's AI actions and its landing dashboard, exercised as requests.

`app/api/routers/admin_ai.py` and `app/api/routers/admin_dashboard.py` were the last two files in the package
with real gaps. Both are hard to reach from a plain unit test: the AI router talks to an optional package that
is not installed here, to a Redis-backed arq queue and to object storage, and the dashboard is one long
function of aggregate SQL whose only meaningful output is a number that depends on what is in the database.

So both boundaries are faked at the edge and nothing leaves the process: `katha_ai` is injected into
`sys.modules`, the arq pool is a small object that records what was enqueued, `arq.jobs.Job` is replaced with
a stub that reports the state we want to see, and `storage.get_object_text` reads from a dict.

What is asserted is behaviour:

* metadata generation is refused with a 503 when the AI package is absent, returns the graph's draft when it
  is present, and turns a slow or broken provider into a 504/502 that says nothing about the provider;
* every arq state maps to the status word the console renders, including the two that are not a simple
  translation — a finished job whose result has aged out of Redis reads as `running`, and a non-dict result is
  wrapped rather than dropped;
* a queued action deletes the stale result key (so pressing the button again re-runs a finished job) but is
  still refused with a 409 while a run is genuinely in flight;
* the AI router is editor-or-owner, while the dashboard is open to support and finance too;
* the transcript endpoint skips what it cannot read instead of failing, clamps its episode window, and caps
  its output;
* every dashboard metric counts the window it claims to, the previous window is the one immediately before it,
  and the daily buckets are cut in the product timezone rather than in UTC.

The test database is shared and never truncated, so the dashboard assertions are deltas around a baseline
reading rather than absolute numbers: a seeded row that should move a figure by three must move it by exactly
three, and a row placed outside the window must not move it at all.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import os
import sys
import types
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import arq.jobs
import pytest
from arq.constants import result_key_prefix
from arq.jobs import JobStatus
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import deps
from app.core.config import get_settings
from app.core.db import get_session
from app.main import app
from app.models.catalog import (
    AssetStatus,
    Episode,
    PublishStatus,
    Series,
    SeriesTranslation,
    Subtitle,
    VideoAsset,
)
from app.models.identity import AdminRole, AdminUser, User
from app.models.wallet import (
    CoinLedger,
    CoinPack,
    EpisodeUnlock,
    LedgerKind,
    PackKind,
    Purchase,
    PurchaseStatus,
    UnlockMethod,
)
from app.services import jobs, storage

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")


def _tok(n: int = 8) -> str:
    return uuid.uuid4().hex[:n]


def _new_admin(role: AdminRole) -> AdminUser:
    return AdminUser(
        email=f"{_tok(10)}@katha-test.dev",
        display_name=f"Test {role.value}",
        password_hash="x",
        role=role,
        is_active=True,
    )


def _new_user(**over) -> User:
    """A user row unique on every column the database has an index on.

    `referral_code` is the full 32-hex uuid truncated to the column's 16 characters, not to 8: the shared test
    database has enough rows that an 8-character code collides between runs.
    """
    row = {"public_id": _tok(12), "referral_code": uuid.uuid4().hex[:16].upper()}
    row.update(over)
    return User(**row)


@dataclass
class Env:
    client: AsyncClient
    maker: Any
    owner: AdminUser
    acting: dict

    async def act_as(self, role: AdminRole) -> AdminUser:
        admin = _new_admin(role)
        async with self.maker() as s:
            s.add(admin)
            await s.commit()
        self.acting["admin"] = admin
        return admin

    def act_as_owner(self) -> None:
        self.acting["admin"] = self.owner


@pytest.fixture
async def env():
    """Auth is bypassed and the app points at the test database; these tests are about the handlers."""
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    owner = _new_admin(AdminRole.owner)
    async with maker() as s:
        s.add(owner)
        await s.commit()

    acting = {"admin": owner}

    async def _session():
        async with maker() as s:
            yield s

    app.dependency_overrides[deps.current_admin] = lambda: acting["admin"]
    app.dependency_overrides[get_session] = _session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield Env(client=c, maker=maker, owner=owner, acting=acting)
    app.dependency_overrides.pop(deps.current_admin, None)
    app.dependency_overrides.pop(get_session, None)
    await engine.dispose()


# =====================================================================================================
# Boundary fakes: the AI package, the arq pool, an arq job, and object storage.
# =====================================================================================================


def _install_fake_ai(monkeypatch, generate) -> None:
    """Put a `katha_ai.graphs.metadata` in `sys.modules` so the handler's deferred import finds one.

    `from a.b.c import d` consults `sys.modules['a.b.c']` before it goes looking for a file, so three module
    objects are enough. `monkeypatch.setitem` takes them back out again after the test.
    """
    metadata = types.ModuleType("katha_ai.graphs.metadata")
    metadata.generate_metadata = generate
    graphs = types.ModuleType("katha_ai.graphs")
    graphs.metadata = metadata
    root = types.ModuleType("katha_ai")
    root.graphs = graphs
    monkeypatch.setitem(sys.modules, "katha_ai", root)
    monkeypatch.setitem(sys.modules, "katha_ai.graphs", graphs)
    monkeypatch.setitem(sys.modules, "katha_ai.graphs.metadata", metadata)


class _FakePool:
    """Stands in for the arq Redis pool. Records the calls `app.services.jobs` makes against it."""

    def __init__(self, *, refuse: bool = False):
        self.refuse = refuse
        self.deleted: list[str] = []
        self.enqueued: list[tuple] = []

    async def delete(self, key: str) -> int:
        self.deleted.append(key)
        return 1

    async def enqueue_job(self, name: str, *args, _job_id: str | None = None, **kwargs):
        self.enqueued.append((name, args, _job_id, kwargs))
        if self.refuse:
            return None  # arq's answer when the id is already taken by a live job
        return types.SimpleNamespace(job_id=_job_id)


def _use_pool(monkeypatch, pool: _FakePool) -> _FakePool:
    async def _queue():
        return pool

    monkeypatch.setattr(jobs, "queue", _queue)
    return pool


class _FakeInfo:
    """The shape of `arq.jobs.JobResult` that the handler actually reads."""

    def __init__(self, success: bool, result: Any):
        self.success = success
        self.result = result


def _use_job(monkeypatch, status: JobStatus, info: _FakeInfo | None) -> dict:
    """Replace `arq.jobs.Job` with a stub reporting `status`/`info`, and record how it was constructed."""
    seen: dict = {}

    class _FakeJob:
        def __init__(self, job_id, pool):
            seen["job_id"] = job_id
            seen["pool"] = pool

        async def status(self):
            return status

        async def result_info(self):
            return info

    monkeypatch.setattr(arq.jobs, "Job", _FakeJob)
    return seen


# =====================================================================================================
# admin_ai: metadata generation
# =====================================================================================================


async def test_metadata_is_a_503_when_the_ai_package_is_not_installed(env: Env):
    """`katha_ai` is an optional dependency; the API deployment that lacks it must say so, not 500."""
    assert "katha_ai" not in sys.modules, "this assertion is only meaningful while the package is absent"
    res = await env.client.post("/v1/admin/ai/series-metadata", json={"seed": "A courier falls for a thief."})
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "ai_unavailable"
    assert res.json()["detail"]["message"] == "AI features are not installed on this API"


async def test_metadata_hands_the_seed_to_the_graph_and_returns_its_draft(env: Env, monkeypatch):
    """Everything the editor typed reaches the graph, and the whole draft comes back for human approval."""
    calls: list[dict] = []
    draft = {
        "title": "Night Courier",
        "synopsis": "A courier falls for the thief she is chasing.",
        "genres": ["romance", "thriller"],
        "tags": ["slow burn"],
        "seo_title": "Night Courier - watch free",
        "meta_description": "A courier falls for a thief.",
        "keywords": ["courier", "thief"],
        "slug": "night-courier",
        "content_rating": "UA13",
        "moderation_flags": ["violence"],
        "confidence": 0.82,
    }

    async def generate(**kwargs):
        calls.append(kwargs)
        return draft

    _install_fake_ai(monkeypatch, generate)

    res = await env.client.post(
        "/v1/admin/ai/series-metadata",
        json={
            "seed": "A courier falls for a thief.",
            "language": "Hindi",
            "title": "Working title",
            "synopsis": "Old synopsis",
            "transcript": "EP1: hello",
        },
    )
    assert res.status_code == 200, res.text
    assert res.json() == draft

    assert calls == [
        {
            "seed": "A courier falls for a thief.",
            "language": "Hindi",
            "title": "Working title",
            "synopsis": "Old synopsis",
            "transcript": "EP1: hello",
        }
    ], "the optional fields are passed through, not dropped"


async def test_a_slow_or_broken_provider_is_translated_and_never_described(env: Env, monkeypatch):
    """The provider's own message can carry prompt text and key ids, so the browser gets a generic one."""

    async def times_out(**kwargs):
        raise TimeoutError

    _install_fake_ai(monkeypatch, times_out)
    slow = await env.client.post("/v1/admin/ai/series-metadata", json={"seed": "A long seed to summarise"})
    assert slow.status_code == 504
    assert slow.json()["detail"]["code"] == "ai_timeout"
    assert slow.json()["detail"]["message"] == "Generation timed out, try a shorter seed"

    async def explodes(**kwargs):
        raise RuntimeError("anthropic: 401 invalid x-api-key sk-ant-secret")

    _install_fake_ai(monkeypatch, explodes)
    broken = await env.client.post("/v1/admin/ai/series-metadata", json={"seed": "A long seed to summarise"})
    assert broken.status_code == 502
    assert broken.json()["detail"]["code"] == "ai_error"
    assert broken.json()["detail"]["message"] == "The AI provider returned an error"
    assert "sk-ant-secret" not in broken.text


# =====================================================================================================
# admin_ai: job status
# =====================================================================================================


async def test_an_unknown_job_id_is_reported_rather_than_404(env: Env, monkeypatch):
    """arq forgets a job an hour after it finishes; the console needs a status word, not an error page."""
    pool = _use_pool(monkeypatch, _FakePool())
    seen = _use_job(monkeypatch, JobStatus.not_found, None)

    res = await env.client.get("/v1/admin/ai/jobs/embed:whatever")
    assert res.status_code == 200
    assert res.json() == {"job_id": "embed:whatever", "status": "not_found", "result": None, "error": None}
    # The job is looked up on the shared queue, with the id straight from the path.
    assert seen == {"job_id": "embed:whatever", "pool": pool}


@pytest.mark.parametrize(
    ("arq_status", "reported"),
    [
        (JobStatus.deferred, "queued"),
        (JobStatus.queued, "queued"),
        (JobStatus.in_progress, "running"),
    ],
)
async def test_a_live_job_reports_queued_or_running(env: Env, monkeypatch, arq_status, reported):
    """Deferred and queued are one word to an operator; only a worker actually holding the job is 'running'."""
    _use_pool(monkeypatch, _FakePool())
    _use_job(monkeypatch, arq_status, _FakeInfo(True, {"never": "read"}))

    res = await env.client.get("/v1/admin/ai/jobs/subtitles:1")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == reported
    assert body["result"] is None and body["error"] is None, "a job that has not finished has no result to show"


async def test_a_finished_job_returns_its_result_and_wraps_a_non_mapping(env: Env, monkeypatch):
    """`result` is typed as an object, so a worker that returned a bare value must still be renderable."""
    _use_pool(monkeypatch, _FakePool())
    _use_job(monkeypatch, JobStatus.complete, _FakeInfo(True, {"languages": ["ta", "te"], "written": 12}))
    mapping = await env.client.get("/v1/admin/ai/jobs/series-translate:1")
    assert mapping.status_code == 200
    assert mapping.json() == {
        "job_id": "series-translate:1",
        "status": "complete",
        "result": {"languages": ["ta", "te"], "written": 12},
        "error": None,
    }

    _use_job(monkeypatch, JobStatus.complete, _FakeInfo(True, 42))
    scalar = await env.client.get("/v1/admin/ai/jobs/reembed-all")
    assert scalar.json()["status"] == "complete"
    assert scalar.json()["result"] == {"value": 42}, "a bare return value is wrapped rather than discarded"

    _use_job(monkeypatch, JobStatus.complete, _FakeInfo(True, None))
    nothing = await env.client.get("/v1/admin/ai/jobs/reembed-all")
    assert nothing.json()["result"] == {"value": None}, "a worker returning None still completed"


async def test_a_failed_job_reports_a_truncated_error(env: Env, monkeypatch):
    """A traceback repr can be megabytes; the status row keeps the first 500 characters of it."""
    _use_pool(monkeypatch, _FakePool())
    _use_job(monkeypatch, JobStatus.complete, _FakeInfo(False, RuntimeError("boom " * 200)))

    res = await env.client.get("/v1/admin/ai/jobs/subtitles:9")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "failed"
    assert body["result"] is None
    assert len(body["error"]) == 500
    assert body["error"] == str(RuntimeError("boom " * 200))[:500]
    assert body["error"].startswith("boom boom ")


async def test_a_finished_job_whose_result_expired_reads_as_running(env: Env, monkeypatch):
    """arq drops the result key an hour after the run while the job key lingers.

    Reporting 'complete' with no result would leave the console claiming success it cannot show, so the
    handler falls back to 'running' — pinned here because it is the one status word that is not a translation
    of what arq said.
    """
    _use_pool(monkeypatch, _FakePool())
    _use_job(monkeypatch, JobStatus.complete, None)

    res = await env.client.get("/v1/admin/ai/jobs/embed:gone")
    assert res.status_code == 200
    assert res.json() == {"job_id": "embed:gone", "status": "running", "result": None, "error": None}


# =====================================================================================================
# admin_ai: the queued actions
# =====================================================================================================


async def _seed_series(env: Env, *, episodes: int = 0, language: str = "hi") -> tuple[Series, list[Episode]]:
    async with env.maker() as s:
        series = Series(slug=f"s-{_tok(12)}", original_language=language, status=PublishStatus.draft)
        s.add(series)
        await s.flush()
        eps = [Episode(series_id=series.id, number=n + 1) for n in range(episodes)]
        s.add_all(eps)
        await s.commit()
        return series, eps


async def test_translating_a_series_queues_one_job_and_clears_the_stale_result(env: Env, monkeypatch):
    """`retry=True` is what makes the button work twice: the previous run's result key is deleted first."""
    pool = _use_pool(monkeypatch, _FakePool())
    series, _ = await _seed_series(env)

    res = await env.client.post(f"/v1/admin/ai/series/{series.id}/translate", json={"languages": ["ta", "te"]})
    assert res.status_code == 200, res.text
    assert res.json() == {"job_id": f"series-translate:{series.id}", "queued": True}

    name, args, job_id, kwargs = pool.enqueued[0]
    assert name == "run_series_translation"
    assert args == (str(series.id), ["ta", "te"])
    assert job_id == f"series-translate:{series.id}", "the id is derived from the series, so a double click is one job"
    assert kwargs == {}
    assert pool.deleted == [result_key_prefix + f"series-translate:{series.id}"]

    # No language list means "every active language except the source", which the worker resolves.
    await env.client.post(f"/v1/admin/ai/series/{series.id}/translate", json={})
    assert pool.enqueued[1][1] == (str(series.id), None)

    missing = await env.client.post(f"/v1/admin/ai/series/{uuid.uuid4()}/translate", json={})
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "not_found"
    assert len(pool.enqueued) == 2, "an unknown series must not reach the queue"


async def test_a_run_still_in_flight_is_refused_instead_of_duplicated(env: Env, monkeypatch):
    """Deleting the result key does not resurrect a live job: arq still refuses the id, and that is a 409."""
    pool = _use_pool(monkeypatch, _FakePool(refuse=True))
    series, _ = await _seed_series(env)

    res = await env.client.post(f"/v1/admin/ai/series/{series.id}/embeddings")
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "job_in_progress"
    assert res.json()["detail"]["message"] == f"Job embed:{series.id} is already queued or running"
    # It did try — the refusal comes from the queue, not from a guess made before it.
    assert pool.enqueued[0][0] == "refresh_embeddings"


async def test_refreshing_embeddings_queues_one_job_per_series(env: Env, monkeypatch):
    pool = _use_pool(monkeypatch, _FakePool())
    series, _ = await _seed_series(env)

    res = await env.client.post(f"/v1/admin/ai/series/{series.id}/embeddings")
    assert res.status_code == 200
    assert res.json() == {"job_id": f"embed:{series.id}", "queued": True}
    assert pool.enqueued[0][:3] == ("refresh_embeddings", (str(series.id),), f"embed:{series.id}")
    assert pool.deleted == [result_key_prefix + f"embed:{series.id}"]

    assert (await env.client.post(f"/v1/admin/ai/series/{uuid.uuid4()}/embeddings")).status_code == 404
    assert len(pool.enqueued) == 1


async def test_subtitles_need_an_episode_that_has_a_video(env: Env, monkeypatch):
    """Transcription reads the mezzanine; without an asset there is nothing to send and the job would fail."""
    pool = _use_pool(monkeypatch, _FakePool())
    series, eps = await _seed_series(env, episodes=1)
    (episode,) = eps

    no_asset = await env.client.post(f"/v1/admin/ai/episodes/{episode.id}/subtitles", json={})
    assert no_asset.status_code == 400
    assert no_asset.json()["detail"]["code"] == "no_asset"
    assert pool.enqueued == [], "nothing is queued for an episode with no video"

    async with env.maker() as s:
        asset = VideoAsset(source_key=f"src/{_tok(8)}.mp4", status=AssetStatus.ready)
        s.add(asset)
        await s.flush()
        row = await s.get(Episode, episode.id)
        row.video_asset_id = asset.id
        await s.commit()

    queued = await env.client.post(f"/v1/admin/ai/episodes/{episode.id}/subtitles", json={"languages": ["en"]})
    assert queued.status_code == 200
    assert queued.json() == {"job_id": f"subtitles:{episode.id}", "queued": True}
    assert pool.enqueued[0][:3] == ("transcribe_episode", (str(episode.id), ["en"]), f"subtitles:{episode.id}")
    assert pool.deleted == [result_key_prefix + f"subtitles:{episode.id}"]

    assert (await env.client.post(f"/v1/admin/ai/episodes/{uuid.uuid4()}/subtitles", json={})).status_code == 404
    assert len(pool.enqueued) == 1


async def test_reembedding_everything_is_a_single_named_job(env: Env, monkeypatch):
    """One fixed id, so a second click during a multi-hour rebuild joins the run rather than starting another."""
    pool = _use_pool(monkeypatch, _FakePool())

    res = await env.client.post("/v1/admin/ai/reembed-all")
    assert res.status_code == 200
    assert res.json() == {"job_id": "reembed-all", "queued": True}
    assert pool.enqueued == [("reembed_all", (), "reembed-all", {})]
    assert pool.deleted == [result_key_prefix + "reembed-all"]

    _use_pool(monkeypatch, _FakePool(refuse=True))
    refused = await env.client.post("/v1/admin/ai/reembed-all")
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "job_in_progress"


# =====================================================================================================
# admin_ai: the transcript feed
# =====================================================================================================

_VTT = """WEBVTT

1
00:00:01.000 --> 00:00:03.000
Hello there

2
00:00:03.000 --> 00:00:05.000
General Kenobi
"""


async def test_the_transcript_joins_the_source_subtitles_and_skips_what_it_cannot_read(env: Env, monkeypatch):
    """Cue numbers, timings and the header are stripped; an episode without a readable VTT is left out."""
    series, eps = await _seed_series(env, episodes=4, language="hi")
    objects = {}
    async with env.maker() as s:
        keys = [f"subs/{_tok(10)}.vtt" for _ in range(5)]
        s.add_all(
            [
                Subtitle(episode_id=eps[0].id, lang="hi", vtt_key=keys[0]),
                # An English track on the same episode must be ignored: the seed is written in the source language.
                Subtitle(episode_id=eps[0].id, lang="en", vtt_key=keys[1]),
                # eps[1] has no subtitle at all.
                Subtitle(episode_id=eps[2].id, lang="hi", vtt_key=keys[2]),  # object is missing from storage
                Subtitle(episode_id=eps[3].id, lang="hi", vtt_key=keys[3]),
            ]
        )
        await s.commit()
    objects[keys[0]] = _VTT
    objects[keys[1]] = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nEnglish dub\n"
    objects[keys[3]] = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nFourth episode\n"

    def get_object_text(key: str, **kwargs) -> str:
        return objects[key]  # KeyError for the missing object, exactly as S3 would raise

    monkeypatch.setattr(storage, "get_object_text", get_object_text)

    default = await env.client.get(f"/v1/admin/ai/series/{series.id}/transcript")
    assert default.status_code == 200, default.text
    body = default.json()
    assert body["series_id"] == str(series.id)
    assert body["language"] == "hi"
    # Three episodes by default, of which only the first yields text: the second has no track and the third's
    # object is gone.
    assert body["episodes"] == 1
    assert body["text"] == "Episode 1: Hello there General Kenobi"
    assert "English dub" not in body["text"]
    assert "-->" not in body["text"] and "WEBVTT" not in body["text"]

    wider = (await env.client.get(f"/v1/admin/ai/series/{series.id}/transcript", params={"episodes": 4})).json()
    assert wider["episodes"] == 2
    assert wider["text"] == "Episode 1: Hello there General Kenobi\n\nEpisode 4: Fourth episode"

    # The window is clamped at both ends: 0 still reads one episode, and 50 reads at most ten.
    clamped_low = (await env.client.get(f"/v1/admin/ai/series/{series.id}/transcript", params={"episodes": 0})).json()
    assert clamped_low["episodes"] == 1 and clamped_low["text"] == "Episode 1: Hello there General Kenobi"
    clamped_high = (await env.client.get(f"/v1/admin/ai/series/{series.id}/transcript", params={"episodes": 50})).json()
    assert clamped_high["text"] == wider["text"], "ten is the ceiling, and this series only has four episodes"


async def test_a_series_with_nothing_to_transcribe_reports_no_language(env: Env, monkeypatch):
    """`language` is the provenance of the text; with no text there is no language to claim."""
    series, _ = await _seed_series(env, episodes=2, language="hi")
    monkeypatch.setattr(storage, "get_object_text", lambda key, **kw: pytest.fail("storage must not be read"))

    res = await env.client.get(f"/v1/admin/ai/series/{series.id}/transcript")
    assert res.status_code == 200
    assert res.json() == {"series_id": str(series.id), "episodes": 0, "language": None, "text": ""}

    missing = await env.client.get(f"/v1/admin/ai/series/{uuid.uuid4()}/transcript")
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "not_found"


async def test_the_transcript_is_capped_before_it_reaches_the_prompt(env: Env, monkeypatch):
    """The generator's `transcript` field accepts 20000 characters, so this endpoint must not exceed it."""
    series, eps = await _seed_series(env, episodes=1, language="hi")
    key = f"subs/{_tok(10)}.vtt"
    async with env.maker() as s:
        s.add(Subtitle(episode_id=eps[0].id, lang="hi", vtt_key=key))
        await s.commit()
    monkeypatch.setattr(storage, "get_object_text", lambda k, **kw: "WEBVTT\n\n" + ("word " * 12000))

    res = await env.client.get(f"/v1/admin/ai/series/{series.id}/transcript")
    assert res.status_code == 200
    assert len(res.json()["text"]) == 20000
    assert res.json()["text"].startswith("Episode 1: word word")


async def test_the_ai_router_is_closed_to_support_and_finance(env: Env):
    """These endpoints spend money at a provider and rewrite catalogue metadata: editors and owners only."""
    ghost = uuid.uuid4()

    for role in (AdminRole.support, AdminRole.finance):
        await env.act_as(role)
        refused = await env.client.get(f"/v1/admin/ai/series/{ghost}/transcript")
        assert refused.status_code == 403, f"{role.value} reached the handler"
        assert refused.json()["detail"]["code"] == "forbidden"

    # An editor gets past the guard and on to the handler's own answer, which for an unknown series is a 404.
    await env.act_as(AdminRole.editor)
    assert (await env.client.get(f"/v1/admin/ai/series/{ghost}/transcript")).status_code == 404
    env.act_as_owner()
    assert (await env.client.get(f"/v1/admin/ai/series/{ghost}/transcript")).status_code == 404


# =====================================================================================================
# admin_dashboard
# =====================================================================================================


async def _dashboard(env: Env, **params) -> dict:
    res = await env.client.get("/v1/admin/dashboard", params=params)
    assert res.status_code == 200, res.text
    return res.json()


async def test_the_dashboard_counts_the_window_and_the_one_before_it(env: Env):
    """Every figure on the screen, asserted as the delta a known cohort of rows makes to it.

    The rows are dated on three sides of a ten-day window: inside it, inside the preceding ten days, and older
    than both. A row in the wrong bucket, a pending purchase counted as revenue or a credit counted as spend
    would each show up as a delta that is off by exactly that row.
    """
    now = datetime.now(UTC)
    before = await _dashboard(env, days=10)

    async with env.maker() as s:
        in_window = _new_user(created_at=now - timedelta(days=3), last_seen_at=now - timedelta(days=3))
        in_previous = _new_user(created_at=now - timedelta(days=13), last_seen_at=now - timedelta(days=13))
        long_ago = _new_user(created_at=now - timedelta(days=25), last_seen_at=now - timedelta(days=25))
        pack = CoinPack(sku=f"sku-{_tok(10)}", name="Pack", kind=PackKind.coins, coins=100)
        series = Series(slug=f"s-{_tok(12)}", status=PublishStatus.published)
        s.add_all([in_window, in_previous, long_ago, pack, series])
        await s.flush()
        eps = [Episode(series_id=series.id, number=n + 1, status=PublishStatus.published) for n in range(3)]
        s.add_all(eps)
        await s.flush()

        def purchase(user, amount, currency, status, paid_at):
            return Purchase(
                user_id=user.id,
                pack_id=pack.id,
                gateway="stripe",
                external_id=_tok(20),
                status=status,
                currency=currency,
                amount=amount,
                paid_at=paid_at,
            )

        s.add_all(
            [
                purchase(in_window, 100.50, "INR", PurchaseStatus.paid, now - timedelta(days=3)),
                purchase(in_window, 49.50, "INR", PurchaseStatus.paid, now - timedelta(days=2)),
                purchase(long_ago, 20.00, "USD", PurchaseStatus.paid, now - timedelta(days=1)),
                # Started and never paid: it is not revenue and its owner is not a paying user.
                purchase(in_window, 999.00, "INR", PurchaseStatus.pending, now - timedelta(days=3)),
                purchase(in_previous, 30.00, "INR", PurchaseStatus.paid, now - timedelta(days=13)),
            ]
        )
        s.add_all(
            [
                EpisodeUnlock(
                    user_id=in_window.id,
                    episode_id=eps[0].id,
                    series_id=series.id,
                    method=UnlockMethod.coins,
                    created_at=now - timedelta(days=3),
                ),
                EpisodeUnlock(
                    user_id=in_previous.id,
                    episode_id=eps[1].id,
                    series_id=series.id,
                    method=UnlockMethod.ad,
                    created_at=now - timedelta(days=2),
                ),
                EpisodeUnlock(
                    user_id=long_ago.id,
                    episode_id=eps[2].id,
                    series_id=series.id,
                    method=UnlockMethod.coins,
                    created_at=now - timedelta(days=13),
                ),
            ]
        )
        s.add_all(
            [
                CoinLedger(
                    user_id=in_window.id,
                    delta=-40,
                    balance_after=60,
                    kind=LedgerKind.unlock,
                    idempotency_key=_tok(24),
                    created_at=now - timedelta(days=3),
                ),
                CoinLedger(
                    user_id=in_window.id,
                    delta=100,
                    balance_after=100,
                    kind=LedgerKind.purchase,
                    idempotency_key=_tok(24),
                    created_at=now - timedelta(days=3),
                ),
                CoinLedger(
                    user_id=in_previous.id,
                    delta=-7,
                    balance_after=0,
                    kind=LedgerKind.unlock,
                    idempotency_key=_tok(24),
                    created_at=now - timedelta(days=13),
                ),
            ]
        )
        await s.commit()

    after = await _dashboard(env, days=10)
    assert after["range_days"] == 10

    # --- the current window -------------------------------------------------------------------------
    assert after["revenue"]["INR"] == pytest.approx(before["revenue"].get("INR", 0.0) + 150.0)
    assert after["revenue"]["USD"] == pytest.approx(before["revenue"].get("USD", 0.0) + 20.0)
    assert after["purchases_paid"] == before["purchases_paid"] + 3, "the pending purchase is not one of them"
    assert after["paying_users"] == before["paying_users"] + 2, "two purchases by one person is still one payer"
    assert after["new_users"] == before["new_users"] + 1
    assert after["total_users"] == before["total_users"] + 3, "a running total ignores the window"
    assert after["active_users"] == before["active_users"] + 1
    assert after["series_published"] == before["series_published"] + 1
    assert after["episodes_published"] == before["episodes_published"] + 3
    assert after["unlocks"] == before["unlocks"] + 2
    assert after["unlocks_by_method"]["coins"] == before["unlocks_by_method"].get("coins", 0) + 1
    assert after["unlocks_by_method"]["ad"] == before["unlocks_by_method"].get("ad", 0) + 1
    assert after["unlocks"] == sum(after["unlocks_by_method"].values()), "the total is the breakdown, summed"
    assert after["coins_spent"] == before["coins_spent"] + 40, "spend is the debits, reported positive"
    assert after["coins_granted"] == before["coins_granted"] + 100, "the credit is a grant, not a negative spend"

    # --- the window immediately before it -----------------------------------------------------------
    prev, prev_before = after["previous"], before["previous"]
    assert prev["revenue"]["INR"] == pytest.approx(prev_before["revenue"].get("INR", 0.0) + 30.0)
    assert prev["revenue"].get("USD", 0.0) == pytest.approx(prev_before["revenue"].get("USD", 0.0)), (
        "the USD purchase is in the current window, not the previous one"
    )
    assert prev["purchases_paid"] == prev_before["purchases_paid"] + 1
    assert prev["paying_users"] == prev_before["paying_users"] + 1
    assert prev["new_users"] == prev_before["new_users"] + 1
    assert prev["active_users"] == prev_before["active_users"] + 1
    assert prev["unlocks"] == prev_before["unlocks"] + 1
    assert prev["coins_spent"] == prev_before["coins_spent"] + 7
    # Running totals are deliberately absent from the comparison: a delta on them would be meaningless.
    assert "total_users" not in prev and "series_published" not in prev

    # The row dated 25 days back is outside both windows, and nothing above counted it.
    generated = datetime.fromisoformat(after["generated_at"])
    assert abs((generated - now).total_seconds()) < 120


async def test_the_daily_series_is_bucketed_in_the_product_timezone(env: Env):
    """A UTC boundary at 05:30 IST put every late-evening purchase on the following date.

    Both rows below are stamped at 20:00 UTC, which is 01:30 the next morning in Asia/Kolkata. If the buckets
    were cut in UTC they would land on the earlier date, so the two assertions — the IST date moved, the UTC
    date did not — are what separates the two behaviours.
    """
    tz = ZoneInfo(get_settings().reward_timezone)
    now = datetime.now(UTC)
    # Far enough back that nothing else in the shared database shares these dates, and inside a 365-day window.
    reg_at = (now - timedelta(days=250)).replace(hour=20, minute=0, second=0, microsecond=0)
    pay_at = (now - timedelta(days=200)).replace(hour=20, minute=0, second=0, microsecond=0)
    reg_day, reg_utc_day = str(reg_at.astimezone(tz).date()), str(reg_at.date())
    pay_day = str(pay_at.astimezone(tz).date())
    assert reg_day != reg_utc_day, "the fixture only proves anything while the two dates differ"

    before = {row["date"]: row for row in (await _dashboard(env, days=365))["daily"]}

    users: list[uuid.UUID] = []
    async with env.maker() as s:
        registered = _new_user(created_at=reg_at)
        payer = _new_user(created_at=now)  # registers today, so it cannot disturb the two dates under test
        pack = CoinPack(sku=f"sku-{_tok(10)}", name="Pack", kind=PackKind.coins, coins=100)
        s.add_all([registered, payer, pack])
        await s.flush()
        users = [registered.id, payer.id]
        s.add(
            Purchase(
                user_id=payer.id,
                pack_id=pack.id,
                gateway="stripe",
                external_id=_tok(20),
                status=PurchaseStatus.paid,
                currency="INR",
                amount=75.25,
                paid_at=pay_at,
            )
        )
        await s.commit()

    try:
        daily = (await _dashboard(env, days=365))["daily"]
        assert [row["date"] for row in daily] == sorted(row["date"] for row in daily), "the chart reads left to right"
        rows = {row["date"]: row for row in daily}

        empty = {"registrations": 0, "purchases": 0, "revenue": 0.0}
        reg_row, reg_was = rows[reg_day], before.get(reg_day, empty)
        assert reg_row["registrations"] == reg_was["registrations"] + 1
        assert reg_row["purchases"] == reg_was["purchases"], "nobody bought anything that day"
        assert rows.get(reg_utc_day, empty)["registrations"] == before.get(reg_utc_day, empty)["registrations"], (
            "the registration was bucketed on the local date, not the UTC one"
        )

        # This date has a purchase and no registration, which is the case that has to create its own row.
        pay_row, pay_was = rows[pay_day], before.get(pay_day, empty)
        assert pay_row["purchases"] == pay_was["purchases"] + 1
        assert pay_row["revenue"] == pytest.approx(pay_was["revenue"] + 75.25)
        assert pay_row["registrations"] == pay_was["registrations"]
        assert set(pay_row) == {"date", "registrations", "purchases", "revenue"}
    finally:
        # These two dates are the fixture; leaving rows on them would make the next run's baseline this run's
        # result, and the "no registration on the purchase date" assertion would stop meaning anything.
        async with env.maker() as s:
            await s.execute(delete(User).where(User.id.in_(users)))
            await s.commit()


async def test_top_series_ranks_by_unlocks_and_falls_back_to_the_id_for_an_untitled_series(env: Env):
    """The leaderboard is ordered by unlocks in the window, and a series with no English row still renders.

    How many unlocks it takes to lead is read off the current screen rather than assumed, because the test
    database is shared; the assertion is then that the two seeded series hold the first two places in the order
    their unlock counts imply.
    """
    now = datetime.now(UTC)
    before = await _dashboard(env, days=7)
    leader = before["top_series"][0]["unlocks"] if before["top_series"] else 0
    untitled_unlocks, titled_unlocks = leader + 2, leader + 1

    title = f"Dashboard Fixture {_tok(6)}"
    user_ids: list[uuid.UUID] = []
    series_ids: list[uuid.UUID] = []
    async with env.maker() as s:
        untitled = Series(slug=f"s-{_tok(12)}", status=PublishStatus.published, view_count=11)
        titled = Series(slug=f"s-{_tok(12)}", status=PublishStatus.published, view_count=22)
        # A published series nobody has unlocked, and a draft with unlocks: only the first may be listed.
        hidden = Series(slug=f"s-{_tok(12)}", status=PublishStatus.draft, view_count=999999)
        s.add_all([untitled, titled, hidden])
        await s.flush()
        series_ids = [untitled.id, titled.id, hidden.id]
        s.add(SeriesTranslation(series_id=titled.id, lang="en", title=title))
        # The untitled series has a Hindi row only, so the English outer join finds nothing for it.
        s.add(SeriesTranslation(series_id=untitled.id, lang="hi", title="बिना नाम"))
        episodes = {}
        for series in (untitled, titled, hidden):
            ep = Episode(series_id=series.id, number=1, status=PublishStatus.published)
            s.add(ep)
            await s.flush()
            episodes[series.id] = ep
        for series, count in ((untitled, untitled_unlocks), (titled, titled_unlocks), (hidden, untitled_unlocks + 5)):
            for _ in range(count):
                user = _new_user(created_at=now)
                s.add(user)
                await s.flush()
                user_ids.append(user.id)
                s.add(
                    EpisodeUnlock(
                        user_id=user.id,
                        episode_id=episodes[series.id].id,
                        series_id=series.id,
                        method=UnlockMethod.coins,
                        created_at=now - timedelta(hours=1),
                    )
                )
        await s.commit()

    try:
        top = (await _dashboard(env, days=7))["top_series"]
        assert len(top) <= 10, "the leaderboard is the first ten, whatever the catalogue size"
        assert [row["unlocks"] for row in top] == sorted((row["unlocks"] for row in top), reverse=True)

        first, second = top[0], top[1]
        assert first["id"] == str(series_ids[0]) and first["unlocks"] == untitled_unlocks
        assert first["title"] == str(series_ids[0]), "with no English title the id is shown rather than nothing"
        assert first["views"] == 11
        assert second["id"] == str(series_ids[1]) and second["unlocks"] == titled_unlocks
        assert second["title"] == title
        assert second["views"] == 22
        assert str(series_ids[2]) not in {row["id"] for row in top}, "an unpublished series is not on the screen"
    finally:
        # The next run reads its target off this screen, so the fixture has to take its unlocks with it.
        async with env.maker() as s:
            await s.execute(delete(User).where(User.id.in_(user_ids)))
            await s.execute(delete(Series).where(Series.id.in_(series_ids)))
            await s.commit()


async def test_the_range_is_bounded_and_defaults_to_a_month(env: Env):
    """`days` drives three separate windows; an unbounded one would let a click scan the whole ledger."""
    assert (await _dashboard(env))["range_days"] == 30

    assert (await _dashboard(env, days=1))["range_days"] == 1
    assert (await _dashboard(env, days=365))["range_days"] == 365

    for bad in (0, -1, 366, 100000):
        res = await env.client.get("/v1/admin/dashboard", params={"days": bad})
        assert res.status_code == 422, f"days={bad} was accepted"
    assert (await env.client.get("/v1/admin/dashboard", params={"days": "lots"})).status_code == 422


async def test_every_admin_role_can_read_the_dashboard(env: Env):
    """It is the console's landing page: support and finance both sign in to it, unlike the AI router."""
    for role in (AdminRole.editor, AdminRole.support, AdminRole.finance):
        await env.act_as(role)
        res = await env.client.get("/v1/admin/dashboard", params={"days": 1})
        assert res.status_code == 200, f"{role.value} was locked out of the landing page"
        assert res.json()["range_days"] == 1
    env.act_as_owner()
    assert (await env.client.get("/v1/admin/dashboard", params={"days": 1})).status_code == 200
