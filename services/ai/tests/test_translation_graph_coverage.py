"""Translation graph: chunking, the per-namespace prompt, placeholder validation, retries and the loop exit.

This graph exists because a single giant prompt truncated and lost placeholders, so the behaviour under test
is mostly failure handling: a chunk whose provider call blew up, a key the model silently dropped, a value
whose {placeholders} did not survive, and the two independent brakes that stop the retry loop (a key's own
retry count, and the graph's attempt counter). Every model call is a stub that reads the chunk's keys back
out of the prompt, so the assertions are about what the graph asked for and what it did with the answer.
"""

import asyncio

import pytest

from katha_ai.graphs import translation as t


def keys_from_prompt(msgs) -> list[str]:
    """Read the chunk's keys back out of the human message the node built."""
    payload = msgs[1].content.split("\n\n", 1)[1]
    return [line.split(" => ", 1)[0] for line in payload.splitlines()]


class KeyedModel:
    """A stub provider driven by a per-call responder: it gets the chunk's keys and returns the mapping to
    reply with, or raises to simulate a provider error."""

    def __init__(self, responder):
        self.responder = responder
        self.calls = []  # one entry per ainvoke: the list of keys asked for
        self.systems = []

    def with_structured_output(self, schema):
        self.schema = schema
        return self

    async def ainvoke(self, msgs):
        keys = keys_from_prompt(msgs)
        self.calls.append(keys)
        self.systems.append(msgs[0].content)
        reply = self.responder(keys, len(self.calls))
        return t.TranslationChunkOut(items=[t.TranslatedItem(key=k, value=v) for k, v in reply.items()])


def echo(prefix="xx-"):
    """Responder that translates every key it is given, placeholders intact."""

    def responder(keys, _attempt):
        return {k: f"{prefix}{k}" for k in keys}

    return responder


def install(monkeypatch, model):
    tasks = []

    def fake_chat_model(task):
        tasks.append(task)
        return model

    monkeypatch.setattr(t, "chat_model", fake_chat_model)
    return tasks


def run(coro):
    return asyncio.run(coro)


# --- chunk -------------------------------------------------------------------------------------------


def test_chunk_initialises_the_whole_working_state():
    state = t.chunk({"source": {"a": "1", "b": "2"}})
    assert state == {"pending": [["a", "b"]], "done": {}, "failed": {}, "attempt": 0}


def test_chunk_carries_previous_progress_forward():
    state = t.chunk({"source": {"a": "1", "b": "2"}, "done": {"a": "x"}, "failed": {"b": 1}})
    assert state["pending"] == [["b"]]
    assert state["done"] == {"a": "x"}
    assert state["failed"] == {"b": 1}


def test_chunk_of_an_empty_batch_has_nothing_pending():
    assert t.chunk({"source": {}})["pending"] == []


def test_chunk_splits_at_exactly_chunk_size():
    source = {f"k{i}": "v" for i in range(t.CHUNK_SIZE + 1)}
    chunks = t.chunk({"source": source})["pending"]
    assert [len(c) for c in chunks] == [t.CHUNK_SIZE, 1]


# --- _translate_chunk --------------------------------------------------------------------------------


def test_translate_chunk_prompt_names_the_language_and_lists_the_pairs():
    model = KeyedModel(echo())
    state = {"target_lang": "Hindi", "namespace": "ui", "source": {"a": "Watch now", "b": "Unlock {coins}"}}

    out = run(t._translate_chunk(model, state, ["a", "b"]))

    assert [(i.key, i.value) for i in out.items] == [("a", "xx-a"), ("b", "xx-b")]
    assert "Target language: Hindi." in model.systems[0]
    # The literal {{episodeNumber}} in the template must survive .format as a single-brace example.
    assert "Keep placeholders such as {episodeNumber} exactly as they are." in model.systems[0]
    human = model.calls  # keys were parsed out of the human message, which proves its shape
    assert human == [["a", "b"]]


@pytest.mark.parametrize(
    "namespace,marker",
    [
        ("ui", "mobile buttons"),
        ("series", "titles stay punchy"),
        ("subtitles", "never merge or split cues"),
    ],
)
def test_each_namespace_gets_its_own_instructions(namespace, marker):
    """Button labels and subtitle cues must not be translated alike."""
    model = KeyedModel(echo())
    state = {"target_lang": "Tamil", "namespace": namespace, "source": {"a": "x"}}
    run(t._translate_chunk(model, state, ["a"]))
    assert marker in model.systems[0]


def test_unknown_namespace_falls_back_to_ui():
    model = KeyedModel(echo())
    run(t._translate_chunk(model, {"target_lang": "Tamil", "namespace": "emails", "source": {"a": "x"}}, ["a"]))
    assert "mobile buttons" in model.systems[0]


def test_missing_namespace_falls_back_to_ui():
    model = KeyedModel(echo())
    run(t._translate_chunk(model, {"target_lang": "Tamil", "source": {"a": "x"}}, ["a"]))
    assert "mobile buttons" in model.systems[0]


