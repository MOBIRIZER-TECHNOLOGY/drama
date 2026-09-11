"""Metadata graph: the prompt material, both nodes, the draft -> review -> END wiring, and slugging.

What matters here is that the editor's partial input becomes one well-formed source block, that the review
node is the last line of defence on genres (the model is free to invent one), and that the public
`generate_metadata` really runs both nodes and returns the reviewed version rather than the draft. The model
is a stub throughout; the only thing the real provider would add is latency.
"""

import asyncio

import pytest

from katha_ai.graphs import metadata as m

BASE_DRAFT = {
    "title": "The Heiress in Disguise",
    "synopsis": "A wealthy heiress hides her identity. She falls for the wrong man. Then he learns who she is.",
    "genres": ["Romance"],
    "tags": ["heiress", "secret identity"],
    "seo_title": "The Heiress in Disguise",
    "meta_description": "A heiress hides who she is and falls for the wrong man.",
    "keywords": ["heiress", "romance"],
    "content_rating": "UA13",
    "moderation_flags": [],
    "confidence": 0.8,
}


def draft_model(**over) -> m.MetadataDraft:
    return m.MetadataDraft(**{**BASE_DRAFT, **over})


class RecordingModel:
    """Returns a queued output per call and keeps the messages it was handed, so a test can assert what
    the node actually put in front of the model."""

    def __init__(self, *outputs):
        self.outputs = list(outputs)
        self.calls = []
        self.schemas = []

    def with_structured_output(self, schema):
        self.schemas.append(schema)
        return self

    async def ainvoke(self, msgs):
        self.calls.append(msgs)
        return self.outputs.pop(0) if len(self.outputs) > 1 else self.outputs[0]


def install(monkeypatch, model):
    """Replace the provider lookup and record which task each node asked for."""
    tasks = []

    def fake_chat_model(task):
        tasks.append(task)
        return model

    monkeypatch.setattr(m, "chat_model", fake_chat_model)
    return tasks


def test_source_with_only_a_seed():
    assert m._source({"seed": "heiress hides identity"}) == "Seed: heiress hides identity"


def test_source_skips_fields_the_editor_left_empty():
    """Empty strings are as absent as None — an empty "Existing synopsis:" heading would just mislead."""
    text = m._source({"seed": "s", "title": None, "synopsis": "", "transcript": None})
    assert text == "Seed: s"


def test_source_includes_every_field_the_editor_supplied():
    text = m._source({"seed": "s", "title": "Old Title", "synopsis": "Old synopsis", "transcript": "line one"})
    assert text.split("\n\n") == [
        "Seed: s",
        "Existing title: Old Title",
        "Existing synopsis: Old synopsis",
        "Transcript excerpt (first episodes):\nline one",
    ]


def test_source_truncates_a_long_transcript():
    """A full episode transcript would blow the context window, so only the opening 6000 chars go in."""
    text = m._source({"seed": "s", "transcript": "x" * 9000})
    body = text.split("Transcript excerpt (first episodes):\n")[1]
    assert body == "x" * 6000


def test_draft_node_prompts_in_the_requested_language_and_returns_the_draft(monkeypatch):
    expected = draft_model()
    model = RecordingModel(expected)
    tasks = install(monkeypatch, model)

    out = asyncio.run(m.draft({"seed": "heiress hides identity", "language": "Hindi"}))

    assert out == {"draft": expected}
    assert tasks == ["metadata"]
    assert model.schemas == [m.MetadataDraft]
    system, human = model.calls[0]
    assert "Write in Hindi." in system.content
    assert "Seed: heiress hides identity" in human.content


def test_draft_node_defaults_to_english(monkeypatch):
    model = RecordingModel(draft_model())
    install(monkeypatch, model)

    asyncio.run(m.draft({"seed": "s"}))
    assert "Write in English." in model.calls[0][0].content


def test_review_node_shows_the_model_the_draft_and_the_source(monkeypatch):
    model = RecordingModel(draft_model(title="Heiress Undercover"))
    tasks = install(monkeypatch, model)

    out = asyncio.run(m.review({"seed": "heiress hides identity", "draft": draft_model()}))

    assert tasks == ["metadata"]
    human = model.calls[0][1].content
    assert "commissioning editor" in human
    assert "Seed: heiress hides identity" in human
    assert '"title": "The Heiress in Disguise"' in human  # the draft, serialised for the editor pass
    assert out["final"].title == "Heiress Undercover"
    assert out["slug"] == "heiress-undercover"


