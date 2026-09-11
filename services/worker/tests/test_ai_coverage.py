"""The AI job runners, with every graph faked at its boundary.

The graphs themselves live in services/ai and are tested there; what this module owns is scheduling,
persistence and object storage, so `run_translation_batch`, `transcribe`, `translate_cues` and
`embed_documents` are all replaced with recorders. Nothing here opens a socket: a test that reached OpenAI
would be slow, flaky and billed.

The rule these jobs exist to keep is that machine output never overwrites a human's: every persistence path is
asserted against a row already marked `source="human"` as well as against an empty table.
"""

import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from app.models.catalog import Embedding, SeriesTranslation, Subtitle
from app.models.ops import UiTranslation
from katha_ai.graphs.subtitles import Cue

from worker.jobs import ai


class Rows:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class FakeDb:
    """One object standing in for `SessionLocal` and for every session it hands out.

    The jobs open several sessions in sequence, so the queues are shared across all of them and popped in
    call order; anything not queued answers empty, which is what an absent row looks like.
    """

    def __init__(self, *, scalar=(), scalars=(), get=()):
        self._scalar = list(scalar)
        self._scalars = list(scalars)
        self._get = list(get)
        self.statements: list = []
        self.gets: list = []
        self.added: list = []
        self.commits = 0

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def scalar(self, stmt):
        self.statements.append(stmt)
        return self._scalar.pop(0) if self._scalar else None

    async def scalars(self, stmt):
        self.statements.append(stmt)
        return Rows(self._scalars.pop(0) if self._scalars else [])

    async def get(self, model, key):
        self.gets.append((model, key))
        return self._get.pop(0) if self._get else None

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1


class FakeS3:
    def __init__(self):
        self.downloads: list[tuple[str, str, str]] = []
        self.uploads: list[tuple[str, str, str, dict]] = []

    def download_file(self, bucket, key, dest):
        self.downloads.append((bucket, key, dest))
        Path(dest).write_bytes(b"fake source")

    def upload_file(self, path, bucket, key, ExtraArgs=None):  # noqa: N803 - boto3's keyword
        self.uploads.append((path, bucket, key, ExtraArgs or {}))


def _translations(monkeypatch, *outputs: dict):
    """Fake the translation graph. Each call takes the next output, repeating the last one thereafter."""
    calls: list[dict] = []
    queue = list(outputs) or [{}]

    async def run_translation_batch(*, target_lang, items, namespace):
        calls.append({"lang": target_lang, "items": dict(items), "namespace": namespace})
        return queue.pop(0) if len(queue) > 1 else queue[0]

    monkeypatch.setattr(ai, "run_translation_batch", run_translation_batch)
    return calls


def _language(code):
    return SimpleNamespace(code=code, is_active=True)


async def test_ui_strings_are_written_as_ai_rows_and_never_over_a_human_one(monkeypatch):
    existing_ai = UiTranslation(lang="ta", key="home.title", value="old", source="ai", updated_at=None)
    human = UiTranslation(lang="ta", key="home.cta", value="mine", source="human", updated_at=None)
    db = FakeDb(scalars=[[existing_ai, human]])
    monkeypatch.setattr(ai, "SessionLocal", db)
    calls = _translations(monkeypatch, {"home.title": "new", "home.cta": "theirs", "home.sub": "fresh"})

    out = await ai.run_translation({}, "ta", {"home.title": "Home", "home.cta": "Watch", "home.sub": "Sub"})

    assert out == {"translated": 3, "written": 2}, "the human row counts as translated but not as written"
    assert existing_ai.value == "new" and existing_ai.updated_at is not None
    assert human.value == "mine", "a translator's own copy is not replaced by the model's"
    assert [(r.key, r.value, r.source) for r in db.added] == [("home.sub", "fresh", "ai")]
    assert db.commits == 1
    assert calls[0]["namespace"] == "ui" and calls[0]["lang"] == "ta"


