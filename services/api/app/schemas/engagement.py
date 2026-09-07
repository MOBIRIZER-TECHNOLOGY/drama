import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.catalog import SeriesCard


class ToggleOut(BaseModel):
    active: bool
    count: int | None = None


class ProgressIn(BaseModel):
    position_sec: int = Field(ge=0)
    completed: bool = False


class HistoryItem(BaseModel):
    series: SeriesCard
    episode_id: uuid.UUID
    episode_number: int
    position_sec: int
    duration_sec: int | None
    completed: bool
    updated_at: datetime


class MyListOut(BaseModel):
    favorites: list[SeriesCard]
    history: list[HistoryItem]


class ReportIn(BaseModel):
    series_id: uuid.UUID | None = None
    episode_id: uuid.UUID | None = None
    reason: str = Field(max_length=64)
    details: str | None = Field(default=None, max_length=2000)


class ContactIn(BaseModel):
    name: str = Field(max_length=120)
    email: str = Field(max_length=320)
    subject: str | None = Field(default=None, max_length=200)
    message: str = Field(min_length=5, max_length=5000)
    captcha_token: str | None = None
