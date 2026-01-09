from __future__ import annotations

import math
from typing import Literal

from app.services.stats import norm_cdf


def digital_cash_or_nothing_price(
    option_type: Literal["call", "put"],
    *,
    spot: float,
    strike: float,
    rate: float,
    dividend_yield: float,
    vol: float,
    time_to_expiry: float,
    payout: float = 1.0,
) -> float:
    """Cash-or-nothing digital option price under Black–Scholes.

    Price = e^{-rT} * payout * N(±d2)
    """
    if payout <= 0:
        raise ValueError("payout must be > 0")

    if time_to_expiry <= 0:
        # At expiry: pays if in-the-money
        if option_type == "call":
            return float(payout if spot > strike else 0.0)
        return float(payout if spot < strike else 0.0)

    if spot <= 0 or strike <= 0:
        raise ValueError("spot and strike must be > 0")
    if vol <= 0:
        raise ValueError("vol must be > 0")

    sqrtT = math.sqrt(time_to_expiry)
    d2 = (math.log(spot / strike) + (rate - dividend_yield - 0.5 * vol * vol) * time_to_expiry) / (vol * sqrtT)
    disc = math.exp(-rate * time_to_expiry)

    prob = norm_cdf(d2) if option_type == "call" else norm_cdf(-d2)
    return payout * disc * prob
