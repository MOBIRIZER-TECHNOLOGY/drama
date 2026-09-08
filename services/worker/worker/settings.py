from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KATHA_", env_file=".env", extra="ignore")

    redis_url: str = "redis://localhost:6379/0"
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    hls_ladder: list[str] = ["1080p", "720p", "480p"]
    # Package renditions with AES-128. On, because this catalogue sells episodes and an unencrypted segment is
    # the episode to anyone who gets its URL. It costs the fMP4 container: HLS has no AES-128 for fMP4, only
    # SAMPLE-AES, which needs a DRM licence server, so encrypted output is MPEG-TS. Turn it off and renditions
    # go back to fMP4 in the clear.
    hls_encrypt: bool = True
    max_jobs: int = 4


@lru_cache
def get_worker_settings() -> WorkerSettings:
    return WorkerSettings()
