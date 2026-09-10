from datetime import UTC, datetime
from typing import Annotated, Generic, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict

T = TypeVar("T")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None = None


class Ok(BaseModel):
    ok: bool = True


def ensure_utc(v: datetime | None) -> datetime | None:
    """Pin an incoming timestamp to UTC.

    Every timestamp column is `timestamptz`, and the comparisons that decide whether a series is inside its
    window or an episode is due are made against `datetime.now(UTC)`. A naive value from the console — a date
    picker that omits the offset — cannot be compared with that at all in Python, and asyncpg refuses to bind
    it, so the request failed with a 500 that read like a database fault. A naive value is taken as UTC, which
    is what the console means by it; an aware value is converted, so the stored instant is what was typed.
    """
    if v is None:
        return None
    if v.tzinfo is None:
        return v.replace(tzinfo=UTC)
    return v.astimezone(UTC)


UtcDatetime = Annotated[datetime, AfterValidator(ensure_utc)]
