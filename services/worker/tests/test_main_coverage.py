"""The arq entrypoint: the job registry, the cron schedule, and the guard that runs before either exists.

`worker.main` is imported for its side effects as much as its contents - importing it is what refuses to start
a worker that would encrypt under a guessed key - so each test execs a fresh copy of the module rather than
importing it once. A fresh copy also keeps the environment this test file sets from leaking into the real
`sys.modules` entry, which `arq` would otherwise pick up.
"""

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

from worker import settings as worker_settings
from worker.jobs import ai, billing, media, notify, publish

MAIN_PATH = Path(worker_settings.__file__).with_name("main.py")


def _load_main():
    """Exec worker/main.py as a throwaway module, so its import-time guard runs on every call."""
    spec = importlib.util.spec_from_file_location("worker_main_under_test", MAIN_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def main(monkeypatch):
    """The module with its encryption guard satisfied: this environment has no media key configured."""
    monkeypatch.setattr(worker_settings, "assert_encryption_configured", lambda: None)
    return _load_main()


def test_importing_the_worker_checks_the_encryption_key_before_anything_else(monkeypatch):
    """`arq --check` and a misconfigured deploy both have to fail here, not on the first packaged episode."""
    calls: list[int] = []
    monkeypatch.setattr(worker_settings, "assert_encryption_configured", lambda: calls.append(1))
    module = _load_main()
    assert calls == [1]
    assert hasattr(module, "WorkerSettings"), "the guard runs at import, before the registry is built"


def test_a_worker_with_no_content_key_refuses_to_load(monkeypatch):
    """The real guard, against the real settings: encryption is on by default and no key is set here, so
    exec'ing the entrypoint raises rather than producing a registry that would package under a fallback."""
    with pytest.raises(RuntimeError, match="KATHA_MEDIA_ENCRYPTION_KEY"):
        _load_main()


def test_every_job_the_api_enqueues_is_registered(main):
    """arq resolves jobs by function name; a job missing from this list is enqueued and silently never run."""
    registered = {f.__name__ for f in main.WorkerSettings.functions}
    assert registered == {
        "transcode_asset",
        "generate_thumbnails",
        "send_push",
        "new_episode_alert",
        "streak_reminder",
        "resume_reminder",
        "run_translation",
        "run_series_translation",
        "run_ingestion",
        "refresh_embeddings",
        "transcribe_episode",
        "reembed_all",
        "indexnow_ping",
    }
    # The registered objects are the job functions themselves, not same-named lookalikes.
    assert media.transcode_asset in main.WorkerSettings.functions
    assert ai.transcribe_episode in main.WorkerSettings.functions
    assert publish.indexnow_ping in main.WorkerSettings.functions
    assert notify.send_push in main.WorkerSettings.functions


def test_the_cron_schedule_is_the_one_the_audience_lives_in(main):
    """Times are UTC. 12:30 and 13:30 UTC are 18:00 and 19:00 in Asia/Kolkata, the evening viewing window,
    and late enough that "your streak ends tonight" is true."""
    by_name = {c.coroutine.__name__: c for c in main.WorkerSettings.cron_jobs}
    assert set(by_name) == {"publish_scheduled", "streak_reminder", "resume_reminder", "reconcile_play_voided"}

    assert by_name["publish_scheduled"].minute == set(range(60)), "drip release is checked every minute"
    assert by_name["publish_scheduled"].hour is None

    assert (by_name["streak_reminder"].hour, by_name["streak_reminder"].minute) == ({12}, {30})
    assert (by_name["resume_reminder"].hour, by_name["resume_reminder"].minute) == ({13}, {30})
    assert (by_name["reconcile_play_voided"].hour, by_name["reconcile_play_voided"].minute) == ({0, 6, 12, 18}, {15})

    # None of them run on startup: a worker restart at 19:05 must not re-send the evening reminder.
    assert all(not c.run_at_startup for c in main.WorkerSettings.cron_jobs)


def test_the_cron_jobs_are_the_real_job_functions(main):
    coroutines = [c.coroutine for c in main.WorkerSettings.cron_jobs]
    assert publish.publish_scheduled in coroutines
    assert billing.reconcile_play_voided in coroutines
    # The two reminders are registered as jobs as well as cron entries, so the admin can trigger one by hand.
    assert notify.streak_reminder in coroutines and notify.streak_reminder in main.WorkerSettings.functions
    # The Play reconcile is cron-only: there is no admin button for it, so it is not in the registry.
    assert billing.reconcile_play_voided not in main.WorkerSettings.functions


def test_each_cron_entry_runs_once_across_the_whole_worker_pool(main):
    """`unique` is what stops four replicas each sending the evening reminder; cron names must not collide
    either, since arq keys the lock on the name."""
    assert all(c.unique for c in main.WorkerSettings.cron_jobs)
    names = [c.name for c in main.WorkerSettings.cron_jobs]
    assert len(names) == len(set(names))


def test_retry_and_result_retention_match_what_the_jobs_and_the_console_assume(main):
    """Jobs raise `arq.Retry` counting against `MAX_TRIES`; the admin console reads results for an hour, which
    is also why an explicit re-run has to clear the stale result key first."""
    assert main.WorkerSettings.retry_jobs is True
    assert main.WorkerSettings.max_tries == worker_settings.MAX_TRIES == 3
    assert main.WorkerSettings.keep_result == 3600
    assert main.WorkerSettings.job_timeout == 3600, "a feature-length transcode outlives arq's default minute"


def test_redis_and_concurrency_come_from_the_worker_settings(main):
    ws = worker_settings.get_worker_settings()
    assert main.WorkerSettings.max_jobs == ws.max_jobs
    assert main.WorkerSettings.redis_settings.host == "localhost"
    assert main.WorkerSettings.redis_settings.port == 6379
    assert main.WorkerSettings.redis_settings.database == 0


async def test_startup_initialises_telemetry_under_the_worker_s_own_service_name(main, monkeypatch):
    """Traces and Sentry events from a job must be attributable to the worker, not to the API image it shares."""
    from app.core import telemetry

    names: list[str] = []
    monkeypatch.setattr(telemetry, "init", lambda name, *a, **k: names.append(name))

    await main.startup({})
    assert names == ["worker"]

    await main.shutdown({})  # nothing to tear down, but it must not raise on the way out


def test_worker_settings_are_read_once_and_cached():
    """`get_worker_settings` is what jobs call per invocation; re-reading the environment each time would make
    a transcode's ffmpeg path depend on when it happened to start."""
    assert worker_settings.get_worker_settings() is worker_settings.get_worker_settings()


def test_the_encryption_guard_only_fires_for_an_encrypting_worker(monkeypatch):
    """Turning encryption off is a legitimate configuration: it packages in the clear and needs no key."""
    import app.core.config as config

    monkeypatch.setattr(worker_settings, "get_worker_settings", lambda: SimpleNamespace(hls_encrypt=False))
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(media_encryption_key=None))
    worker_settings.assert_encryption_configured()  # no raise
