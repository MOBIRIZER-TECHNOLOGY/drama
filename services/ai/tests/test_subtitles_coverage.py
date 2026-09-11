"""Subtitles: Whisper transcription, WebVTT rendering and the translate-without-moving-timings pass.

Timings are the thing a viewer notices, so the tests pin the timestamp arithmetic exactly and check that the
translation pass returns cues with the original start/end untouched. The OpenAI client is replaced with a
stub — the audio file is real but never read by anything that would send it anywhere.
"""

import asyncio

import pytest

from katha_ai.graphs import subtitles as s
from katha_ai.graphs.subtitles import Cue


class Segment:
    """Shape of one verbose_json segment as the OpenAI SDK returns it."""

    def __init__(self, start, end, text):
        self.start, self.end, self.text = start, end, text


class Result:
    def __init__(self, segments=None, language=None):
        if segments is not None:
            self.segments = segments
        if language is not None:
            self.language = language


class FakeTranscriptions:
    def __init__(self, result):
        self.result = result
        self.kwargs = None

    async def create(self, **kwargs):
        # The file handle must still be open when the call is made.
        assert not kwargs["file"].closed
        self.kwargs = {**kwargs, "file_contents": kwargs["file"].read()}
        return self.result


class FakeClient:
    def __init__(self, result):
        self.audio = type("Audio", (), {"transcriptions": FakeTranscriptions(result)})()


def install_client(monkeypatch, result) -> FakeClient:
    client = FakeClient(result)
    monkeypatch.setattr("openai.AsyncOpenAI", lambda *a, **k: client)
    return client


@pytest.fixture
def audio(tmp_path):
    path = tmp_path / "ep01.m4a"
    path.write_bytes(b"fake-audio-bytes")
    return path


# --- timestamps and VTT ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "seconds,expected",
    [
        (0.0, "00:00:00.000"),
        (1.5, "00:00:01.500"),
        (61.25, "00:01:01.250"),
        (3661.001, "01:01:01.001"),
        (0.0004, "00:00:00.000"),  # rounds to the nearest millisecond, not truncates
        (0.0006, "00:00:00.001"),
        (59.9999, "00:01:00.000"),  # rounding carries into the next minute
    ],
)
def test_timestamp_formatting(seconds, expected):
    assert s._ts(seconds) == expected


def test_vtt_of_no_cues_is_still_a_valid_header():
    assert s.to_vtt([]) == "WEBVTT\n"


def test_vtt_trims_cue_text_and_ends_with_a_blank_line():
    """Whisper segments usually arrive with a leading space; that would show up as indentation on screen."""
    text = s.to_vtt([Cue(1, 0.0, 1.0, "  Hello there \n")])
    assert text == "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nHello there\n"


def test_vtt_keeps_the_cue_indexes_it_is_given():
    text = s.to_vtt([Cue(3, 0.0, 1.0, "Late"), Cue(7, 1.0, 2.0, "Later")])
    assert text.splitlines()[2] == "3"
    assert text.splitlines()[6] == "7"


# --- transcribe --------------------------------------------------------------------------------------


def test_transcribe_builds_cues_and_reports_the_detected_language(monkeypatch, audio):
    install_client(
        monkeypatch, Result(segments=[Segment(0.0, 1.5, "Hello"), Segment(1.5, 3.0, " World")], language="en")
    )

    cues, detected = asyncio.run(s.transcribe(audio))

    assert detected == "en"
    assert [(c.index, c.start, c.end, c.text) for c in cues] == [
        (1, 0.0, 1.5, "Hello"),
        (2, 1.5, 3.0, " World"),  # trimming happens at render time, not here
    ]


def test_transcribe_asks_for_segment_timestamps_with_the_configured_model(monkeypatch, audio):
    client = install_client(monkeypatch, Result(segments=[], language="en"))

    asyncio.run(s.transcribe(audio, language="hi"))

    kwargs = client.audio.transcriptions.kwargs
    assert kwargs["model"] == "whisper-1"
    assert kwargs["response_format"] == "verbose_json"
    assert kwargs["timestamp_granularities"] == ["segment"]
    assert kwargs["language"] == "hi"
    assert kwargs["file_contents"] == b"fake-audio-bytes"


