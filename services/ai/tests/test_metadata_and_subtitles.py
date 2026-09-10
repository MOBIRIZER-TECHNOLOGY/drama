"""Graph logic with the model stubbed. No network."""

import asyncio

from katha_ai.graphs import metadata as m
from katha_ai.graphs.subtitles import Cue, to_vtt


class FakeModel:
    def __init__(self, out):
        self.out = out

    def with_structured_output(self, _):
        return self

    async def ainvoke(self, _msgs):
        return self.out


def _draft(**over):
    base = {
        "title": "The Heiress in Disguise",
        "synopsis": "A wealthy heiress hides her identity. She falls for the wrong man. Then he learns who she is.",
        "genres": ["Romance", "Nonsense"],
        "tags": ["heiress", "secret identity"],
        "seo_title": "The Heiress in Disguise",
        "meta_description": "A heiress hides who she is and falls for the wrong man.",
        "keywords": ["heiress", "romance"],
        "content_rating": "UA13",
        "moderation_flags": [],
        "confidence": 0.8,
    }
    base.update(over)
    return m.MetadataDraft(**base)


def test_review_filters_genres_and_slugs(monkeypatch):
    monkeypatch.setattr(m, "chat_model", lambda task: FakeModel(_draft()))
    state = {"seed": "heiress hides identity", "language": "English", "draft": _draft(genres=["Romance"])}
    out = asyncio.run(m.review(state))
    assert out["final"].genres == ["Romance"]
    assert out["slug"] == "the-heiress-in-disguise"


def test_vtt_format():
    text = to_vtt([Cue(1, 0.0, 1.5, "Hello"), Cue(2, 61.25, 63.0, "World")])
    assert text.startswith(
        "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nHello\n\n2\n00:01:01.250 --> 00:01:03.000\nWorld"
    )


def test_translate_cues_keeps_source_text_for_dropped_cues_and_counts_them(monkeypatch):
    """A cue the graph gave up on keeps its source text so the track plays through; the count is returned
    so the job can record it instead of reporting a clean success."""
    from katha_ai.graphs import subtitles as s

    async def partial(*, target_lang, items, namespace):
        assert namespace == "subtitles" and target_lang == "hi"
        return {"1": "नमस्ते"}

    monkeypatch.setattr(s, "run_translation_batch", partial)
    cues, missing = asyncio.run(
        s.translate_cues([Cue(1, 0.0, 1.0, "Hello"), Cue(2, 1.0, 2.0, "World")], target_lang="hi")
    )
    assert missing == 1
    assert [c.text for c in cues] == ["नमस्ते", "World"]
    assert [(c.start, c.end) for c in cues] == [(0.0, 1.0), (1.0, 2.0)]