async def test_a_non_ui_namespace_is_translated_but_not_persisted_here(monkeypatch):
    """`series` and `subtitles` output belongs to rows this job knows nothing about; its caller stores it."""
    db = FakeDb()
    monkeypatch.setattr(ai, "SessionLocal", db)
    calls = _translations(monkeypatch, {"title": "Naya"})

    out = await ai.run_translation({}, "hi", {"title": "New"}, namespace="series")

    assert out == {"translated": 1, "written": 0}
    assert db.commits == 0 and db.added == []
    assert calls[0]["namespace"] == "series"


async def test_a_translation_that_came_back_empty_touches_no_rows(monkeypatch):
    """The graph returns {} when every chunk failed validation; opening a write transaction for that is waste."""
    db = FakeDb()
    monkeypatch.setattr(ai, "SessionLocal", db)
    _translations(monkeypatch, {})

    assert await ai.run_translation({}, "ta", {"a": "A"}) == {"translated": 0, "written": 0}
    assert db.statements == [] and db.commits == 0


def _series(sid, translations, original_language="hi"):
    return SimpleNamespace(
        id=sid, original_language=original_language, translations=list(translations), categories=[], tags=[]
    )


def _series_translation(lang, title, **kw):
    return SimpleNamespace(
        lang=lang,
        title=title,
        synopsis=kw.get("synopsis"),
        seo_title=kw.get("seo_title"),
        meta_description=kw.get("meta_description"),
        source=kw.get("source", "human"),
    )


async def test_a_series_is_translated_from_its_original_language_into_the_active_ones(monkeypatch):
    sid = uuid.uuid4()
    source = _series_translation("hi", "Phir Se Pyaar", synopsis="Ek kahani", seo_title="", meta_description=None)
    db = FakeDb(scalar=[_series(sid, [source])], scalars=[[_language("hi"), _language("en"), _language("ta")]])
    monkeypatch.setattr(ai, "SessionLocal", db)
    calls = _translations(monkeypatch, {"title": "Love Again", "synopsis": "A story"})

    out = await ai.run_series_translation({}, str(sid))

    assert out == {"languages": 2}
    assert [c["lang"] for c in calls] == ["en", "ta"], "the source language is not translated into itself"
    # Empty fields are dropped rather than sent as blank strings for the model to hallucinate into.
    assert calls[0]["items"] == {"title": "Phir Se Pyaar", "synopsis": "Ek kahani"}
    assert calls[0]["namespace"] == "series"
    assert [(r.lang, r.title, r.source) for r in db.added] == [("en", "Love Again", "ai"), ("ta", "Love Again", "ai")]
    assert all(isinstance(r, SeriesTranslation) for r in db.added)
    assert db.commits == 2


async def test_an_explicit_language_list_overrides_the_active_ones(monkeypatch):
    sid = uuid.uuid4()
    db = FakeDb(scalar=[_series(sid, [_series_translation("hi", "T")])])
    monkeypatch.setattr(ai, "SessionLocal", db)
    calls = _translations(monkeypatch, {"title": "X"})

    out = await ai.run_series_translation({}, str(sid), ["bn"])

    assert out == {"languages": 1}
    assert [c["lang"] for c in calls] == ["bn"]


async def test_a_human_written_series_translation_is_left_alone(monkeypatch):
    sid = uuid.uuid4()
    theirs = SimpleNamespace(source="human", title="Curated Title", synopsis="s", seo_title=None, meta_description=None)
    db = FakeDb(scalar=[_series(sid, [_series_translation("hi", "T")])], get=[theirs])
    monkeypatch.setattr(ai, "SessionLocal", db)
    _translations(monkeypatch, {"title": "Machine Title"})

    out = await ai.run_series_translation({}, str(sid), ["en"])

    assert out == {"languages": 0}
    assert theirs.title == "Curated Title"
    assert db.commits == 0 and db.added == []


