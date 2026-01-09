from __future__ import annotations

import math
from typing import Literal


def binomial_crr_price(
    option_type: Literal["call", "put"],
    *,
    spot: float,
    strike: float,
    rate: float,
    dividend_yield: float,
    vol: float,
    time_to_expiry: float,
    steps: int = 200,
    american: bool = False,
) -> float:
    """Recombining Cox–Ross–Rubinstein binomial tree.

    - Uses risk-neutral drift r - q.
    - Supports early exercise when american=True.
    """

    if steps < 1:
        raise ValueError("steps must be >= 1")
    if spot <= 0 or strike <= 0:
        raise ValueError("spot and strike must be > 0")
    if time_to_expiry <= 0:
        intrinsic = max(0.0, spot - strike) if option_type == "call" else max(0.0, strike - spot)
        return intrinsic
    if vol <= 0:
        raise ValueError("vol must be > 0")

    dt = time_to_expiry / steps
    sqrt_dt = math.sqrt(dt)

    u = math.exp(vol * sqrt_dt)
    d = 1.0 / u

    disc = math.exp(-rate * dt)
    a = math.exp((rate - dividend_yield) * dt)
    p = (a - d) / (u - d)
    if not (0.0 <= p <= 1.0):
        # This can happen with very small steps or extreme parameters.
        # Clamp rather than fail hard.
        p = min(1.0, max(0.0, p))

    # Terminal payoffs V_N(j) for j up moves
    values = [0.0] * (steps + 1)
    for j in range(steps + 1):
        s = spot * (u**j) * (d ** (steps - j))
        if option_type == "call":
            values[j] = max(0.0, s - strike)
        else:
            values[j] = max(0.0, strike - s)

    # Backward induction
    for i in range(steps - 1, -1, -1):
        for j in range(i + 1):
            continuation = disc * (p * values[j + 1] + (1.0 - p) * values[j])
            if american:
                s = spot * (u**j) * (d ** (i - j))
                intrinsic = max(0.0, s - strike) if option_type == "call" else max(0.0, strike - s)
                values[j] = max(intrinsic, continuation)
            else:
                values[j] = continuation

    return float(values[0])
