"""Graph logic tests with the model stubbed out. No network."""

from katha_ai.graphs import translation as t


def test_chunk_splits_and_skips_done():
    source = {f"k{i}": f"v{i}" for i in range(95)}
    state = t.chunk({"source": source, "done": {"k0": "x"}})
    assert sum(len(c) for c in state["pending"]) == 94
    assert all(len(c) <= t.CHUNK_SIZE for c in state["pending"])


def test_placeholder_validation_marks_failed(monkeypatch):
    class FakeModel:
        def with_structured_output(self, _):
            return self

        async def ainvoke(self, _msgs):
            return t.TranslationChunkOut(
                items=[t.TranslatedItem(key="a", value="ठीक {coins}"), t.TranslatedItem(key="b", value="टूटा")]
            )

    monkeypatch.setattr(t, "chat_model", lambda task: FakeModel())
    state = {
        "target_lang": "hi",
        "source": {"a": "ok {coins}", "b": "broken {episodeNumber}"},
        "pending": [["a", "b"]],
        "done": {},
        "failed": {},
        "attempt": 0,
    }
    import asyncio

    out = asyncio.run(t.translate(state))
    assert out["done"] == {"a": "ठीक {coins}"}
    assert out["failed"] == {"b": 1}
    assert out["pending"] == [["b"]]
    assert t.should_retry(out) == "translate"