async def test_an_existing_ai_translation_is_updated_and_keeps_fields_the_model_dropped(monkeypatch):
    """A rerun that loses the synopsis must not blank the one already published."""
    sid = uuid.uuid4()
    row = SimpleNamespace(
        source="ai", title="Old", synopsis="Kept synopsis", seo_title="Old SEO", meta_description="Old meta"
    )
    db = FakeDb(scalar=[_series(sid, [_series_translation("hi", "T", synopsis="S")])], get=[row])
    monkeypatch.setattr(ai, "SessionLocal", db)
    _translations(monkeypatch, {"title": "New"})

    out = await ai.run_series_translation({}, str(sid), ["en"])

    assert out == {"languages": 1}
    assert row.title == "New"
    assert (row.synopsis, row.seo_title, row.meta_description) == ("Kept synopsis", "Old SEO", "Old meta")
    assert db.added == [], "the existing row is updated in place, not duplicated"


async def test_a_language_whose_title_did_not_come_back_is_skipped_entirely(monkeypatch):
    """Title is the only field a row cannot be written without; a partial result is not worth a row."""
    sid = uuid.uuid4()
    db = FakeDb(scalar=[_series(sid, [_series_translation("hi", "T")])])
    monkeypatch.setattr(ai, "SessionLocal", db)
    _translations(monkeypatch, {"synopsis": "only this"})

    assert await ai.run_series_translation({}, str(sid), ["en"]) == {"languages": 0}
    assert db.added == [] and db.commits == 0


async def test_the_source_text_falls_back_to_english_then_to_any_translation(monkeypatch):
    sid = uuid.uuid4()
    english = _series_translation("en", "English Title")
    db = FakeDb(scalar=[_series(sid, [english], original_language="hi")])
    monkeypatch.setattr(ai, "SessionLocal", db)
    calls = _translations(monkeypatch, {"title": "X"})
    await ai.run_series_translation({}, str(sid), ["ta"])
    assert calls[-1]["items"]["title"] == "English Title"

    other = _series_translation("bn", "Bangla Title")
    db = FakeDb(scalar=[_series(sid, [other], original_language="hi")])
    monkeypatch.setattr(ai, "SessionLocal", db)
    await ai.run_series_translation({}, str(sid), ["ta"])
    assert calls[-1]["items"]["title"] == "Bangla Title"


async def test_a_series_with_no_text_or_no_row_at_all_reports_why(monkeypatch):
    sid = uuid.uuid4()
    monkeypatch.setattr(ai, "SessionLocal", FakeDb(scalar=[None]))
    calls = _translations(monkeypatch, {"title": "X"})
    assert await ai.run_series_translation({}, str(sid)) == {"status": "missing"}

    monkeypatch.setattr(ai, "SessionLocal", FakeDb(scalar=[_series(sid, [])]))
    assert await ai.run_series_translation({}, str(sid)) == {"status": "no_source"}
    assert calls == [], "neither case spends a model call"


def _embeddings(monkeypatch, vector=None):
    calls: list[list[str]] = []

    async def embed_documents(texts):
        calls.append(list(texts))
        return [vector or [0.5] * 4]

    monkeypatch.setattr(ai, "embed_documents", embed_documents)
    monkeypatch.setattr(ai, "model_name", lambda: "text-embedding-3-small")
    return calls


async def test_a_series_is_embedded_as_one_canonical_document(monkeypatch):
    """Title, synopsis, genres and tags in a fixed order: the vector has to be stable across re-embeds."""
    sid = uuid.uuid4()
    series = _series(sid, [_series_translation("en", "Love Again", synopsis="A story")])
    series.categories = [SimpleNamespace(name="Romance")]
    series.tags = [SimpleNamespace(name="ceo")]
    db = FakeDb(scalar=[series])
    monkeypatch.setattr(ai, "SessionLocal", db)
    docs = _embeddings(monkeypatch)

    out = await ai.refresh_embeddings({}, str(sid))

    assert out == {"status": "ok", "model": "text-embedding-3-small"}
    assert docs == [["Title: Love Again\nSynopsis: A story\nGenres: Romance\nTags: ceo"]]
    (row,) = db.added
    assert isinstance(row, Embedding)
    assert (row.series_id, row.model) == (sid, "text-embedding-3-small")
    assert row.vector == [0.5] * 4 and row.updated_at is not None
    assert db.commits == 1


