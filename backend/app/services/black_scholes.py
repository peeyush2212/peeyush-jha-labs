from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from app.services.stats import norm_cdf, norm_pdf


@dataclass(frozen=True)
class BSResult:
    price: float
    delta: float
    gamma: float
    vega: float
    theta: float
    rho: float


def price_and_greeks(
    option_type: Literal["call", "put"],
    spot: float,
    strike: float,
    rate: float,
    dividend_yield: float,
    vol: float,
    time_to_expiry: float,
) -> BSResult:
    """Black–Scholes price + Greeks.

    Conventions:
      - rate and dividend_yield are continuously-compounded annual rates.
      - vol is annualized (e.g. 0.20 for 20%).
      - time_to_expiry is in years.

    Greeks are per 1 unit of underlying and per 1.0 absolute change in vol.
    Theta is returned per YEAR (not per day).
    """
    if time_to_expiry <= 0:
        # At expiry: intrinsic, and set most Greeks to 0 for stability.
        intrinsic = max(0.0, spot - strike) if option_type == "call" else max(0.0, strike - spot)
        delta = 1.0 if (option_type == "call" and spot > strike) else (-1.0 if (option_type == "put" and spot < strike) else 0.0)
        return BSResult(price=intrinsic, delta=delta, gamma=0.0, vega=0.0, theta=0.0, rho=0.0)

    if vol <= 0:
        raise ValueError("vol must be > 0")

    sqrtT = math.sqrt(time_to_expiry)
    d1 = (math.log(spot / strike) + (rate - dividend_yield + 0.5 * vol * vol) * time_to_expiry) / (vol * sqrtT)
    d2 = d1 - vol * sqrtT

    disc_r = math.exp(-rate * time_to_expiry)
    disc_q = math.exp(-dividend_yield * time_to_expiry)

    Nd1 = norm_cdf(d1)
    Nd2 = norm_cdf(d2)
    Nmd1 = norm_cdf(-d1)
    Nmd2 = norm_cdf(-d2)
    pdf_d1 = norm_pdf(d1)

    if option_type == "call":
        price = spot * disc_q * Nd1 - strike * disc_r * Nd2
        delta = disc_q * Nd1
        theta = -(spot * disc_q * pdf_d1 * vol) / (2.0 * sqrtT) - rate * strike * disc_r * Nd2 + dividend_yield * spot * disc_q * Nd1
        rho = strike * time_to_expiry * disc_r * Nd2
    else:
        price = strike * disc_r * Nmd2 - spot * disc_q * Nmd1
        delta = disc_q * (Nd1 - 1.0)
        theta = -(spot * disc_q * pdf_d1 * vol) / (2.0 * sqrtT) + rate * strike * disc_r * Nmd2 - dividend_yield * spot * disc_q * Nmd1
        rho = -strike * time_to_expiry * disc_r * Nmd2

    gamma = (disc_q * pdf_d1) / (spot * vol * sqrtT)
    vega = spot * disc_q * pdf_d1 * sqrtT

    return BSResult(price=price, delta=delta, gamma=gamma, vega=vega, theta=theta, rho=rho)


def call_spread_price_and_greeks(
    *,
    spot: float,
    strike_long: float,
    strike_short: float,
    rate: float,
    dividend_yield: float,
    vol: float,
    time_to_expiry: float,
) -> BSResult:
    """Price + Greeks for a call spread.

    Definition:
      - long 1 call with strike_long
      - short 1 call with strike_short

    The result is simply the difference between the two vanilla calls.
    """
    if strike_short <= strike_long:
        raise ValueError("strike_short must be > strike_long")

    long_call = price_and_greeks(
        option_type="call",
        spot=spot,
        strike=strike_long,
        rate=rate,
        dividend_yield=dividend_yield,
        vol=vol,
        time_to_expiry=time_to_expiry,
    )
    short_call = price_and_greeks(
        option_type="call",
        spot=spot,
        strike=strike_short,
        rate=rate,
        dividend_yield=dividend_yield,
        vol=vol,
        time_to_expiry=time_to_expiry,
    )

    return BSResult(
        price=long_call.price - short_call.price,
        delta=long_call.delta - short_call.delta,
        gamma=long_call.gamma - short_call.gamma,
        vega=long_call.vega - short_call.vega,
        theta=long_call.theta - short_call.theta,
        rho=long_call.rho - short_call.rho,
    )
