from __future__ import annotations

import math


def forward_value(
    *,
    spot: float,
    strike: float,
    rate: float,
    dividend_yield: float,
    time_to_expiry: float,
) -> float:
    """PV of a forward contract delivering the underlying at expiry for strike.

    PV = S·e^{-qT} − K·e^{-rT}
    """

    if spot <= 0 or strike <= 0:
        raise ValueError("spot and strike must be > 0")
    if time_to_expiry <= 0:
        return spot - strike

    disc_r = math.exp(-rate * time_to_expiry)
    disc_q = math.exp(-dividend_yield * time_to_expiry)
    return spot * disc_q - strike * disc_r