async def test_re_embedding_replaces_the_vector_on_the_row_for_that_model(monkeypatch):
    """Keyed on (series, model), so a model change adds a row and a re-run of the same model overwrites one."""
    sid = uuid.uuid4()
    existing = SimpleNamespace(series_id=sid, model="text-embedding-3-small", vector=[0.0], updated_at=None)
    db = FakeDb(scalar=[_series(sid, [_series_translation("en", "T")])], get=[existing])
    monkeypatch.setattr(ai, "SessionLocal", db)
    _embeddings(monkeypatch, vector=[0.9, 0.1])

    await ai.refresh_embeddings({}, str(sid))

    assert existing.vector == [0.9, 0.1] and existing.updated_at is not None
    assert db.added == []
    assert db.gets == [(Embedding, (sid, "text-embedding-3-small"))]


async def test_embedding_prefers_english_then_the_original_language(monkeypatch):
    """Search and similar-series run in one vector space, so the document language has to be consistent."""
    sid = uuid.uuid4()
    hindi = _series_translation("hi", "Phir Se Pyaar")
    english = _series_translation("en", "Love Again")
    monkeypatch.setattr(ai, "SessionLocal", FakeDb(scalar=[_series(sid, [hindi, english])]))
    docs = _embeddings(monkeypatch)
    await ai.refresh_embeddings({}, str(sid))
    assert "Love Again" in docs[-1][0]

    monkeypatch.setattr(ai, "SessionLocal", FakeDb(scalar=[_series(sid, [hindi])]))
    await ai.refresh_embeddings({}, str(sid))
    assert "Phir Se Pyaar" in docs[-1][0]


async def test_nothing_is_embedded_for_a_missing_or_untranslated_series(monkeypatch):
    sid = uuid.uuid4()
    docs = _embeddings(monkeypatch)
    monkeypatch.setattr(ai, "SessionLocal", FakeDb(scalar=[None]))
    assert await ai.refresh_embeddings({}, str(sid)) == {"status": "missing"}

    monkeypatch.setattr(ai, "SessionLocal", FakeDb(scalar=[_series(sid, [])]))
    assert await ai.refresh_embeddings({}, str(sid)) == {"status": "no_text"}
    assert docs == []


def _subtitle_env(monkeypatch, db, *, cues=None, missing_by_lang=None, extract_code=0):
    """Fake everything outside the job: the bucket, ffmpeg, Whisper and the cue translator."""
    s3 = FakeS3()
    runs: list[tuple[str, ...]] = []
    cues = cues if cues is not None else [Cue(index=1, start=0.0, end=1.5, text="Hello")]
    missing_by_lang = missing_by_lang or {}

    async def run(*cmd):
        runs.append(cmd)
        return extract_code, "ffmpeg said no" if extract_code else ""

    async def transcribe(audio_path, *, language=None):
        return cues, language or "hi"

    async def translate_cues(cue_list, *, target_lang):
        translated = [Cue(index=c.index, start=c.start, end=c.end, text=f"{c.text}-{target_lang}") for c in cue_list]
        return translated, missing_by_lang.get(target_lang, 0)

    monkeypatch.setattr(ai, "SessionLocal", db)
    monkeypatch.setattr(ai, "_s3", lambda: s3)
    monkeypatch.setattr(ai, "_run", run)
    monkeypatch.setattr(ai, "transcribe", transcribe)
    monkeypatch.setattr(ai, "translate_cues", translate_cues)
    monkeypatch.setattr(ai, "get_settings", lambda: SimpleNamespace(s3_bucket="katha"))
    monkeypatch.setattr(ai, "get_worker_settings", lambda: SimpleNamespace(ffmpeg_bin="ffmpeg"))
    return SimpleNamespace(s3=s3, runs=runs)