def test_review_drops_invented_genres_and_caps_at_three(monkeypatch):
    """The schema description lists the allowed genres but cannot enforce them, so the node filters."""
    returned = draft_model(genres=["Romance", "Spy Thriller", "Revenge", "Drama", "Mystery"])
    install(monkeypatch, RecordingModel(returned))

    out = asyncio.run(m.review({"seed": "s", "draft": draft_model()}))
    assert out["final"].genres == ["Romance", "Revenge", "Drama"]


def test_review_falls_back_to_the_draft_genres_when_none_survive(monkeypatch):
    """Better the draft's genres than an empty list the admin form would have to fill in by hand."""
    install(monkeypatch, RecordingModel(draft_model(genres=["Spy Thriller", "Cooking"])))

    out = asyncio.run(m.review({"seed": "s", "draft": draft_model(genres=["Romance", "Drama", "Family", "Action"])}))
    assert out["final"].genres == ["Romance", "Drama", "Family"]


def test_review_propagates_a_provider_failure(monkeypatch):
    """There is no retry or fallback on this graph: a provider error surfaces to the caller."""

    class FailingModel:
        def with_structured_output(self, _):
            return self

        async def ainvoke(self, _msgs):
            raise RuntimeError("anthropic overloaded")

    monkeypatch.setattr(m, "chat_model", lambda task: FailingModel())
    with pytest.raises(RuntimeError, match="anthropic overloaded"):
        asyncio.run(m.review({"seed": "s", "draft": draft_model()}))


def test_review_breaks_on_a_draft_that_is_not_a_metadata_draft(monkeypatch):
    """If structured output ever hands back a plain dict, the review node has no defence: it calls
    model_dump_json on it. Pinning the current behaviour, not endorsing it."""
    install(monkeypatch, RecordingModel(draft_model()))

    with pytest.raises(AttributeError):
        asyncio.run(m.review({"seed": "s", "draft": dict(BASE_DRAFT)}))


def test_schema_rejects_a_confidence_outside_zero_to_one():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        draft_model(confidence=1.4)


def test_schema_rejects_a_rating_outside_the_cbfc_ladder():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        draft_model(content_rating="R")


def test_moderation_flags_default_to_empty():
    bare = {k: v for k, v in BASE_DRAFT.items() if k != "moderation_flags"}
    assert m.MetadataDraft(**bare).moderation_flags == []


def test_slugify_lowercases_and_collapses_punctuation():
    assert m.slugify("The Heiress in Disguise!") == "the-heiress-in-disguise"
    assert m.slugify("  Revenge, Served Cold  ") == "revenge-served-cold"
    assert m.slugify("Season 2: The Return") == "season-2-the-return"


def test_slugify_caps_length_at_150():
    assert len(m.slugify("word " * 100)) == 150


def test_slugify_returns_an_empty_slug_for_a_non_latin_title():
    """BUG (pinned, not fixed): the regex keeps only a-z0-9, so a Hindi or Chinese title — exactly what
    the graph produces when `language` is not English — slugs to the empty string, and two such series
    would collide on it."""
    assert m.slugify("रहस्यमयी उत्तराधिकारी") == ""
    assert m.slugify("Café Romance") == "caf-romance"


def test_build_graph_runs_draft_then_review_and_stops(monkeypatch):
    first, second = draft_model(title="Draft Title"), draft_model(title="Reviewed Title")
    model = RecordingModel(first, second)
    install(monkeypatch, model)

    graph = m.build_graph()
    result = asyncio.run(graph.ainvoke({"seed": "heiress hides identity", "language": "English"}))

    assert len(model.calls) == 2  # draft, then review; no loop back
    assert result["draft"] is first
    assert result["final"] is second
    assert result["slug"] == "reviewed-title"


def test_generate_metadata_returns_the_reviewed_metadata_plus_the_slug(monkeypatch):
    monkeypatch.setattr(m, "_graph", None)  # the module memoises the compiled graph
    model = RecordingModel(draft_model(title="Draft Title"), draft_model(title="Reviewed Title", tags=["a"]))
    install(monkeypatch, model)

    out = asyncio.run(
        m.generate_metadata(seed="heiress hides identity", language="English", title="Old", transcript="t")
    )

    assert out["title"] == "Reviewed Title"  # the reviewed version, never the draft
    assert out["slug"] == "reviewed-title"
    assert out["tags"] == ["a"]
    assert set(out) == set(m.MetadataDraft.model_fields) | {"slug"}
    # The optional material the caller passed reached the prompt.
    assert "Existing title: Old" in model.calls[0][1].content


def test_generate_metadata_reuses_the_compiled_graph(monkeypatch):
    monkeypatch.setattr(m, "_graph", None)
    install(monkeypatch, RecordingModel(draft_model()))

    asyncio.run(m.generate_metadata(seed="s"))
    compiled = m._graph
    asyncio.run(m.generate_metadata(seed="s"))
    assert m._graph is compiled
