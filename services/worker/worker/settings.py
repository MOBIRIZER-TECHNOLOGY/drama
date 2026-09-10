from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# How many times arq runs a job before giving up. Jobs read it to decide whether a transient failure is worth a
# `Retry` or is the last word; the number lives here rather than on `WorkerSettings` in main.py so that jobs do
# not import the entrypoint (which would pull the whole registry into every job module).
MAX_TRIES = 3


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


def assert_encryption_configured() -> None:
    """Refuse to start an encrypting worker whose content keys would come from a fallback secret.

    Content keys are derived from `KATHA_MEDIA_ENCRYPTION_KEY` by both the worker (to package) and the API (to
    hand the key to a player). The API's settings fall back to the JWT secret when the variable is unset, which
    is tolerable there in development, but a worker running with the fallback while the API runs with the real
    value packages a catalogue the API cannot decrypt, and the mismatch only shows up as black video on a device.
    The API enforces this in staging and production; the worker enforces it everywhere, because there is no
    environment in which encrypting under a guessed key is what anyone wants.
    """
    from app.core.config import get_settings

    if get_worker_settings().hls_encrypt and not get_settings().media_encryption_key:
        raise RuntimeError(
            "KATHA_HLS_ENCRYPT is on but KATHA_MEDIA_ENCRYPTION_KEY is unset. Set the same value the API uses, "
            "or set KATHA_HLS_ENCRYPT=false to package renditions in the clear."
        )
