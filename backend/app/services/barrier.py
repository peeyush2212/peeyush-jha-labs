from __future__ import annotations

import math
from typing import Literal

import numpy as np


def barrier_knockout_mc_price(
    option_type: Literal["call", "put"],
    *,
    spot: float,
    strike: float,
    barrier_level: float,
    barrier_direction: Literal["up", "down"],
    rate: float,
    dividend_yield: float,
    vol: float,
    time_to_expiry: float,
    paths: int = 20000,
    steps: int = 96,
    seed: int = 7,
    brownian_bridge: bool = False,
    z: np.ndarray | None = None,
    u: np.ndarray | None = None,
) -> float:
    """Monte Carlo knock-out barrier option under GBM.

    Supports:
      - Up-and-out and Down-and-out (direction).
      - Optional Brownian-bridge correction to reduce discrete monitoring bias.

    The Brownian-bridge crossing probability is applied in log-space between endpoints.
    """

    if spot <= 0 or strike <= 0 or barrier_level <= 0:
        raise ValueError("spot, strike, and barrier_level must be > 0")
    if vol <= 0:
        raise ValueError("vol must be > 0")
    if time_to_expiry <= 0:
        intrinsic = max(0.0, spot - strike) if option_type == "call" else max(0.0, strike - spot)
        return intrinsic
    if paths < 1 or steps < 1:
        raise ValueError("paths and steps must be >= 1")

    # Immediate knock-out
    if barrier_direction == "up" and spot >= barrier_level:
        return 0.0
    if barrier_direction == "down" and spot <= barrier_level:
        return 0.0

    T = time_to_expiry
    dt = T / steps
    drift = (rate - dividend_yield - 0.5 * vol * vol) * dt
    diff = vol * math.sqrt(dt)

    if z is None:
        rng = np.random.default_rng(seed)
        z = rng.standard_normal((paths, steps))
        if brownian_bridge:
            u = rng.random((paths, steps))
    else:
        if z.shape != (paths, steps):
            raise ValueError("z has wrong shape")
        if brownian_bridge:
            if u is None or u.shape != (paths, steps):
                raise ValueError("u is required with brownian_bridge and must match z")

    s = np.full(paths, spot, dtype=float)
    alive = np.ones(paths, dtype=bool)

    # Precompute constants used in the Brownian-bridge crossing probability.
    sigma2_dt = vol * vol * dt

    for i in range(steps):
        s_next = s * np.exp(drift + diff * z[:, i])

        if barrier_direction == "up":
            # Discrete monitoring
            hit = (s_next >= barrier_level) | (s >= barrier_level)

            if brownian_bridge:
                # For paths where both endpoints are below the barrier, estimate intra-step crossing probability.
                mask = alive & (~hit) & (s < barrier_level) & (s_next < barrier_level)
                if np.any(mask):
                    ln1 = np.log(barrier_level / s[mask])
                    ln2 = np.log(barrier_level / s_next[mask])
                    p_cross = np.exp(-2.0 * ln1 * ln2 / sigma2_dt)
                    # Cross if uniform < p_cross
                    hit_bridge = u[mask, i] < p_cross
                    hit[mask] = hit_bridge

        else:
            # Down barrier
            hit = (s_next <= barrier_level) | (s <= barrier_level)

            if brownian_bridge:
                mask = alive & (~hit) & (s > barrier_level) & (s_next > barrier_level)
                if np.any(mask):
                    ln1 = np.log(s[mask] / barrier_level)
                    ln2 = np.log(s_next[mask] / barrier_level)
                    p_cross = np.exp(-2.0 * ln1 * ln2 / sigma2_dt)
                    hit_bridge = u[mask, i] < p_cross
                    hit[mask] = hit_bridge

        alive &= ~hit
        s = s_next

    if option_type == "call":
        payoff = np.maximum(s - strike, 0.0)
    else:
        payoff = np.maximum(strike - s, 0.0)

    payoff = np.where(alive, payoff, 0.0)
    return float(math.exp(-rate * T) * payoff.mean())
