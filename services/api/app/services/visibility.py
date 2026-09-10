"""What "a series the viewer may see" means, in one place.

Home, browse, search, the series page, playback, My List, reports and recommendations all need the same answer:
published, inside its licensing window, and visible in this language and territory. Each of them used to spell
a subset of that out by hand, and the subsets disagreed — an archived series was not on home but its episodes
still played, and the For You rail recommended titles that were geo-blocked on the page it linked to. Every
caller builds on the same predicate list now, so a rule added here reaches all of them at once.
"""

from datetime import UTC, datetime

from sqlalchemy import ColumnElement, select
from sqlalchemy.orm import selectinload
from sqlalchemy.sql import Select

from app.models.catalog import PublishStatus, Series


def published_series_predicates(
    lang: str | None = None, country: str | None = None, *, now: datetime | None = None
) -> list[ColumnElement[bool]]:
    """The WHERE clauses for a visible series, for callers that build their own SELECT (joins, id lookups)."""
    now = now or datetime.now(UTC)
    clauses: list[ColumnElement[bool]] = [
        Series.status == PublishStatus.published,
        (Series.window_starts_at.is_(None)) | (Series.window_starts_at <= now),
        (Series.window_ends_at.is_(None)) | (Series.window_ends_at > now),
    ]
    if lang:
        clauses.append((Series.visible_languages.is_(None)) | (Series.visible_languages.any(lang)))
    if country:
        clauses.append((Series.territories.is_(None)) | (Series.territories.any(country)))
    return clauses


def published_series(lang: str | None = None, country: str | None = None) -> Select[tuple[Series]]:
    """`SELECT series` filtered to what this viewer may see, with the relationships every card needs."""
    return (
        select(Series)
        .where(*published_series_predicates(lang, country))
        .options(selectinload(Series.translations), selectinload(Series.categories))
    )
