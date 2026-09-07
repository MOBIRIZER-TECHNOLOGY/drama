"""Translation graph.

chunk -> translate (structured output, chunks in parallel) -> validate placeholders -> retry failed chunks -> merge

Fixes the vendor's single-giant-prompt approach: each chunk is small enough never to truncate, and a
chunk whose placeholders ({episodeNumber}, {coins}) do not survive is retried on its own. The system prompt
is chosen by namespace (ui, series, subtitles) so button labels and subtitle cues are not translated alike.
"""

import asyncio
import re
from typing import TypedDict

import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph
from pydantic import BaseModel, Field

from katha_ai.providers import chat_model

log = structlog.get_logger()

CHUNK_SIZE = 40
MAX_RETRIES = 2
MAX_CONCURRENT_CHUNKS = 4
_PLACEHOLDER = re.compile(r"\{[a-zA-Z0-9_]+\}")


class TranslatedItem(BaseModel):
    key: str
    value: str


class TranslationChunkOut(BaseModel):
    items: list[TranslatedItem] = Field(description="One entry per input key, same keys, translated values")


class State(TypedDict, total=False):
    target_lang: str
    namespace: str
    source: dict[str, str]
    pending: list[list[str]]  # chunks of keys still to translate
    done: dict[str, str]
    failed: dict[str, int]  # key -> retry count
    attempt: int


_BASE = (
    "You translate for Katha, a short-drama streaming app (vertical 1-2 minute episodes, cliffhanger-driven). "
    "Target language: {lang}. Keep placeholders such as {{episodeNumber}} exactly as they are. "
    "Use natural, contemporary phrasing, not literal. Return every key you were given. "
)
SYSTEM_BY_NAMESPACE = {
    "ui": _BASE + "These are product UI strings and short marketing copy: keep them short enough for mobile buttons.",
    "series": _BASE
    + "These are series titles, synopses and SEO fields: keep the drama and the hook; titles stay punchy.",
    "subtitles": _BASE
    + "These are subtitle cues in order: keep each cue short (max ~42 characters per line), conversational, "
    "matching the speaker's tone; never merge or split cues.",
}


def chunk(state: State) -> State:
    keys = [k for k in state["source"] if k not in state.get("done", {})]
    chunks = [keys[i : i + CHUNK_SIZE] for i in range(0, len(keys), CHUNK_SIZE)]
    return {"pending": chunks, "done": state.get("done", {}), "failed": state.get("failed", {}), "attempt": 0}


async def _translate_chunk(model, state: State, keys: list[str]) -> TranslationChunkOut | None:
    payload = "\n".join(f"{k} => {state['source'][k]}" for k in keys)
    system = SYSTEM_BY_NAMESPACE.get(state.get("namespace", "ui"), SYSTEM_BY_NAMESPACE["ui"])
    try:
        return await model.ainvoke(
            [
                SystemMessage(content=system.format(lang=state["target_lang"])),
                HumanMessage(content=f"Translate these {len(keys)} strings. Format: key => text\n\n{payload}"),
            ]
        )
    except Exception as exc:  # noqa: BLE001 - provider error, retry the whole chunk
        log.warning("translation.chunk_error", error=str(exc), size=len(keys))
        return None


async def translate(state: State) -> State:
    model = chat_model("translation").with_structured_output(TranslationChunkOut)
    done = dict(state["done"])
    failed = dict(state["failed"])
    retry_chunks: list[list[str]] = []
    sem = asyncio.Semaphore(MAX_CONCURRENT_CHUNKS)

    async def guarded(keys: list[str]):
        async with sem:
            return keys, await _translate_chunk(model, state, keys)

    results = await asyncio.gather(*(guarded(keys) for keys in state["pending"]))
    for keys, out in results:
        if out is None:
            retry_chunks.append(keys)
            continue
        got = {i.key: i.value for i in out.items}
        bad: list[str] = []
        for k in keys:
            value = got.get(k)
            if value is None or set(_PLACEHOLDER.findall(state["source"][k])) != set(_PLACEHOLDER.findall(value)):
                bad.append(k)
            else:
                done[k] = value
        if bad:
            for k in bad:
                failed[k] = failed.get(k, 0) + 1
            retry_chunks.append([k for k in bad if failed[k] <= MAX_RETRIES])
    return {"done": done, "failed": failed, "pending": [c for c in retry_chunks if c], "attempt": state["attempt"] + 1}


def should_retry(state: State) -> str:
    if state["pending"] and state["attempt"] <= MAX_RETRIES:
        return "translate"
    return END


def build_graph():
    g = StateGraph(State)
    g.add_node("chunk", chunk)
    g.add_node("translate", translate)
    g.set_entry_point("chunk")
    g.add_edge("chunk", "translate")
    g.add_conditional_edges("translate", should_retry, {"translate": "translate", END: END})
    return g.compile()


_graph = None


async def run_translation_batch(*, target_lang: str, items: dict[str, str], namespace: str = "ui") -> dict[str, str]:
    global _graph
    if _graph is None:
        _graph = build_graph()
    result = await _graph.ainvoke({"target_lang": target_lang, "namespace": namespace, "source": items})
    missing = [k for k in items if k not in result["done"]]
    if missing:
        log.warning("translation.incomplete", lang=target_lang, missing=len(missing))
    return result["done"]
