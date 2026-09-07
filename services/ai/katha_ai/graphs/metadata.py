"""Content metadata graph.

draft -> review -> (moderation flags) -> done

Given whatever the editor has (a seed sentence, an existing title, a synopsis, an optional transcript), produce
publish-ready metadata in the requested language plus a content rating and moderation flags. The review node
re-reads the draft as a demanding editor and tightens it; the output goes to the admin form for human approval,
never straight to publish.
"""

import re
from typing import Literal, TypedDict

import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph
from pydantic import BaseModel, Field

from katha_ai.providers import chat_model

log = structlog.get_logger()

GENRES = ["Romance", "Revenge", "Drama", "Fantasy", "Comedy", "Thriller", "Family", "Action", "Mystery", "Historical"]


class MetadataDraft(BaseModel):
    title: str = Field(description="Punchy series title, max 60 characters, no quotes")
    synopsis: str = Field(description="2 to 3 sentences, present tense, ends on the hook, max 400 characters")
    genres: list[str] = Field(description=f"1 to 3 from: {', '.join(GENRES)}")
    tags: list[str] = Field(description="5 to 10 lowercase search tags")
    seo_title: str = Field(description="Max 60 characters")
    meta_description: str = Field(description="Max 155 characters")
    keywords: list[str] = Field(description="5 to 7 SEO keywords")
    content_rating: Literal["U", "UA7", "UA13", "UA16", "A"] = Field(description="Indian CBFC-style rating")
    moderation_flags: list[str] = Field(
        default_factory=list, description="e.g. violence, sexual_content, substance_use; empty if none"
    )
    confidence: float = Field(ge=0, le=1, description="How well the source material supports this metadata")


class State(TypedDict, total=False):
    language: str
    seed: str
    title: str | None
    synopsis: str | None
    transcript: str | None
    draft: MetadataDraft
    final: MetadataDraft
    slug: str


SYSTEM = (
    "You write metadata for Katha, a short-drama streaming app (vertical 1-2 minute episodes, cliffhanger-driven, "
    "popular genres: revenge, secret heiress, contract marriage, billionaire romance, family betrayal). "
    "Write in {language}. Be specific to the story; never generic. Never invent cast names. "
    "Rate content conservatively."
)


def _source(state: State) -> str:
    parts = [f"Seed: {state['seed']}"]
    if state.get("title"):
        parts.append(f"Existing title: {state['title']}")
    if state.get("synopsis"):
        parts.append(f"Existing synopsis: {state['synopsis']}")
    if state.get("transcript"):
        parts.append(f"Transcript excerpt (first episodes):\n{state['transcript'][:6000]}")
    return "\n\n".join(parts)


async def draft(state: State) -> State:
    model = chat_model("metadata").with_structured_output(MetadataDraft)
    out: MetadataDraft = await model.ainvoke(
        [
            SystemMessage(content=SYSTEM.format(language=state.get("language", "English"))),
            HumanMessage(content=f"Produce metadata from this material:\n\n{_source(state)}"),
        ]
    )
    return {"draft": out}


async def review(state: State) -> State:
    model = chat_model("metadata").with_structured_output(MetadataDraft)
    d = state["draft"]
    out: MetadataDraft = await model.ainvoke(
        [
            SystemMessage(content=SYSTEM.format(language=state.get("language", "English"))),
            HumanMessage(
                content=(
                    "You are the commissioning editor. Tighten this draft: shorter title if over 60 chars, synopsis must "
                    "end on the hook, tags must be searchable phrases a viewer would type, genres only from the allowed "
                    "list, keep the rating unless clearly wrong. Return the improved version.\n\n"
                    f"Source material:\n{_source(state)}\n\nDraft:\n{d.model_dump_json(indent=2)}"
                )
            ),
        ]
    )
    out.genres = [g for g in out.genres if g in GENRES][:3] or d.genres[:3]
    return {"final": out, "slug": slugify(out.title)}


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:150]


def build_graph():
    g = StateGraph(State)
    g.add_node("draft", draft)
    g.add_node("review", review)
    g.set_entry_point("draft")
    g.add_edge("draft", "review")
    g.add_edge("review", END)
    return g.compile()


_graph = None


async def generate_metadata(
    *,
    seed: str,
    language: str = "English",
    title: str | None = None,
    synopsis: str | None = None,
    transcript: str | None = None,
) -> dict:
    global _graph
    if _graph is None:
        _graph = build_graph()
    result = await _graph.ainvoke(
        {"seed": seed, "language": language, "title": title, "synopsis": synopsis, "transcript": transcript}
    )
    final: MetadataDraft = result["final"]
    return {**final.model_dump(), "slug": result["slug"]}