def _episode(eid, source_key="uploads/videos/e1.mp4", original_language="hi"):
    return SimpleNamespace(
        id=eid,
        video_asset=SimpleNamespace(source_key=source_key),
        series=SimpleNamespace(original_language=original_language),
    )


async def test_an_episode_is_transcribed_then_translated_into_every_active_language(monkeypatch):
    eid = uuid.uuid4()
    db = FakeDb(scalar=[_episode(eid)], scalars=[[_language("hi"), _language("en")]])
    env = _subtitle_env(monkeypatch, db)

    out = await ai.transcribe_episode({}, str(eid))

    assert out == {"status": "ok", "cues": 1, "files": 2, "incomplete": {}}
    keys = [key for _, _, key, _ in env.s3.uploads]
    assert keys == [f"subtitles/{eid}/hi.vtt", f"subtitles/{eid}/en.vtt"]
    assert all(extra["ContentType"] == "text/vtt; charset=utf-8" for *_, extra in env.s3.uploads)
    assert env.s3.downloads[0][:2] == ("katha", "uploads/videos/e1.mp4")
    # Source-language track first, then the translations; both rows land as ai-sourced.
    assert [(r.lang, r.vtt_key, r.source) for r in db.added] == [
        ("hi", f"subtitles/{eid}/hi.vtt", "ai"),
        ("en", f"subtitles/{eid}/en.vtt", "ai"),
    ]
    assert all(isinstance(r, Subtitle) for r in db.added)


async def test_the_audio_extracted_for_whisper_is_mono_16k_and_has_no_video(monkeypatch):
    """Whisper wants 16 kHz mono; shipping the video stream would multiply the upload for nothing."""
    eid = uuid.uuid4()
    env = _subtitle_env(monkeypatch, FakeDb(scalar=[_episode(eid)]))

    await ai.transcribe_episode({}, str(eid), [])

    cmd = env.runs[0]
    assert cmd[0] == "ffmpeg"
    assert "-vn" in cmd
    assert cmd[cmd.index("-ac") + 1] == "1"
    assert cmd[cmd.index("-ar") + 1] == "16000"
    assert cmd[-1].endswith("audio.m4a")


async def test_cues_the_translator_gave_up_on_are_reported_not_hidden(monkeypatch):
    """A third-untranslated track still plays, but the admin console has to see it as incomplete."""
    eid = uuid.uuid4()
    cues = [Cue(index=i, start=float(i), end=i + 1.0, text=f"line {i}") for i in range(1, 4)]
    db = FakeDb(scalar=[_episode(eid)])
    _subtitle_env(monkeypatch, db, cues=cues, missing_by_lang={"en": 2})

    out = await ai.transcribe_episode({}, str(eid), ["en", "ta"])

    assert out == {"status": "incomplete", "cues": 3, "files": 3, "incomplete": {"en": 2}}


async def test_an_episode_with_no_speech_writes_no_track(monkeypatch):
    eid = uuid.uuid4()
    db = FakeDb(scalar=[_episode(eid)])
    env = _subtitle_env(monkeypatch, db, cues=[])

    assert await ai.transcribe_episode({}, str(eid), ["en"]) == {"status": "no_speech"}
    assert env.s3.uploads == [] and db.added == []


async def test_a_failed_audio_extract_raises_with_ffmpeg_s_words(monkeypatch):
    eid = uuid.uuid4()
    _subtitle_env(monkeypatch, FakeDb(scalar=[_episode(eid)]), extract_code=1)

    with pytest.raises(RuntimeError, match="audio extract failed: ffmpeg said no"):
        await ai.transcribe_episode({}, str(eid), ["en"])


