"""Provider registry.

Admin picks a provider per graph (mirrors the vendor's aiProvider switch, but per task). Keys come from the
environment only. Claude Opus 5 is the default for metadata, translation and moderation.

`ollama` targets a self-hosted server, which is the cheapest way to run the high-volume, low-stakes tasks
(subtitle cleanup, bulk translation drafts) without paying per token. It needs no API key — only a reachable
base URL — so it is the one provider whose availability depends on the network rather than on a secret.
"""

from functools import lru_cache
from typing import Literal

from langchain_core.language_models import BaseChatModel
from pydantic_settings import BaseSettings, SettingsConfigDict

Provider = Literal["anthropic", "openai", "google", "groq", "ollama"]
Task = Literal["metadata", "translation", "subtitles", "moderation", "support"]


class AISettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KATHA_AI_", env_file=".env", extra="ignore")

    default_provider: Provider = "anthropic"
    anthropic_model: str = "claude-opus-5"
    openai_model: str = "gpt-4o-mini"
    google_model: str = "gemini-1.5-flash"
    groq_model: str = "llama-3.3-70b-versatile"
    # Self-hosted Ollama. KATHA_AI_OLLAMA_BASE_URL must include the scheme and port, e.g. http://10.0.0.5:11434
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1:8b"
    # Ollama loads a model on first use, so a cold request can take far longer than a hosted API's.
    ollama_timeout_seconds: float = 120.0
    # Per-task overrides, e.g. KATHA_AI_TASK_PROVIDERS='{"subtitles": "openai"}'
    task_providers: dict[str, Provider] = {}
    temperature: float = 0.2
    max_tokens: int = 16000
    transcription_model: str = "whisper-1"  # verbose_json with segment timestamps


@lru_cache
def get_ai_settings() -> AISettings:
    return AISettings()


def chat_model(task: Task, provider: Provider | None = None) -> BaseChatModel:
    s = get_ai_settings()
    provider = provider or s.task_providers.get(task) or s.default_provider
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=s.anthropic_model, temperature=s.temperature, max_tokens=s.max_tokens)
    if provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(model=s.openai_model, temperature=s.temperature, max_completion_tokens=s.max_tokens)
    if provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(model=s.google_model, temperature=s.temperature, max_output_tokens=s.max_tokens)
    if provider == "groq":
        from langchain_groq import ChatGroq

        return ChatGroq(model=s.groq_model, temperature=s.temperature, max_tokens=s.max_tokens)
    if provider == "ollama":
        from langchain_ollama import ChatOllama

        return ChatOllama(
            model=s.ollama_model,
            base_url=s.ollama_base_url,
            temperature=s.temperature,
            num_predict=s.max_tokens,
            client_kwargs={"timeout": s.ollama_timeout_seconds},
        )
    raise ValueError(f"unknown provider {provider}")
