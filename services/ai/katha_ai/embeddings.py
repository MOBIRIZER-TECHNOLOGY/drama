"""Embeddings for similar-series and semantic search. Vectors are 1024-d to match the pgvector column."""

from functools import lru_cache
from typing import Literal

from langchain_core.embeddings import Embeddings
from pydantic_settings import BaseSettings, SettingsConfigDict

DIMENSIONS = 1024
EmbeddingProvider = Literal["openai", "voyage", "google"]


class EmbeddingSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KATHA_AI_EMBED_", env_file=".env", extra="ignore")

    provider: EmbeddingProvider = "openai"
    openai_model: str = "text-embedding-3-small"  # supports the `dimensions` parameter
    voyage_model: str = "voyage-3"  # natively 1024-d
    google_model: str = "text-embedding-004"  # 768-d, padded (see embed())


@lru_cache
def get_embedding_settings() -> EmbeddingSettings:
    return EmbeddingSettings()


@lru_cache
def embedder() -> Embeddings:
    s = get_embedding_settings()
    if s.provider == "openai":
        from langchain_openai import OpenAIEmbeddings

        return OpenAIEmbeddings(model=s.openai_model, dimensions=DIMENSIONS)
    if s.provider == "voyage":
        from langchain_voyageai import VoyageAIEmbeddings

        return VoyageAIEmbeddings(model=s.voyage_model)
    if s.provider == "google":
        from langchain_google_genai import GoogleGenerativeAIEmbeddings

        return GoogleGenerativeAIEmbeddings(model=f"models/{s.google_model}")
    raise ValueError(f"unknown embedding provider {s.provider}")


def model_name() -> str:
    s = get_embedding_settings()
    return {"openai": s.openai_model, "voyage": s.voyage_model, "google": s.google_model}[s.provider]


def _fit(vec: list[float]) -> list[float]:
    if len(vec) == DIMENSIONS:
        return vec
    if len(vec) > DIMENSIONS:
        return vec[:DIMENSIONS]
    return vec + [0.0] * (DIMENSIONS - len(vec))


async def embed_documents(texts: list[str]) -> list[list[float]]:
    vectors = await embedder().aembed_documents(texts)
    return [_fit(v) for v in vectors]


async def embed_query(text: str) -> list[float]:
    return _fit(await embedder().aembed_query(text))


def series_document(*, title: str, synopsis: str | None, categories: list[str], tags: list[str]) -> str:
    """One canonical text per series so the vector is stable across re-embeds."""
    parts = [f"Title: {title}"]
    if synopsis:
        parts.append(f"Synopsis: {synopsis}")
    if categories:
        parts.append(f"Genres: {', '.join(categories)}")
    if tags:
        parts.append(f"Tags: {', '.join(tags)}")
    return "\n".join(parts)
