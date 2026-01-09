from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np

from app.schemas.pricing import Greeks
from app.services import asian, barrier, binomial, black_scholes, digital, forward
from app.services.fd import finite_difference_greeks


@dataclass(frozen=True)
class PricedLeg:
    price_per_unit: float
    greeks: Greeks


def _parse_option_type(params: dict[str, Any]) -> Literal["call", "put"]:
    ot = str(params.get("option_type", "call")).lower().strip()
    if ot not in ("call", "put"):
        raise ValueError("option_type must be 'call' or 'put'")
    return ot  # type: ignore[return-value]


def price_leg_price_only(
    *,
    instrument_type: str,
    method: str,
    market: dict[str, float],
    params: dict[str, Any],
    rng_cache: dict[str, np.ndarray] | None = None,
) -> float:
    """Price one instrument (price only, no Greeks).

    `rng_cache` is optional and is used to reuse random numbers for Monte Carlo methods
    (common random numbers across bumps / repeated calls).
    """

    spot = float(market["spot"])
    rate = float(market["rate"])
    q = float(market.get("dividend_yield", 0.0))
    vol = float(market.get("vol", 0.0))

    strike = float(params.get("strike", 0.0))
    T = float(params.get("time_to_expiry", 0.0))

    if instrument_type == "forward":
        if method != "discounted_forward":
            raise ValueError("unsupported method for forward")
        return forward.forward_value(spot=spot, strike=strike, rate=rate, dividend_yield=q, time_to_expiry=T)

    option_type = _parse_option_type(params)

    if instrument_type == "vanilla":
        if method == "black_scholes":
            return black_scholes.price_and_greeks(option_type, spot, strike, rate, q, vol, T).price
        if method == "binomial_crr":
            steps = int(params.get("steps", 200))
            return binomial.binomial_crr_price(
                option_type,
                spot=spot,
                strike=strike,
                rate=rate,
                dividend_yield=q,
                vol=vol,
                time_to_expiry=T,
                steps=steps,
                american=False,
            )
        raise ValueError("unsupported method for vanilla")

    if instrument_type == "american":
        if method != "binomial_crr":
            raise ValueError("unsupported method for american")
        steps = int(params.get("steps", 300))
        return binomial.binomial_crr_price(
            option_type,
            spot=spot,
            strike=strike,
            rate=rate,
            dividend_yield=q,
            vol=vol,
            time_to_expiry=T,
            steps=steps,
            american=True,
        )

    if instrument_type == "digital":
        if method != "black_scholes":
            raise ValueError("unsupported method for digital")
        payout = float(params.get("payout", 1.0))
        return digital.digital_cash_or_nothing_price(
            option_type,
            spot=spot,
            strike=strike,
            rate=rate,
            dividend_yield=q,
            vol=vol,
            time_to_expiry=T,
            payout=payout,
        )

    if instrument_type == "asian":
        if method == "geometric_closed_form":
            return asian.asian_geometric_continuous_price(
                option_type,
                spot=spot,
                strike=strike,
                rate=rate,
                dividend_yield=q,
                vol=vol,
                time_to_expiry=T,
            )
        if method == "arithmetic_mc":
            fixings = int(params.get("fixings", 52))
            paths = int(params.get("paths", 30000))
            seed = int(params.get("seed", 11))
            z = None if rng_cache is None else rng_cache.get("z")
            if z is None and rng_cache is not None:
                rng = np.random.default_rng(seed)
                z = rng.standard_normal((paths, fixings))
                rng_cache["z"] = z
            return asian.asian_arithmetic_mc_price(
                option_type,
                spot=spot,
                strike=strike,
                rate=rate,
                dividend_yield=q,
                vol=vol,
                time_to_expiry=T,
                fixings=fixings,
                paths=paths,
                seed=seed,
                z=z,
            )
        raise ValueError("unsupported method for asian")

    if instrument_type == "barrier":
        barrier_level = float(params.get("barrier_level", 0.0))
        direction = str(params.get("barrier_direction", "up")).lower().strip()
        if direction not in ("up", "down"):
            raise ValueError("barrier_direction must be 'up' or 'down'")

        paths = int(params.get("paths", 20000))
        steps = int(params.get("steps", 96))
        seed = int(params.get("seed", 7))
        brownian_bridge = method == "mc_bridge"
        if method not in ("mc_discrete", "mc_bridge"):
            raise ValueError("unsupported method for barrier")

        z = None
        u = None
        if rng_cache is not None:
            z = rng_cache.get("z")
            u = rng_cache.get("u")

        if z is None and rng_cache is not None:
            rng = np.random.default_rng(seed)
            z = rng.standard_normal((paths, steps))
            rng_cache["z"] = z
            if brownian_bridge:
                u = rng.random((paths, steps))
                rng_cache["u"] = u

        return barrier.barrier_knockout_mc_price(
            option_type,
            spot=spot,
            strike=strike,
            barrier_level=barrier_level,
            barrier_direction=direction,  # type: ignore[arg-type]
            rate=rate,
            dividend_yield=q,
            vol=vol,
            time_to_expiry=T,
            paths=paths,
            steps=steps,
            seed=seed,
            brownian_bridge=brownian_bridge,
            z=z,
            u=u,
        )

    raise ValueError("unsupported instrument_type")


def price_leg_with_greeks(
    *,
    instrument_type: str,
    method: str,
    market: dict[str, float],
    params: dict[str, Any],
) -> PricedLeg:
    """Price one instrument and return price + Greeks.

    - Uses analytic greeks for Black–Scholes vanilla.
    - For other methods, uses finite differences (Monte Carlo methods use common random numbers).
    """

    spot = float(market["spot"])
    rate = float(market["rate"])
    q = float(market.get("dividend_yield", 0.0))
    vol = float(market.get("vol", 0.0))

    strike = float(params.get("strike", 0.0))
    T = float(params.get("time_to_expiry", 0.0))

    if instrument_type == "vanilla" and method == "black_scholes":
        ot = _parse_option_type(params)
        res = black_scholes.price_and_greeks(ot, spot, strike, rate, q, vol, T)
        greeks = Greeks(delta=res.delta, gamma=res.gamma, vega=res.vega, theta=res.theta, rho=res.rho)
        return PricedLeg(price_per_unit=res.price, greeks=greeks)

    # For everything else, compute greeks via finite differences.
    rng_cache: dict[str, np.ndarray] = {}

    def _price(s: float, r: float, v: float, t: float) -> float:
        m = {"spot": s, "rate": r, "dividend_yield": q, "vol": v}
        p = dict(params)
        p["time_to_expiry"] = t
        return price_leg_price_only(
            instrument_type=instrument_type,
            method=method,
            market=m,
            params=p,
            rng_cache=rng_cache,
        )

    # Use forward differences for Monte Carlo to reduce noise.
    scheme = "forward" if method in ("mc_discrete", "mc_bridge", "arithmetic_mc") else "central"
    fd = finite_difference_greeks(_price, spot=spot, rate=rate, vol=vol, time_to_expiry=T, scheme=scheme)
    price0 = _price(spot, rate, vol, T)
    greeks = Greeks(delta=fd.delta, gamma=fd.gamma, vega=fd.vega, theta=fd.theta, rho=fd.rho)
    return PricedLeg(price_per_unit=price0, greeks=greeks)
