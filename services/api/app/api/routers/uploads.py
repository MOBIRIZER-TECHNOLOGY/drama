"""Admin uploads: presigned PUT to the bucket, then register the object. Videos become video_assets and are queued."""

import asyncio
import uuid
from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.deps import DB, CurrentAdmin
from app.core.errors import AppError
from app.models.catalog import AssetStatus, VideoAsset
from app.services import jobs, storage

router = APIRouter(prefix="/admin/uploads", tags=["admin"])


class PresignIn(BaseModel):
    kind: str = Field(pattern="^(image|video|subtitle)$")
    filename: str = Field(max_length=255)
    content_type: str = Field(max_length=100)


class PresignOut(BaseModel):
    key: str
    upload_url: str
    public_url: str | None


class RegisterVideoIn(BaseModel):
    key: str
    size_bytes: int | None = None


class VideoAssetOut(BaseModel):
    id: uuid.UUID
    status: AssetStatus
    source_key: str
    hls_master_key: str | None
    duration_sec: int | None
    size_bytes: int | None = None
    error: str | None
    created_at: datetime | None = None


@router.post("/presign", response_model=PresignOut)
async def presign(body: PresignIn, admin: CurrentAdmin) -> PresignOut:
    allowed = {"image": storage.IMAGE_TYPES, "video": storage.VIDEO_TYPES, "subtitle": storage.SUBTITLE_TYPES}[
        body.kind
    ]
    if body.content_type not in allowed:
        raise AppError(f"{body.content_type} is not allowed for {body.kind}", code="bad_content_type")
    prefix = {"image": "images", "video": "uploads/videos", "subtitle": "subtitles"}[body.kind]
    key = storage.object_key(prefix, body.filename)
    url = await asyncio.to_thread(storage.presign_put, key, body.content_type)
    return PresignOut(key=key, upload_url=url, public_url=storage.public_url(key) if body.kind != "video" else None)


@router.post("/videos", response_model=VideoAssetOut)
async def register_video(body: RegisterVideoIn, admin: CurrentAdmin, db: DB) -> VideoAssetOut:
    asset = VideoAsset(source_key=body.key, status=AssetStatus.queued, size_bytes=body.size_bytes)
    db.add(asset)
    await db.commit()
    try:
        await jobs.enqueue("transcode_asset", str(asset.id), job_id=f"transcode:{asset.id}")
    except Exception as exc:  # noqa: BLE001 - queue down: leave it queued, a sweeper re-enqueues
        asset.error = f"enqueue failed: {exc}"
        await db.commit()
    return VideoAssetOut(
        id=asset.id,
        status=asset.status,
        source_key=asset.source_key,
        hls_master_key=asset.hls_master_key,
        duration_sec=asset.duration_sec,
        size_bytes=asset.size_bytes,
        error=asset.error,
        created_at=asset.created_at,
    )


@router.get("/videos", response_model=list[VideoAssetOut])
async def list_videos(
    admin: CurrentAdmin, db: DB, status: AssetStatus | None = None, limit: int = 100
) -> list[VideoAssetOut]:
    from sqlalchemy import select

    stmt = select(VideoAsset)
    if status:
        stmt = stmt.where(VideoAsset.status == status)
    rows = await db.scalars(stmt.order_by(VideoAsset.created_at.desc()).limit(min(limit, 500)))
    return [
        VideoAssetOut(
            id=a.id,
            status=a.status,
            source_key=a.source_key,
            hls_master_key=a.hls_master_key,
            duration_sec=a.duration_sec,
            size_bytes=a.size_bytes,
            error=a.error,
            created_at=a.created_at,
        )
        for a in rows.all()
    ]


@router.delete("/videos/{asset_id}")
async def delete_video(asset_id: uuid.UUID, admin: CurrentAdmin, db: DB) -> dict:
    """Removes the asset row and its objects. Refused while an episode still references it."""
    from sqlalchemy import select

    from app.models.catalog import Episode

    asset = await db.get(VideoAsset, asset_id)
    if asset is None:
        raise AppError("Asset not found", status_code=404, code="not_found")
    from app.models.catalog import Series

    if await db.scalar(select(Episode.id).where(Episode.video_asset_id == asset_id).limit(1)) or await db.scalar(
        select(Series.id).where(Series.trailer_asset_id == asset_id).limit(1)
    ):
        raise AppError("Asset is used by an episode or trailer", status_code=409, code="asset_in_use")
    keys = [asset.source_key]
    await db.delete(asset)
    await db.commit()
    for key in keys:
        try:
            await asyncio.to_thread(storage.delete_object, key)
        except Exception:  # noqa: BLE001 - object may already be gone; row deletion is what matters
            pass
    return {"ok": True, "note": "HLS renditions under hls/{id}/ are removed by the nightly sweeper"}


@router.get("/videos/{asset_id}", response_model=VideoAssetOut)
async def video_status(asset_id: uuid.UUID, admin: CurrentAdmin, db: DB) -> VideoAssetOut:
    asset = await db.get(VideoAsset, asset_id)
    if asset is None:
        raise AppError("Asset not found", status_code=404, code="not_found")
    return VideoAssetOut(
        id=asset.id,
        status=asset.status,
        source_key=asset.source_key,
        hls_master_key=asset.hls_master_key,
        duration_sec=asset.duration_sec,
        size_bytes=asset.size_bytes,
        error=asset.error,
        created_at=asset.created_at,
    )


@router.post("/videos/{asset_id}/retry", response_model=VideoAssetOut)
async def retry_video(asset_id: uuid.UUID, admin: CurrentAdmin, db: DB) -> VideoAssetOut:
    asset = await db.get(VideoAsset, asset_id)
    if asset is None:
        raise AppError("Asset not found", status_code=404, code="not_found")
    asset.status = AssetStatus.queued
    asset.error = None
    await db.commit()
    await jobs.enqueue("transcode_asset", str(asset.id), job_id=f"transcode:{asset.id}")
    return VideoAssetOut(
        id=asset.id,
        status=asset.status,
        source_key=asset.source_key,
        hls_master_key=asset.hls_master_key,
        duration_sec=asset.duration_sec,
        size_bytes=asset.size_bytes,
        error=asset.error,
        created_at=asset.created_at,
    )
