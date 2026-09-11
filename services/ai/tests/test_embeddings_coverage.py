"""Embedding provider selection, the 1024-d fit, and the canonical series document.

The pgvector column is a fixed width, so the contract that actually matters is that every vector leaving
this module is exactly DIMENSIONS long no matter which provider produced it — Google's 768-d model gets
padded, anything longer gets truncated. The rest is registry behaviour: the right client per provider, the
model name reported alongside stored vectors, and the guard for a provider the registry does not know.
No network: the embedding clients are constructed but never called, and the async paths use a stub.
"""

import asyncio

import pytest

from katha_ai import embeddings as e

KEY_VARS = ("OPENAI_API_KEY", "VOYAGE_API_KEY", "VOYAGEAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY")


class StubEmbeddings:
    """Stands in for a provider client; records what it was asked to embed."""

    def __init__(self, vectors):
        self.vectors = vectors
        self.seen = []

    async def aembed_documents(self, texts):
        self.seen.append(texts)
        return self.vectors

    async def aembed_query(self, text):
        self.seen.append(text)
        return self.vectors[0]


@pytest.fixture
def clean_env(monkeypatch):
    """Both get_embedding_settings and embedder are lru_cached, so a stale entry from one test would
    silently decide the next one's provider."""
    for name in KEY_VARS:
        monkeypatch.delenv(name, raising=False)
    for name in ("KATHA_AI_EMBED_PROVIDER", "KATHA_AI_EMBED_OPENAI_MODEL", "KATHA_AI_EMBED_OLLAMA_BASE_URL"):
        monkeypatch.delenv(name, raising=False)
    # Hold the real cached functions: a test may replace the module attributes, and this fixture tears
    # down before monkeypatch restores them.
    settings_cache, embedder_cache = e.get_embedding_settings, e.embedder
    settings_cache.cache_clear()
    embedder_cache.cache_clear()
    yield monkeypatch
    settings_cache.cache_clear()
    embedder_cache.cache_clear()


def _select(clean_env, provider):
    clean_env.setenv("KATHA_AI_EMBED_PROVIDER", provider)
    e.get_embedding_settings.cache_clear()
    e.embedder.cache_clear()


def test_defaults_are_openai_at_the_pgvector_width(clean_env):
    s = e.get_embedding_settings()
    assert e.DIMENSIONS == 1024
    assert s.provider == "openai"
    assert s.openai_model == "text-embedding-3-small"
    assert e.get_embedding_settings() is s  # cached


def test_openai_client_asks_for_the_pgvector_width(clean_env):
    from langchain_openai import OpenAIEmbeddings

    clean_env.setenv("OPENAI_API_KEY", "test-key-not-real")
    client = e.embedder()
    assert isinstance(client, OpenAIEmbeddings)
    assert client.model == "text-embedding-3-small"
    # text-embedding-3-small is natively 1536-d; the explicit request is what keeps it at 1024.
    assert client.dimensions == e.DIMENSIONS
    assert e.model_name() == "text-embedding-3-small"


def test_voyage_client_is_native_width(clean_env):
    from langchain_voyageai import VoyageAIEmbeddings

    clean_env.setenv("VOYAGE_API_KEY", "test-key-not-real")
    _select(clean_env, "voyage")
    client = e.embedder()
    assert isinstance(client, VoyageAIEmbeddings)
    assert client.model == "voyage-3"
    assert e.model_name() == "voyage-3"


def test_google_client_gets_the_models_prefix(clean_env):
    from langchain_google_genai import GoogleGenerativeAIEmbeddings

    clean_env.setenv("GOOGLE_API_KEY", "test-key-not-real")
    _select(clean_env, "google")
    client = e.embedder()
    assert isinstance(client, GoogleGenerativeAIEmbeddings)
    assert client.model == "models/text-embedding-004"
    # The stored name is the bare model, not the API path.
    assert e.model_name() == "text-embedding-004"


