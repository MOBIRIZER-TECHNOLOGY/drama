import uuid
from datetime import date

from pydantic import BaseModel

from app.models.wallet import RewardFrequency, RewardTaskKind


class CheckinStatus(BaseModel):
    checked_in_today: bool
    streak_day: int
    next_streak_day: int
    rewards: list[int]
    coin_balance: int


class CheckinOut(BaseModel):
    day: date
    streak_day: int
    coins: int
    coin_balance: int


class TaskOut(BaseModel):
    id: uuid.UUID
    kind: RewardTaskKind
    title: str
    description: str | None
    coins: int
    url: str | None
    timer_seconds: int
    frequency: RewardFrequency
    claimed: bool


class ClaimRequest(BaseModel):
    ad_event_id: str | None = None


class ClaimOut(BaseModel):
    task_id: uuid.UUID
    coins: int
    coin_balance: int
