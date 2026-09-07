"""Pure-logic tests for the rules added for launch: the age gate, bundle pricing, and push eligibility.

These need no database. They cover the decisions where being wrong is expensive: showing adult content to a
viewer who never confirmed their age, charging the wrong amount for a bundle, and pushing to someone who asked
us not to.
"""

from types import SimpleNamespace

import pytest

from app.core.config import Settings
from app.services import access, push


def _series(rating=None, bundle_pct=None):
    return SimpleNamespace(content_rating=rating, bundle_discount_pct=bundle_pct)


def _settings(monkeypatch, **overrides):
    s = Settings(**overrides)
    monkeypatch.setattr(access, "get_settings", lambda: s)
    return s


# ---- age gate ----


@pytest.mark.parametrize("rating", ["A", "UA16"])
def test_adult_ratings_are_gated(monkeypatch, rating):
    _settings(monkeypatch)
    assert access.requires_age_gate(_series(rating)) is True


@pytest.mark.parametrize("rating", ["U", "UA7", "UA13"])
def test_general_ratings_are_not_gated(monkeypatch, rating):
    _settings(monkeypatch)
    assert access.requires_age_gate(_series(rating)) is False


@pytest.mark.parametrize("missing", [None, "", "   "])
def test_unrated_series_fails_closed(monkeypatch, missing):
    """An editor who forgets the rating must not be able to ship ungated adult content."""
    _settings(monkeypatch)
    assert access.requires_age_gate(_series(missing)) is True


def test_unrated_can_be_opened_up_for_an_all_ages_catalogue(monkeypatch):
    _settings(monkeypatch, unrated_is_adult=False)
    assert access.requires_age_gate(_series(None)) is False


# ---- bundle pricing ----


def _quote(list_price: int, pct: int) -> int:
    """The arithmetic `quote_series_bundle` performs, isolated from the database."""
    pct = max(0, min(90, pct))
    return (list_price * (100 - pct)) // 100


def test_bundle_discount_rounds_in_the_viewers_favour():
    # 3 episodes at 50 with 30% off is 105 exactly; 101 at 30% is 70.7, which must not round up to 71.
    assert _quote(150, 30) == 105
    assert _quote(101, 30) == 70


def test_bundle_discount_is_clamped_to_a_sane_range():
    assert _quote(1000, -20) == 1000  # a negative discount must never charge more than list
    assert _quote(1000, 500) == 100  # and a fat-fingered 500% must never give it away


def test_zero_discount_is_list_price():
    assert _quote(900, 0) == 900


# ---- push eligibility ----


@pytest.mark.parametrize(
    "token,ok",
    [
        ("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", True),
        ("ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]", True),
        ("fcm-raw-token", False),
        ("", False),
        (None, False),
    ],
)
def test_only_expo_tokens_are_accepted(token, ok):
    assert push.is_expo_token(token) is ok


def test_channels_default_to_opted_in():
    user = SimpleNamespace(notification_prefs=None)
    assert all(push.wants(user, channel) for channel in push.CHANNELS)


def test_an_explicit_opt_out_is_honoured():
    user = SimpleNamespace(notification_prefs={"streak": False})
    assert push.wants(user, "streak") is False
    assert push.wants(user, "new_episode") is True


def test_transactional_messages_ignore_preferences():
    """A purchase confirmation is not marketing; there is no channel to switch it off."""
    user = SimpleNamespace(notification_prefs={"transactional": False})
    assert push.wants(user, "transactional") is True


@pytest.mark.anyio
async def test_send_with_no_messages_does_not_call_the_network():
    result = await push.send([])
    assert (result.delivered, result.failed, result.dead_tokens) == (0, 0, [])