def test_ollama_client_needs_no_key(clean_env):
    from langchain_ollama import OllamaEmbeddings

    _select(clean_env, "ollama")
    clean_env.setenv("KATHA_AI_EMBED_OLLAMA_BASE_URL", "http://10.0.0.5:11434")
    e.get_embedding_settings.cache_clear()
    e.embedder.cache_clear()

    client = e.embedder()
    assert isinstance(client, OllamaEmbeddings)
    assert client.model == "mxbai-embed-large"
    assert client.base_url == "http://10.0.0.5:11434"
    assert e.model_name() == "mxbai-embed-large"


def test_embedder_is_cached(clean_env):
    clean_env.setenv("OPENAI_API_KEY", "test-key-not-real")
    assert e.embedder() is e.embedder()


def test_unknown_provider_is_rejected_by_settings(clean_env):
    from pydantic import ValidationError

    _select(clean_env, "cohere")
    with pytest.raises(ValidationError):
        e.get_embedding_settings()


def test_embedder_guard_raises_for_a_provider_it_cannot_build(clean_env, monkeypatch):
    """Settings validation normally stops a bad name, so the guard is only reachable if a provider is
    added to the Literal without a branch here. model_construct skips validation to reach it."""
    monkeypatch.setattr(e, "get_embedding_settings", lambda: e.EmbeddingSettings.model_construct(provider="cohere"))
    e.embedder.cache_clear()
    with pytest.raises(ValueError, match="unknown embedding provider cohere"):
        e.embedder()


def test_model_name_has_no_entry_for_an_unknown_provider(clean_env, monkeypatch):
    monkeypatch.setattr(e, "get_embedding_settings", lambda: e.EmbeddingSettings.model_construct(provider="cohere"))
    with pytest.raises(KeyError):
        e.model_name()


def test_fit_leaves_an_exact_width_vector_untouched():
    vec = [0.5] * e.DIMENSIONS
    assert e._fit(vec) is vec


def test_fit_truncates_a_wider_vector():
    vec = [float(i) for i in range(e.DIMENSIONS + 512)]
    fitted = e._fit(vec)
    assert len(fitted) == e.DIMENSIONS
    assert fitted[-1] == float(e.DIMENSIONS - 1)


def test_fit_zero_pads_a_narrower_vector():
    """Google's 768-d model lands here; the tail is zeros so the stored vector still fits the column."""
    vec = [1.0] * 768
    fitted = e._fit(vec)
    assert len(fitted) == e.DIMENSIONS
    assert fitted[:768] == vec
    assert set(fitted[768:]) == {0.0}


def test_embed_documents_fits_every_vector(monkeypatch):
    stub = StubEmbeddings([[1.0] * 768, [2.0] * (e.DIMENSIONS + 3)])
    monkeypatch.setattr(e, "embedder", lambda: stub)

    out = asyncio.run(e.embed_documents(["a", "b"]))
    assert [len(v) for v in out] == [e.DIMENSIONS, e.DIMENSIONS]
    assert out[0][767] == 1.0 and out[0][768] == 0.0
    assert out[1][-1] == 2.0
    assert stub.seen == [["a", "b"]]


def test_embed_query_fits_the_single_vector(monkeypatch):
    stub = StubEmbeddings([[3.0] * 10])
    monkeypatch.setattr(e, "embedder", lambda: stub)

    out = asyncio.run(e.embed_query("secret heiress"))
    assert len(out) == e.DIMENSIONS
    assert out[:10] == [3.0] * 10
    assert stub.seen == ["secret heiress"]


def test_series_document_includes_every_field_in_a_stable_order():
    doc = e.series_document(
        title="The Heiress in Disguise",
        synopsis="She hides who she is.",
        categories=["Romance", "Drama"],
        tags=["heiress", "secret identity"],
    )
    assert doc == (
        "Title: The Heiress in Disguise\n"
        "Synopsis: She hides who she is.\n"
        "Genres: Romance, Drama\n"
        "Tags: heiress, secret identity"
    )


def test_series_document_omits_empty_sections():
    """A title-only series must still produce a document, and must produce the same one every re-embed."""
    doc = e.series_document(title="Untitled", synopsis=None, categories=[], tags=[])
    assert doc == "Title: Untitled"
    assert doc == e.series_document(title="Untitled", synopsis="", categories=[], tags=[])
