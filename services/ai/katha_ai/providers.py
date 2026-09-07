"""Provider registry.

Admin picks a provider per graph (mirrors the vendor's aiProvider switch, but per task). Keys come from the
environment only. Claude Opus 5 is the default for metadata, translation and moderation.
"""

from functools import lru_cache
from typing import Literal

from langchain_core.language_models import BaseChatModel
from pydantic_settings import BaseSettings, SettingsConfigDict

Provider = Literal["anthropic", "openai", "google", "groq"]
Task = Literal["metadata", "translation", "subtitles", "moderation", "support"]


class AISettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KATHA_AI_", env_file=".env", extra="ignore")

    default_provider: Provider = "anthropic"
    anthropic_model: str = "claude-opus-5"
    openai_model: str = "gpt-4o-mini"
    google_model: str = "gemini-1.5-flash"
    groq_model: str = "llama-3.3-70b-versatile"
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
    raise ValueError(f"unknown provider {provider}")