def test_translate_chunk_swallows_a_provider_error_and_returns_none():
    """A provider error must not kill the gather: the chunk comes back as None so it can be retried."""

    class Boom:
        async def ainvoke(self, _msgs):
            raise TimeoutError("read timed out")

    out = run(t._translate_chunk(Boom(), {"target_lang": "hi", "source": {"a": "x"}}, ["a"]))
    assert out is None


# --- translate ---------------------------------------------------------------------------------------


def base_state(source, **over):
    state = {
        "target_lang": "hi",
        "namespace": "ui",
        "source": source,
        "pending": [list(source)],
        "done": {},
        "failed": {},
        "attempt": 0,
    }
    state.update(over)
    return state


def test_translate_accepts_reordered_placeholders(monkeypatch):
    """Word order changes between languages, so the check is on the set of placeholders, not the string."""
    install(monkeypatch, KeyedModel(lambda keys, _a: {"a": "{coins} के लिए {episodeNumber}"}))

    out = run(t.translate(base_state({"a": "Episode {episodeNumber} for {coins}"})))
    assert out["done"] == {"a": "{coins} के लिए {episodeNumber}"}
    assert out["failed"] == {}
    assert out["pending"] == []


def test_translate_marks_a_key_the_model_silently_dropped(monkeypatch):
    """Returning fewer keys than asked for is the failure mode the single-giant-prompt version had."""
    install(monkeypatch, KeyedModel(lambda keys, _a: {"a": "ठीक"}))

    out = run(t.translate(base_state({"a": "ok", "b": "also ok"})))
    assert out["done"] == {"a": "ठीक"}
    assert out["failed"] == {"b": 1}
    assert out["pending"] == [["b"]]


def test_translate_ignores_keys_nobody_asked_for(monkeypatch):
    install(monkeypatch, KeyedModel(lambda keys, _a: {"a": "ठीक", "hallucinated": "junk"}))

    out = run(t.translate(base_state({"a": "ok"})))
    assert out["done"] == {"a": "ठीक"}


def test_translate_retries_a_whole_chunk_after_a_provider_error(monkeypatch):
    """A chunk-level error costs the keys no retry budget — only the graph's attempt counter bounds it."""

    class Boom:
        def with_structured_output(self, _):
            return self

        async def ainvoke(self, _msgs):
            raise RuntimeError("503 from provider")

    monkeypatch.setattr(t, "chat_model", lambda task: Boom())

    out = run(t.translate(base_state({"a": "ok", "b": "fine"})))
    assert out["done"] == {}
    assert out["failed"] == {}  # not charged against MAX_RETRIES
    assert out["pending"] == [["a", "b"]]
    assert out["attempt"] == 1


def test_translate_uses_the_translation_task_provider(monkeypatch):
    tasks = install(monkeypatch, KeyedModel(echo()))
    run(t.translate(base_state({"a": "ok"})))
    assert tasks == ["translation"]


def test_translate_gives_up_on_a_key_past_max_retries(monkeypatch):
    """Once a key has burned its retries it is dropped, and an emptied chunk does not survive as [] ."""
    install(monkeypatch, KeyedModel(lambda keys, _a: {"a": "no placeholder here"}))

    out = run(t.translate(base_state({"a": "Coins: {coins}"}, failed={"a": t.MAX_RETRIES}, attempt=2)))
    assert out["failed"] == {"a": t.MAX_RETRIES + 1}
    assert out["done"] == {}
    assert out["pending"] == []  # the empty retry chunk is filtered out, so the loop can end


def test_translate_keeps_good_keys_from_a_partly_bad_chunk(monkeypatch):
    install(
        monkeypatch,
        KeyedModel(lambda keys, _a: {"a": "अच्छा", "b": "बिना प्लेसहोल्डर", "c": "{coins} सिक्के"}),
    )

    out = run(t.translate(base_state({"a": "good", "b": "Episode {episodeNumber}", "c": "{coins} coins"})))
    assert out["done"] == {"a": "अच्छा", "c": "{coins} सिक्के"}
    assert out["pending"] == [["b"]]


def test_translate_runs_chunks_concurrently_but_bounded(monkeypatch):
    """Chunks go out in parallel; the semaphore keeps a big batch from opening unbounded connections."""
    peak = 0
    live = 0

    class Counting:
        def with_structured_output(self, _):
            return self

        async def ainvoke(self, msgs):
            nonlocal peak, live
            live += 1
            peak = max(peak, live)
            await asyncio.sleep(0)  # let every other queued chunk get a turn
            live -= 1
            keys = keys_from_prompt(msgs)
            return t.TranslationChunkOut(items=[t.TranslatedItem(key=k, value=k) for k in keys])

    monkeypatch.setattr(t, "chat_model", lambda task: Counting())
    source = {f"k{i}": f"v{i}" for i in range(12)}
    state = base_state(source, pending=[[f"k{i}"] for i in range(12)])

    out = run(t.translate(state))
    assert len(out["done"]) == 12
    assert peak == t.MAX_CONCURRENT_CHUNKS


