from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KATHA_", env_file=".env", extra="ignore")

    redis_url: str = "redis://localhost:6379/0"
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    hls_ladder: list[str] = ["1080p", "720p", "480p"]
    max_jobs: int = 4


@lru_cache
def get_worker_settings() -> WorkerSettings:
    return WorkerSettings()
