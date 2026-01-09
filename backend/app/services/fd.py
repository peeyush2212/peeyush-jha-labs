from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal


@dataclass(frozen=True)
class FDGreeks:
    delta: float
    gamma: float
    vega: float
    theta: float
    rho: float


def finite_difference_greeks(
    price_fn: Callable[[float, float, float, float], float],
    *,
    spot: float,
    rate: float,
    vol: float,
    time_to_expiry: float,
    spot_rel_bump: float = 1e-4,
    vol_abs_bump: float = 1e-4,
    rate_abs_bump: float = 1e-4,
    time_abs_bump: float = 1e-4,
    scheme: Literal["central", "forward"] = "central",
) -> FDGreeks:
    """Finite-difference Greeks helper.

    The pricing function must be stable around the base inputs.

    Conventions:
      - theta is "calendar-time" theta (same sign convention as the Black–Scholes implementation):
        theta ≈ (V(τ - dτ) - V(τ)) / dτ
        where τ is time_to_expiry.
    """

    if spot <= 0:
        raise ValueError("spot must be > 0")
    if vol <= 0:
        raise ValueError("vol must be > 0")
    if time_to_expiry <= 0:
        # At expiry greeks aren't well-defined; return zeros for stability.
        return FDGreeks(delta=0.0, gamma=0.0, vega=0.0, theta=0.0, rho=0.0)

    # Bumps
    dS = max(spot * spot_rel_bump, 1e-8)
    dV = max(vol_abs_bump, 1e-8)
    dR = max(rate_abs_bump, 1e-8)
    dT = min(max(time_abs_bump, 1e-8), 0.5 * time_to_expiry)

    p0 = price_fn(spot, rate, vol, time_to_expiry)

    # Spot derivatives (central)
    p_up = price_fn(spot + dS, rate, vol, time_to_expiry)
    p_dn = price_fn(max(spot - dS, 1e-12), rate, vol, time_to_expiry)

    delta = (p_up - p_dn) / (2.0 * dS)
    gamma = (p_up - 2.0 * p0 + p_dn) / (dS * dS)

    if scheme == "forward":
        # Slightly cheaper / sometimes more stable for Monte Carlo noise
        delta = (p_up - p0) / dS
        gamma = (p_up - 2.0 * p0 + p_dn) / (dS * dS)

    # Vega (central or forward)
    if scheme == "central":
        pv_up = price_fn(spot, rate, vol + dV, time_to_expiry)
        pv_dn = price_fn(spot, rate, max(vol - dV, 1e-8), time_to_expiry)
        vega = (pv_up - pv_dn) / (2.0 * dV)
    else:
        pv_up = price_fn(spot, rate, vol + dV, time_to_expiry)
        vega = (pv_up - p0) / dV

    # Rho
    if scheme == "central":
        pr_up = price_fn(spot, rate + dR, vol, time_to_expiry)
        pr_dn = price_fn(spot, rate - dR, vol, time_to_expiry)
        rho = (pr_up - pr_dn) / (2.0 * dR)
    else:
        pr_up = price_fn(spot, rate + dR, vol, time_to_expiry)
        rho = (pr_up - p0) / dR

    # Theta (calendar-time): reduce expiry
    p_shorter = price_fn(spot, rate, vol, time_to_expiry - dT)
    theta = (p_shorter - p0) / dT

    return FDGreeks(delta=delta, gamma=gamma, vega=vega, theta=theta, rho=rho)