async def test_a_momentary_storage_error_retries_rather_than_failing_the_episode(monkeypatch):
    """A transient error is the environment's fault and says nothing about this episode.

    `transcode_asset` beside this job has always classified its errors; this one had only try/finally, so a
    blip fetching the source from S3 failed the run permanently — and a subtitle run has no status column
    recording why, so the episode simply never got subtitles and nothing said so. Below the try limit it
    raises arq's Retry; at the limit it gives up and lets the error through.
    """
    from arq import Retry
    from botocore.exceptions import ClientError

    eid = uuid.uuid4()
    blip = ClientError({"Error": {"Code": "SlowDown", "Message": "slow down"}}, "GetObject")

    def download_file(bucket, key, dest):
        raise blip

    env = _subtitle_env(monkeypatch, FakeDb(scalar=[_episode(eid)]))
    env.s3.download_file = download_file
    with pytest.raises(Retry):
        await ai.transcribe_episode({"job_try": 1}, str(eid), ["en"])

    # Out of tries, the error itself surfaces so arq records a failure rather than looping for ever.
    env = _subtitle_env(monkeypatch, FakeDb(scalar=[_episode(eid)]))
    env.s3.download_file = download_file
    with pytest.raises(ClientError):
        await ai.transcribe_episode({"job_try": 99}, str(eid), ["en"])


async def test_an_episode_without_video_is_not_transcribed(monkeypatch):
    eid = uuid.uuid4()
    env = _subtitle_env(monkeypatch, FakeDb(scalar=[None]))
    assert await ai.transcribe_episode({}, str(eid)) == {"status": "missing"}

    no_asset = SimpleNamespace(id=eid, video_asset=None, series=SimpleNamespace(original_language="hi"))
    monkeypatch.setattr(ai, "SessionLocal", FakeDb(scalar=[no_asset]))
    assert await ai.transcribe_episode({}, str(eid)) == {"status": "missing"}
    assert env.runs == [] and env.s3.downloads == []


async def test_the_subtitle_temp_tree_is_removed_even_when_the_job_fails(monkeypatch):
    eid = uuid.uuid4()
    env = _subtitle_env(monkeypatch, FakeDb(scalar=[_episode(eid)]), extract_code=1)

    with pytest.raises(RuntimeError):
        await ai.transcribe_episode({}, str(eid), [])

    downloaded = Path(env.s3.downloads[0][2])
    assert not downloaded.parent.exists()


async def test_a_vtt_is_written_with_real_cue_timings_and_kept_off_human_tracks(monkeypatch, tmp_path):
    eid = uuid.uuid4()
    s3 = FakeS3()
    db = FakeDb(scalar=[None])
    monkeypatch.setattr(ai, "SessionLocal", db)
    monkeypatch.setattr(ai, "_s3", lambda: s3)
    monkeypatch.setattr(ai, "get_settings", lambda: SimpleNamespace(s3_bucket="katha"))

    text = ai.to_vtt([Cue(index=1, start=0.0, end=1.25, text=" Hello ")])
    assert await ai._write_vtt(eid, "en", text, tmp_path) == 1

    body = (tmp_path / "en.vtt").read_text(encoding="utf-8")
    assert body.startswith("WEBVTT")
    assert "00:00:00.000 --> 00:00:01.250" in body and "Hello" in body
    assert s3.uploads[0][2] == f"subtitles/{eid}/en.vtt"
    assert db.added and db.added[0].vtt_key == f"subtitles/{eid}/en.vtt"


async def test_an_uploaded_subtitle_track_is_never_replaced_by_a_generated_one(monkeypatch, tmp_path):
    """Someone paid a human for that track; a re-transcription must not point the row at the machine's."""
    eid = uuid.uuid4()
    theirs = SimpleNamespace(source="upload", vtt_key="subtitles/manual/en.vtt")
    db = FakeDb(scalar=[theirs])
    monkeypatch.setattr(ai, "SessionLocal", db)
    monkeypatch.setattr(ai, "_s3", lambda: FakeS3())
    monkeypatch.setattr(ai, "get_settings", lambda: SimpleNamespace(s3_bucket="katha"))

    await ai._write_vtt(eid, "en", "WEBVTT\n", tmp_path)

    assert theirs.vtt_key == "subtitles/manual/en.vtt"
    assert db.added == []


