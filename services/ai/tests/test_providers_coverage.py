"""Provider registry: which model a task gets, how it is configured, and how it fails.

`chat_model` is the single place where an admin's per-task choice turns into a concrete client, so the
behaviour worth pinning is the precedence (explicit argument > per-task override > default), the settings
that reach each client, and the two failure modes: a provider name the registry does not know, and a
provider whose credentials are absent. Nothing here talks to a network: constructing a LangChain chat model
is local, and the fake keys exist only so the SDKs that validate eagerly get past their constructor.
"""

import pytest

from katha_ai import providers as p

# Every key an SDK might pick up from the ambient environment. Tests that assert "missing credentials"
# are only honest if the developer's own keys are not sitting in os.environ.
KEY_VARS = (
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_ADMIN_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
)
SETTINGS_VARS = (
    "KATHA_AI_DEFAULT_PROVIDER",
    "KATHA_AI_TASK_PROVIDERS",
    "KATHA_AI_ANTHROPIC_MODEL",
    "KATHA_AI_OPENAI_MODEL",
    "KATHA_AI_OLLAMA_BASE_URL",
    "KATHA_AI_OLLAMA_TIMEOUT_SECONDS",
    "KATHA_AI_TEMPERATURE",
    "KATHA_AI_MAX_TOKENS",
)


@pytest.fixture
def clean_env(monkeypatch):
    """get_ai_settings is lru_cached, so a test that changes the environment must drop the cached
    instance on the way in *and* on the way out or it leaks into every later test."""
    for name in KEY_VARS + SETTINGS_VARS:
        monkeypatch.delenv(name, raising=False)
    p.get_ai_settings.cache_clear()
    yield monkeypatch
    p.get_ai_settings.cache_clear()


@pytest.fixture
def fake_keys(clean_env):
    """Credentials that are present but meaningless: enough to build a client, useless for a request."""
    for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY"):
        clean_env.setenv(name, "test-key-not-real")
    p.get_ai_settings.cache_clear()
    return clean_env


def test_settings_are_cached_until_cleared(clean_env):
    first = p.get_ai_settings()
    assert p.get_ai_settings() is first
    p.get_ai_settings.cache_clear()
    assert p.get_ai_settings() is not first


def test_defaults_are_anthropic_opus(clean_env):
    s = p.get_ai_settings()
    assert s.default_provider == "anthropic"
    assert s.anthropic_model == "claude-opus-5"
    assert s.task_providers == {}
    assert s.temperature == 0.2
    assert s.max_tokens == 16000
    assert s.transcription_model == "whisper-1"


def test_default_provider_used_when_task_has_no_override(fake_keys):
    from langchain_anthropic import ChatAnthropic

    model = p.chat_model("metadata")
    assert isinstance(model, ChatAnthropic)
    assert model.model == "claude-opus-5"
    assert model.temperature == 0.2
    assert model.max_tokens == 16000


def test_per_task_override_applies_only_to_that_task(fake_keys):
    """The point of the registry: subtitles can run somewhere cheap while metadata stays on Opus."""
    from langchain_anthropic import ChatAnthropic
    from langchain_openai import ChatOpenAI

    fake_keys.setenv("KATHA_AI_TASK_PROVIDERS", '{"subtitles": "openai"}')
    p.get_ai_settings.cache_clear()

    assert isinstance(p.chat_model("subtitles"), ChatOpenAI)
    assert isinstance(p.chat_model("metadata"), ChatAnthropic)


def test_explicit_provider_argument_beats_task_override(fake_keys):
    from langchain_groq import ChatGroq

    fake_keys.setenv("KATHA_AI_TASK_PROVIDERS", '{"subtitles": "openai"}')
    p.get_ai_settings.cache_clear()

    assert isinstance(p.chat_model("subtitles", "groq"), ChatGroq)