def test_transcribe_coerces_string_timings(monkeypatch, audio):
    """Segment fields come off a JSON payload, so a string start/end must not end up in a timestamp."""
    install_client(monkeypatch, Result(segments=[Segment("0.5", "2", 42)], language="en"))

    cues, _ = asyncio.run(s.transcribe(audio))
    assert (cues[0].start, cues[0].end, cues[0].text) == (0.5, 2.0, "42")


def test_transcribe_drops_silent_segments_but_leaves_a_gap_in_the_numbering(monkeypatch, audio):
    """BUG (pinned, not fixed): the cue index is the position in the *raw* segment list, so a blank segment
    in the middle makes the published cue numbers non-consecutive (1, 3 here instead of 1, 2)."""
    install_client(
        monkeypatch,
        Result(segments=[Segment(0.0, 1.0, "Hello"), Segment(1.0, 2.0, "   "), Segment(2.0, 3.0, "World")]),
    )

    cues, _ = asyncio.run(s.transcribe(audio))
    assert [c.index for c in cues] == [1, 3]
    assert [c.text for c in cues] == ["Hello", "World"]


def test_transcribe_falls_back_to_the_requested_language(monkeypatch, audio):
    install_client(monkeypatch, Result(segments=[]))

    cues, detected = asyncio.run(s.transcribe(audio, language="ta"))
    assert cues == []
    assert detected == "ta"


def test_transcribe_reports_unknown_when_nothing_identifies_the_language(monkeypatch, audio):
    install_client(monkeypatch, Result(segments=[]))
    assert asyncio.run(s.transcribe(audio))[1] == "unknown"


def test_transcribe_tolerates_a_response_without_segments(monkeypatch, audio):
    """A response_format change or an empty track would drop the attribute entirely; that must not raise."""
    install_client(monkeypatch, Result(language="en"))

    cues, detected = asyncio.run(s.transcribe(audio))
    assert cues == []
    assert detected == "en"


def test_transcribe_propagates_a_transcription_failure(monkeypatch, audio):
    """There is no retry here; the job runner is expected to see the error."""

    class Failing:
        async def create(self, **kwargs):
            raise RuntimeError("audio too long")

    client = FakeClient(Result(segments=[]))
    client.audio.transcriptions = Failing()
    monkeypatch.setattr("openai.AsyncOpenAI", lambda *a, **k: client)

    with pytest.raises(RuntimeError, match="audio too long"):
        asyncio.run(s.transcribe(audio))


# --- translate_cues ----------------------------------------------------------------------------------


def test_translate_cues_keys_by_index_and_never_moves_a_timing(monkeypatch):
    seen = {}

    async def fake_batch(*, target_lang, items, namespace):
        seen.update(items=items, namespace=namespace, target_lang=target_lang)
        return {k: f"ta-{v}" for k, v in items.items()}

    monkeypatch.setattr(s, "run_translation_batch", fake_batch)
    cues = [Cue(1, 0.0, 1.0, "Hello"), Cue(2, 1.0, 2.25, "World")]

    out, missing = asyncio.run(s.translate_cues(cues, target_lang="ta"))

    assert missing == 0
    assert seen == {"items": {"1": "Hello", "2": "World"}, "namespace": "subtitles", "target_lang": "ta"}
    assert [(c.index, c.start, c.end, c.text) for c in out] == [
        (1, 0.0, 1.0, "ta-Hello"),
        (2, 1.0, 2.25, "ta-World"),
    ]
    assert cues[0].text == "Hello"  # the source cues are not mutated


def test_translate_cues_counts_every_dropped_cue(monkeypatch):
    async def nothing(*, target_lang, items, namespace):
        return {}

    monkeypatch.setattr(s, "run_translation_batch", nothing)
    cues = [Cue(1, 0.0, 1.0, "Hello"), Cue(2, 1.0, 2.0, "World")]

    out, missing = asyncio.run(s.translate_cues(cues, target_lang="hi"))
    assert missing == 2
    assert [c.text for c in out] == ["Hello", "World"]  # source text rather than a hole in the track


def test_translate_cues_of_an_empty_track(monkeypatch):
    async def nothing(*, target_lang, items, namespace):
        return {}

    monkeypatch.setattr(s, "run_translation_batch", nothing)
    assert asyncio.run(s.translate_cues([], target_lang="hi")) == ([], 0)
