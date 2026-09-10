"""Pure checks for the review fixes that have a shape worth pinning without a database.

Each of these guards an input edge that used to reach the database and come back as a 500, or a rule that a
later edit could quietly loosen: the LIKE escaping, the UTC pin on admin timestamps, the rating pattern, the
settings validation, and the shape of the home query cap.
"""

from datetime import UTC, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.api.routers.catalog import BROWSE_SERIES_CAP, HOME_RAIL_SIZE
from app.schemas.admin import EpisodeIn, SeriesIn
from app.schemas.common import ensure_utc
from app.services import config as config_svc
from app.services.search import LIKE_ESCAPE, like_pattern

# ---- search ----


def test_like_wildcards_are_escaped():
    assert like_pattern("100%") == "%100\\%%"
    assert like_pattern("a_b") == "%a\\_b%"
    assert like_pattern("back\\slash") == "%back\\\\slash%"


def test_like_pattern_trims_and_wraps():
    assert like_pattern("  hello ") == "%hello%"
    assert LIKE_ESCAPE == "\\"


# ---- timestamps ----


def test_naive_datetimes_are_taken_as_utc():
    v = ensure_utc(datetime(2026, 9, 9, 12, 0))
    assert v is not None and v.tzinfo is UTC and v.hour == 12


def test_aware_datetimes_are_converted_not_relabelled():
    ist = timezone(timedelta(hours=5, minutes=30))
    v = ensure_utc(datetime(2026, 9, 9, 17, 30, tzinfo=ist))
    assert v == datetime(2026, 9, 9, 12, 0, tzinfo=UTC)


def test_none_passes_through():
    assert ensure_utc(None) is None


def test_admin_schemas_pin_their_timestamps_to_utc():
    ep = EpisodeIn(number=1, scheduled_at="2026-09-09T10:00:00")
    assert ep.scheduled_at is not None and ep.scheduled_at.tzinfo is UTC
    s = _series(released_at="2026-09-09T10:00:00+05:30", window_ends_at="2026-12-31T00:00:00")
    assert s.released_at == datetime(2026, 9, 9, 4, 30, tzinfo=UTC)
    assert s.window_ends_at is not None and s.window_ends_at.tzinfo is UTC


# ---- content rating ----


def _series(**overrides) -> SeriesIn:
    data = {"translations": [{"lang": "en", "title": "T"}], **overrides}
    return SeriesIn(**data)


@pytest.mark.parametrize("rating", ["U", "UA7", "UA13", "UA16", "A"])
def test_known_ratings_are_accepted(rating):
    assert _series(content_rating=rating).content_rating == rating


@pytest.mark.parametrize("blank", [None, "", "   "])
def test_a_blank_rating_means_unrated(blank):
    assert _series(content_rating=blank).content_rating is None


@pytest.mark.parametrize("bad", ["PG-13", "ua13", "18+", "A;DROP", "U A"])
def test_unknown_ratings_are_refused_at_the_edge(bad):
    """`requires_age_gate` treats anything unknown as adult; a typo must not silently gate a family title."""
    with pytest.raises(ValidationError):
        _series(content_rating=bad)


def test_a_padded_rating_is_trimmed_rather_than_refused():
    """A stray space from the console is not a different rating."""
    assert _series(content_rating=" U ").content_rating == "U"


def test_moderation_fields_cannot_ride_in_on_a_save():
    """Flags are cleared only through the audited moderation route; a plain save must not carry them."""
    s = _series(moderation_flags=["violence"], moderation_note="cleared")
    assert not hasattr(s, "moderation_flags")
    assert not hasattr(s, "moderation_note")


# ---- settings ----


def test_secret_looking_keys_are_found_at_any_depth():
    found = config_svc.find_secret_keys(
        {"stripe": {"secret_key": "x"}, "items": [{"api_token": 1}], "password": "p", "public_key": "ok"}
    )
    assert set(found) == {"stripe.secret_key", "items[0].api_token", "password"}


def test_numeric_economy_keys_must_be_whole_numbers_in_range():
    assert config_svc.validate_namespace_values("economy", {"episode_price": 50, "free_episodes": 3}) == []
    problems = config_svc.validate_namespace_values(
        "economy", {"episode_price": "50", "ad_unlocks_per_day": -1, "bundle_discount_pct": 95}
    )
    assert len(problems) == 3
    assert config_svc.validate_namespace_values("economy", {"episode_price": True})
    assert config_svc.validate_namespace_values("economy", {"episode_price": 1.5})


def test_daily_rewards_is_a_bounded_list_of_ints():
    assert config_svc.validate_namespace_values("rewards", {"daily_rewards": [10, 20, 30]}) == []
    assert config_svc.validate_namespace_values("rewards", {"daily_rewards": []})
    assert config_svc.validate_namespace_values("rewards", {"daily_rewards": [10, "x"]})
    assert config_svc.validate_namespace_values("rewards", {"daily_rewards": [1] * 40})


def test_unknown_keys_are_not_validated():
    """The validator constrains what the economy reads; it must not block a new key an operator adds."""
    assert config_svc.validate_namespace_values("site", {"tagline": 42}) == []


# ---- home ----


def test_home_is_bounded_by_the_browse_cap():
    assert 0 < HOME_RAIL_SIZE <= BROWSE_SERIES_CAP