class FakeRedis:
    """arq's pool as `run_ingestion` uses it: `enqueue_job` answers None when it refuses a duplicate id."""

    def __init__(self, refuse=False):
        self.jobs: list[tuple] = []
        self.refuse = refuse

    async def enqueue_job(self, name, *args, **kwargs):
        self.jobs.append((name, args, kwargs))
        return None if self.refuse else SimpleNamespace(job_id=kwargs.get("_job_id"))


def _ingestion_stubs(monkeypatch):
    async def refresh(ctx, series_id):
        return {"status": "ok", "model": "m"}

    async def translate(ctx, series_id):
        return {"languages": 2}

    monkeypatch.setattr(ai, "refresh_embeddings", refresh)
    monkeypatch.setattr(ai, "run_series_translation", translate)


async def test_ingestion_queues_subtitles_only_for_episodes_that_have_none(monkeypatch):
    sid = uuid.uuid4()
    with_subs, without_subs = uuid.uuid4(), uuid.uuid4()
    eps = [SimpleNamespace(id=with_subs), SimpleNamespace(id=without_subs)]
    db = FakeDb(scalars=[eps, [SimpleNamespace(episode_id=with_subs)]])
    monkeypatch.setattr(ai, "SessionLocal", db)
    _ingestion_stubs(monkeypatch)
    redis = FakeRedis()

    out = await ai.run_ingestion({"redis": redis}, str(sid))

    assert out == {
        "embeddings": {"status": "ok", "model": "m"},
        "translations": {"languages": 2},
        "subtitles_queued": 1,
        "subtitles_refused": 0,
    }
    assert redis.jobs == [("transcribe_episode", (str(without_subs), None), {"_job_id": f"subtitles:{without_subs}"})]


async def test_ingestion_still_embeds_and_translates_without_a_queue(monkeypatch):
    """The two inline steps are the ones a publish depends on; subtitles are best-effort on top."""
    sid = uuid.uuid4()
    db = FakeDb(scalars=[[SimpleNamespace(id=uuid.uuid4())], []])
    monkeypatch.setattr(ai, "SessionLocal", db)
    _ingestion_stubs(monkeypatch)

    out = await ai.run_ingestion({}, str(sid))

    assert out["subtitles_queued"] == 0
    assert out["embeddings"] == {"status": "ok", "model": "m"} and out["translations"] == {"languages": 2}


async def test_ingestion_does_not_count_a_subtitle_job_arq_refused(monkeypatch):
    """A job the queue turned away is reported as refused, not as queued.

    arq answers None when it will not take the job — the id is live, or the previous run's result is still
    cached, which `keep_result = 3600` guarantees for an hour. Re-ingesting inside that hour is the ordinary
    case for an episode whose transcription returned no_speech: no Subtitle row exists, so it is not skipped,
    and the count used to include work that would never run.
    """
    sid = uuid.uuid4()
    eid = uuid.uuid4()
    monkeypatch.setattr(ai, "SessionLocal", FakeDb(scalars=[[SimpleNamespace(id=eid)], []]))
    _ingestion_stubs(monkeypatch)
    redis = FakeRedis(refuse=True)

    out = await ai.run_ingestion({"redis": redis}, str(sid))

    assert out["subtitles_queued"] == 0, "nothing was accepted, so nothing may be reported as queued"
    assert out["subtitles_refused"] == 1, "the caller is told the work was turned away rather than silently lost"
    assert len(redis.jobs) == 1, "the attempt was still made"


