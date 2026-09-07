"""Object storage: presigned uploads straight from the admin browser to the bucket. The API never proxies bytes."""

import mimetypes
import uuid
from functools import lru_cache

import boto3
from botocore.config import Config

from app.core.config import get_settings

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
VIDEO_TYPES = {"video/mp4", "video/quicktime", "video/webm", "video/x-matroska"}
SUBTITLE_TYPES = {"text/vtt", "application/x-subrip", "text/plain"}


@lru_cache
def _client():
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint,
        region_name=s.s3_region,
        aws_access_key_id=s.s3_access_key,
        aws_secret_access_key=s.s3_secret_key,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def object_key(kind: str, filename: str) -> str:
    ext = mimetypes.guess_extension(mimetypes.guess_type(filename)[0] or "") or ""
    if not ext and "." in filename:
        ext = "." + filename.rsplit(".", 1)[1].lower()
    return f"{kind}/{uuid.uuid4().hex}{ext}"


def presign_put(key: str, content_type: str, *, expires: int = 900) -> str:
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": get_settings().s3_bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=expires,
    )


def public_url(key: str) -> str:
    return f"{get_settings().cdn_base_url.rstrip('/')}/{key}"


def delete_object(key: str) -> None:
    _client().delete_object(Bucket=get_settings().s3_bucket, Key=key)


def get_object_text(key: str, *, max_bytes: int = 2_000_000) -> str:
    obj = _client().get_object(Bucket=get_settings().s3_bucket, Key=key)
    return obj["Body"].read(max_bytes).decode("utf-8", errors="replace")
