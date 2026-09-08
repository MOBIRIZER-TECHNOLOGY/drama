"""Just enough statistics to tell a winner from noise.

The experiments screen showed conversion per variant and nothing else, so the only way to read it was to
eyeball two percentages — which reliably declares a winner on a hundred users and ships a price change on
noise. A two-proportion z-test is the standard answer for a conversion comparison and is a dozen lines over
`math.erf`, so it lives here rather than as a dependency.

Deliberately unopinionated about the threshold: the endpoint reports the p-value and the caller decides. The
console draws the line at 0.05 and says so on screen.
"""

import math
from dataclasses import dataclass

# Below this, a proportion test is meaningless regardless of what the arithmetic says, and reporting a p-value
# invites someone to act on twelve users.
MIN_SAMPLE = 100


@dataclass(frozen=True)
class Comparison:
    """One variant measured against the control."""

    lift_pct: float | None
    p_value: float | None
    significant: bool
    """Why there is no verdict yet, when there isn't one."""
    note: str | None = None


def normal_cdf(z: float) -> float:
    """Φ(z) for the standard normal, via the error function."""
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def two_proportion_p(successes_a: int, n_a: int, successes_b: int, n_b: int) -> float | None:
    """Two-sided p-value for H0: the two conversion rates are equal.

    Pooled-variance z-test. Returns None when the test cannot be computed — no observations on a side, or both
    rates at exactly 0 or exactly 1, where the pooled standard error is zero.
    """
    if n_a <= 0 or n_b <= 0:
        return None
    p_a = successes_a / n_a
    p_b = successes_b / n_b
    pooled = (successes_a + successes_b) / (n_a + n_b)
    se = math.sqrt(pooled * (1 - pooled) * (1 / n_a + 1 / n_b))
    if se == 0:
        return None
    z = (p_b - p_a) / se
    return 2 * (1 - normal_cdf(abs(z)))


def compare(control_successes: int, control_n: int, variant_successes: int, variant_n: int) -> Comparison:
    """Lift and significance of a variant against the control.

    Lift is relative — "12% better", the way the result gets repeated in a meeting — rather than the difference
    in percentage points, which is what the arithmetic naturally produces and what people misread.
    """
    if control_n < MIN_SAMPLE or variant_n < MIN_SAMPLE:
        return Comparison(
            lift_pct=None,
            p_value=None,
            significant=False,
            note=f"Needs at least {MIN_SAMPLE} users per variant before this means anything.",
        )

    control_rate = control_successes / control_n
    variant_rate = variant_successes / variant_n
    lift = ((variant_rate - control_rate) / control_rate * 100) if control_rate > 0 else None
    p = two_proportion_p(control_successes, control_n, variant_successes, variant_n)
    if p is None:
        return Comparison(lift_pct=lift, p_value=None, significant=False, note="Not enough variation to test.")
    return Comparison(lift_pct=lift, p_value=p, significant=p < 0.05)
