"""The experiment significance test, against values that can be checked by hand.

The screen this feeds used to show two conversion percentages side by side, which is a reliable way to declare
a winner on a hundred users and ship a price change on noise. Pure — no database.
"""

import pytest

from app.services import stats


def test_normal_cdf_landmarks():
    assert stats.normal_cdf(0) == pytest.approx(0.5)
    assert stats.normal_cdf(1.96) == pytest.approx(0.975, abs=1e-3)
    assert stats.normal_cdf(-1.96) == pytest.approx(0.025, abs=1e-3)


def test_identical_rates_are_never_significant():
    p = stats.two_proportion_p(100, 1000, 100, 1000)
    assert p == pytest.approx(1.0)


def test_a_clear_difference_at_scale_is_significant():
    """5% against 8% on ten thousand a side is about as unambiguous as this gets."""
    result = stats.compare(500, 10_000, 800, 10_000)
    assert result.significant is True
    assert result.p_value is not None and result.p_value < 0.001
    assert result.lift_pct == pytest.approx(60.0)


def test_the_same_difference_on_small_numbers_is_not():
    result = stats.compare(5, 100, 8, 100)
    assert result.significant is False
    assert result.p_value is not None and result.p_value > 0.05


def test_below_the_minimum_sample_there_is_no_verdict():
    result = stats.compare(3, 40, 9, 40)
    assert result.p_value is None
    assert result.significant is False
    assert result.note is not None and "100" in result.note


def test_zero_conversions_on_both_sides_is_untestable_not_a_tie():
    result = stats.compare(0, 500, 0, 500)
    assert result.p_value is None
    assert result.significant is False
    assert result.note == "Not enough variation to test."


def test_lift_is_relative_not_percentage_points():
    """2% to 3% is a 50% lift, not a 1% one — the number that gets repeated in a meeting."""
    result = stats.compare(20, 1000, 30, 1000)
    assert result.lift_pct == pytest.approx(50.0)


def test_empty_arms_do_not_raise():
    assert stats.two_proportion_p(0, 0, 1, 10) is None
    assert stats.two_proportion_p(1, 10, 0, 0) is None


def test_p_value_is_two_sided():
    """A variant that is worse must be just as detectable as one that is better."""
    better = stats.compare(500, 10_000, 800, 10_000)
    worse = stats.compare(800, 10_000, 500, 10_000)
    assert better.p_value == pytest.approx(worse.p_value)
    assert worse.lift_pct is not None and worse.lift_pct < 0