# --- should_retry ------------------------------------------------------------------------------------


def test_should_retry_loops_while_work_remains_and_budget_is_left():
    assert t.should_retry({"pending": [["a"]], "attempt": t.MAX_RETRIES}) == "translate"


def test_should_retry_stops_when_nothing_is_pending():
    from langgraph.graph import END

    assert t.should_retry({"pending": [], "attempt": 0}) == END


def test_should_retry_stops_once_the_attempt_budget_is_spent():
    from langgraph.graph import END

    assert t.should_retry({"pending": [["a"]], "attempt": t.MAX_RETRIES + 1}) == END


# --- run_translation_batch (compiled graph) ----------------------------------------------------------


def test_batch_translates_everything_in_one_pass(monkeypatch):
    monkeypatch.setattr(t, "_graph", None)
    model = KeyedModel(echo("hi-"))
    install(monkeypatch, model)

    out = run(t.run_translation_batch(target_lang="hi", items={"a": "A", "b": "B"}, namespace="series"))

    assert out == {"a": "hi-a", "b": "hi-b"}
    assert len(model.calls) == 1
    assert "titles stay punchy" in model.systems[0]


def test_batch_defaults_to_the_ui_namespace(monkeypatch):
    monkeypatch.setattr(t, "_graph", None)
    model = KeyedModel(echo())
    install(monkeypatch, model)

    run(t.run_translation_batch(target_lang="hi", items={"a": "A"}))
    assert "mobile buttons" in model.systems[0]


def test_batch_retries_only_the_failed_key_and_merges_the_result(monkeypatch):
    """The whole point of chunk-level retry: the second call carries one key, not the whole batch."""
    monkeypatch.setattr(t, "_graph", None)

    def flaky(keys, attempt):
        if attempt == 1:
            return {"a": "ठीक", "b": "प्लेसहोल्डर खो गया"}  # b loses {coins}
        return {k: f"{k}-{{coins}}" for k in keys}

    model = KeyedModel(flaky)
    install(monkeypatch, model)

    out = run(t.run_translation_batch(target_lang="hi", items={"a": "ok", "b": "Buy {coins}"}))

    assert out == {"a": "ठीक", "b": "b-{coins}"}
    assert model.calls == [["a", "b"], ["b"]]


def test_batch_returns_the_partial_result_when_a_key_never_recovers(monkeypatch):
    """A key that burns every retry is left out rather than returned wrong; the caller sees the gap."""
    monkeypatch.setattr(t, "_graph", None)
    model = KeyedModel(lambda keys, _a: {k: "no placeholder" for k in keys})
    install(monkeypatch, model)

    out = run(t.run_translation_batch(target_lang="hi", items={"a": "Buy {coins}", "b": "plain"}))

    assert out == {"b": "no placeholder"}
    assert model.calls == [["a", "b"], ["a"], ["a"]]  # initial pass plus MAX_RETRIES


def test_batch_stops_after_the_attempt_budget_when_the_provider_is_down(monkeypatch):
    """No key ever gets a retry count when the provider errors, so only the attempt counter ends the loop."""
    monkeypatch.setattr(t, "_graph", None)
    calls = []

    class Down:
        def with_structured_output(self, _):
            return self

        async def ainvoke(self, msgs):
            calls.append(keys_from_prompt(msgs))
            raise ConnectionError("connection refused")

    monkeypatch.setattr(t, "chat_model", lambda task: Down())

    out = run(t.run_translation_batch(target_lang="hi", items={"a": "A"}))
    assert out == {}
    assert calls == [["a"], ["a"], ["a"]]


def test_batch_of_nothing_does_not_call_the_model(monkeypatch):
    monkeypatch.setattr(t, "_graph", None)
    model = KeyedModel(echo())
    install(monkeypatch, model)

    assert run(t.run_translation_batch(target_lang="hi", items={})) == {}
    assert model.calls == []


def test_batch_splits_a_large_batch_into_chunks(monkeypatch):
    monkeypatch.setattr(t, "_graph", None)
    model = KeyedModel(echo())
    install(monkeypatch, model)
    items = {f"k{i}": f"v{i}" for i in range(t.CHUNK_SIZE * 2 + 5)}

    out = run(t.run_translation_batch(target_lang="hi", items=items))

    assert len(out) == len(items)
    assert [len(c) for c in model.calls] == [t.CHUNK_SIZE, t.CHUNK_SIZE, 5]


def test_batch_reuses_the_compiled_graph(monkeypatch):
    monkeypatch.setattr(t, "_graph", None)
    install(monkeypatch, KeyedModel(echo()))

    run(t.run_translation_batch(target_lang="hi", items={"a": "A"}))
    compiled = t._graph
    run(t.run_translation_batch(target_lang="hi", items={"a": "A"}))
    assert t._graph is compiled