def test_default_provider_can_be_switched_wholesale(fake_keys):
    from langchain_openai import ChatOpenAI

    fake_keys.setenv("KATHA_AI_DEFAULT_PROVIDER", "openai")
    fake_keys.setenv("KATHA_AI_OPENAI_MODEL", "gpt-4o")
    p.get_ai_settings.cache_clear()

    model = p.chat_model("translation")
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "gpt-4o"
    # ChatOpenAI stores the budget passed as max_completion_tokens on its max_tokens field.
    assert model.max_tokens == 16000
    assert model._default_params["max_completion_tokens"] == 16000


def test_google_gets_its_own_token_budget_parameter(fake_keys):
    from langchain_google_genai import ChatGoogleGenerativeAI

    model = p.chat_model("support", "google")
    assert isinstance(model, ChatGoogleGenerativeAI)
    assert model.model.endswith("gemini-1.5-flash")
    assert model.max_output_tokens == 16000
    assert model.temperature == 0.2


def test_groq_model_and_budget(fake_keys):
    from langchain_groq import ChatGroq

    model = p.chat_model("moderation", "groq")
    assert isinstance(model, ChatGroq)
    assert model.model_name == "llama-3.3-70b-versatile"
    assert model.max_tokens == 16000


def test_ollama_needs_no_key_and_carries_the_cold_start_timeout(clean_env):
    """Ollama is the one provider whose availability is a URL, not a secret, so it must build with every
    API key absent — and it must carry the long timeout that a cold model load needs."""
    from langchain_ollama import ChatOllama

    clean_env.setenv("KATHA_AI_OLLAMA_BASE_URL", "http://10.0.0.5:11434")
    clean_env.setenv("KATHA_AI_OLLAMA_TIMEOUT_SECONDS", "300")
    p.get_ai_settings.cache_clear()

    model = p.chat_model("subtitles", "ollama")
    assert isinstance(model, ChatOllama)
    assert model.base_url == "http://10.0.0.5:11434"
    assert model.model == "llama3.1:8b"
    assert model.num_predict == 16000
    assert model.client_kwargs == {"timeout": 300.0}


def test_unknown_provider_raises_value_error(fake_keys):
    """The Provider Literal is only a type hint; a bad string from a database column reaches this guard."""
    with pytest.raises(ValueError, match="unknown provider mistral"):
        p.chat_model("metadata", "mistral")


def test_unknown_provider_from_task_override_also_raises(fake_keys):
    """A per-task override is read from JSON, so pydantic rejects a name outside the Literal up front."""
    from pydantic import ValidationError

    fake_keys.setenv("KATHA_AI_TASK_PROVIDERS", '{"metadata": "mistral"}')
    p.get_ai_settings.cache_clear()
    with pytest.raises(ValidationError):
        p.get_ai_settings()


def test_openai_without_credentials_fails_at_construction(clean_env):
    from openai import OpenAIError

    with pytest.raises(OpenAIError, match="OPENAI_API_KEY"):
        p.chat_model("metadata", "openai")


def test_google_without_credentials_fails_at_construction(clean_env):
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="API key"):
        p.chat_model("metadata", "google")


def test_groq_without_credentials_fails_at_construction(clean_env):
    from groq import GroqError

    with pytest.raises(GroqError, match="api_key"):
        p.chat_model("metadata", "groq")


def test_anthropic_without_credentials_builds_anyway(clean_env):
    """Asymmetry worth knowing about: the default provider does *not* fail fast on a missing key, so a
    deployment that forgot ANTHROPIC_API_KEY only finds out when the first request is sent."""
    from langchain_anthropic import ChatAnthropic

    model = p.chat_model("metadata")
    assert isinstance(model, ChatAnthropic)


def test_temperature_and_budget_come_from_settings(fake_keys):
    fake_keys.setenv("KATHA_AI_TEMPERATURE", "0.9")
    fake_keys.setenv("KATHA_AI_MAX_TOKENS", "2048")
    p.get_ai_settings.cache_clear()

    model = p.chat_model("metadata")
    assert model.temperature == 0.9
    assert model.max_tokens == 2048