async def test_ingestion_counts_a_subtitle_job_the_queue_accepted(monkeypatch):
    """The other side of the same count: an accepted job is reported, and nothing is marked refused."""
    sid = uuid.uuid4()
    eid = uuid.uuid4()
    monkeypatch.setattr(ai, "SessionLocal", FakeDb(scalars=[[SimpleNamespace(id=eid)], []]))
    _ingestion_stubs(monkeypatch)
    redis = FakeRedis()

    out = await ai.run_ingestion({"redis": redis}, str(sid))

    assert out["subtitles_queued"] == 1
    assert out["subtitles_refused"] == 0


async def test_reembed_all_walks_every_published_series_and_counts_the_ones_that_took(monkeypatch):
    """Run after a model change, so a series that has no text to embed must not be counted as done."""
    ok_one, ok_two, empty = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    monkeypatch.setattr(ai, "SessionLocal", FakeDb(scalars=[[ok_one, ok_two, empty]]))
    seen: list[str] = []

    async def refresh(ctx, series_id):
        seen.append(series_id)
        return {"status": "ok"} if series_id != str(empty) else {"status": "no_text"}

    monkeypatch.setattr(ai, "refresh_embeddings", refresh)

    out = await ai.reembed_all({})

    assert out == {"total": 3, "done": 2}
    assert seen == [str(ok_one), str(ok_two), str(empty)]


async def test_reembed_all_only_looks_at_published_series(monkeypatch):
    """Drafts are not searchable, so embedding them spends the model budget on rows nobody can reach."""
    db = FakeDb(scalars=[[]])
    monkeypatch.setattr(ai, "SessionLocal", db)
    assert await ai.reembed_all({}) == {"total": 0, "done": 0}

    sql = str(db.statements[0].compile(compile_kwargs={"literal_binds": True}))
    assert "series.status = 'published'" in sql


async def test_the_ingestion_result_carries_both_inline_steps_for_the_admin_console(monkeypatch):
    """/admin/ai/jobs/{id} shows this dict verbatim; a bare count would not say which half failed."""
    sid = uuid.uuid4()
    monkeypatch.setattr(ai, "SessionLocal", FakeDb(scalars=[[], []]))

    async def refresh(ctx, series_id):
        return {"status": "missing"}

    async def translate(ctx, series_id):
        return {"status": "no_source"}

    monkeypatch.setattr(ai, "refresh_embeddings", refresh)
    monkeypatch.setattr(ai, "run_series_translation", translate)

    out = await ai.run_ingestion({"redis": FakeRedis()}, str(sid))

    assert out == {
        "embeddings": {"status": "missing"},
        "translations": {"status": "no_source"},
        "subtitles_queued": 0,
        "subtitles_refused": 0,
    }


async def test_a_translation_datestamp_is_timezone_aware(monkeypatch):
    """`updated_at` is a timestamptz column; a naive datetime would be stored as if it were UTC by luck."""
    db = FakeDb(scalars=[[]])
    monkeypatch.setattr(ai, "SessionLocal", db)
    _translations(monkeypatch, {"k": "v"})

    await ai.run_translation({}, "ta", {"k": "K"})

    (row,) = db.added
    assert row.updated_at.tzinfo is not None
    assert abs((row.updated_at - datetime.now(UTC)).total_seconds()) < 5


async def test_re_transcribing_repoints_the_track_it_wrote_last_time(monkeypatch, tmp_path):
    """Same key as before in practice, but the row is refreshed rather than duplicated: (episode, lang) is
    unique, so adding a second row would fail the whole job."""
    eid = uuid.uuid4()
    mine = SimpleNamespace(source="ai", vtt_key="subtitles/old/en.vtt")
    db = FakeDb(scalar=[mine])
    monkeypatch.setattr(ai, "SessionLocal", db)
    monkeypatch.setattr(ai, "_s3", lambda: FakeS3())
    monkeypatch.setattr(ai, "get_settings", lambda: SimpleNamespace(s3_bucket="katha"))

    assert await ai._write_vtt(eid, "en", "WEBVTT\n", tmp_path) == 1

    assert mine.vtt_key == f"subtitles/{eid}/en.vtt"
    assert db.added == [] and db.commits == 1
