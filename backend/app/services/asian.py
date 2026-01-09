from __future__ import annotations

import math
from typing import Literal

import numpy as np

from app.services.stats import norm_cdf


def asian_geometric_continuous_price(
    option_type: Literal["call", "put"],
    *,
    spot: float,
    strike: float,
    rate: float,
    dividend_yield: float,
    vol: float,
    time_to_expiry: float,
) -> float:
    """Closed-form price for a continuous geometric-average price Asian option (fixed strike).

    Under GBM, the geometric average is lognormal, so the payoff expectation has an analytic form.
    """

    if spot <= 0 or strike <= 0:
        raise ValueError("spot and strike must be > 0")
    if vol <= 0:
        raise ValueError("vol must be > 0")
    if time_to_expiry <= 0:
        intrinsic = max(0.0, spot - strike) if option_type == "call" else max(0.0, strike - spot)
        return intrinsic

    T = time_to_expiry
    # Distribution of log geometric average (continuous averaging)
    m = math.log(spot) + (rate - dividend_yield - 0.5 * vol * vol) * (T / 2.0)
    v = vol * vol * (T / 3.0)
    s = math.sqrt(v)

    disc = math.exp(-rate * T)
    eg = math.exp(m + 0.5 * v)  # E[G]

    d1 = (m - math.log(strike) + v) / s
    d2 = d1 - s

    if option_type == "call":
        return disc * (eg * norm_cdf(d1) - strike * norm_cdf(d2))
    return disc * (strike * norm_cdf(-d2) - eg * norm_cdf(-d1))


def asian_arithmetic_mc_price(
    option_type: Literal["call", "put"],
    *,
    spot: float,
    strike: float,
    rate: float,
    dividend_yield: float,
    vol: float,
    time_to_expiry: float,
    fixings: int = 52,
    paths: int = 30000,
    seed: int = 11,
    z: np.ndarray | None = None,
) -> float:
    """Monte Carlo price for arithmetic-average (discrete) Asian option (fixed strike).

    Notes:
      - Averages over `fixings` equally-spaced observation times in (0, T].
      - Uses GBM under the risk-neutral drift r - q.
    """

    if spot <= 0 or strike <= 0:
        raise ValueError("spot and strike must be > 0")
    if vol <= 0:
        raise ValueError("vol must be > 0")
    if time_to_expiry <= 0:
        intrinsic = max(0.0, spot - strike) if option_type == "call" else max(0.0, strike - spot)
        return intrinsic
    if fixings < 1:
        raise ValueError("fixings must be >= 1")
    if paths < 1:
        raise ValueError("paths must be >= 1")

    T = time_to_expiry
    dt = T / fixings
    drift = (rate - dividend_yield - 0.5 * vol * vol) * dt
    diff = vol * math.sqrt(dt)

    if z is None:
        rng = np.random.default_rng(seed)
        z = rng.standard_normal((paths, fixings))
    else:
        if z.shape != (paths, fixings):
            raise ValueError("z has wrong shape")

    # Log-paths
    log_s = math.log(spot) + np.cumsum(drift + diff * z, axis=1)
    s_path = np.exp(log_s)
    avg = s_path.mean(axis=1)

    if option_type == "call":
        payoff = np.maximum(avg - strike, 0.0)
    else:
        payoff = np.maximum(strike - avg, 0.0)

    price = math.exp(-rate * T) * float(payoff.mean())
    return price
