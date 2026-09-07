"""Subtitles: transcribe an episode's audio, then translate the cues into target languages preserving timings.

transcribe(audio) -> cues -> for each target language: translate cues in chunks (reusing the translation graph's
placeholder-safe chunking) -> WebVTT text per language.
"""

from dataclasses import dataclass
from pathlib import Path

import structlog

from katha_ai.graphs.translation import run_translation_batch
from katha_ai.providers import get_ai_settings

log = structlog.get_logger()


@dataclass
class Cue:
    index: int
    start: float
    end: float
    text: str


def _ts(seconds: float) -> str:
    ms = round(seconds * 1000)
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def to_vtt(cues: list[Cue]) -> str:
    lines = ["WEBVTT", ""]
    for c in cues:
        lines += [str(c.index), f"{_ts(c.start)} --> {_ts(c.end)}", c.text.strip(), ""]
    return "\n".join(lines)


async def transcribe(audio_path: Path, *, language: str | None = None) -> tuple[list[Cue], str]:
    """Whisper via the OpenAI audio API (segment timestamps). Returns cues and detected language."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI()
    with audio_path.open("rb") as fh:
        result = await client.audio.transcriptions.create(
            model=get_ai_settings().transcription_model,
            file=fh,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
            language=language,
        )
    segments = getattr(result, "segments", None) or []
    cues = [
        Cue(index=i + 1, start=float(seg.start), end=float(seg.end), text=str(seg.text))
        for i, seg in enumerate(segments)
        if str(seg.text).strip()
    ]
    detected = getattr(result, "language", None) or language or "unknown"
    log.info("subtitles.transcribed", cues=len(cues), language=detected)
    return cues, detected


async def translate_cues(cues: list[Cue], *, target_lang: str) -> list[Cue]:
    """Translate cue text with the chunked graph; keys are cue indexes so timings never move."""
    items = {str(c.index): c.text for c in cues}
    translated = await run_translation_batch(target_lang=target_lang, items=items, namespace="subtitles")
    return [Cue(index=c.index, start=c.start, end=c.end, text=translated.get(str(c.index), c.text)) for c in cues]
