from __future__ import annotations

from typing import Any

from app.schemas.pricing import Greeks
from app.services.instrument_pricer import price_leg_price_only, price_leg_with_greeks


def _zero_greeks() -> Greeks:
    return Greeks(delta=0.0, gamma=0.0, vega=0.0, theta=0.0, rho=0.0)


def add_greeks(a: Greeks, b: Greeks) -> Greeks:
    return Greeks(
        delta=a.delta + b.delta,
        gamma=a.gamma + b.gamma,
        vega=a.vega + b.vega,
        theta=a.theta + b.theta,
        rho=a.rho + b.rho,
    )


def scale_greeks(g: Greeks, k: float) -> Greeks:
    return Greeks(delta=g.delta * k, gamma=g.gamma * k, vega=g.vega * k, theta=g.theta * k, rho=g.rho * k)


def price_portfolio_with_greeks(
    *,
    market: dict[str, float],
    legs: list[dict[str, Any]],
    strict: bool = False,
) -> tuple[float, Greeks, list[dict[str, Any]]]:
    """Return (total_price, total_greeks, per_leg_results).

    Each element of `legs` must have keys: leg_id, instrument_type, method, quantity, params.
    """

    total_price = 0.0
    total_g = _zero_greeks()
    results: list[dict[str, Any]] = []

    for leg in legs:
        leg_id = str(leg.get("leg_id", ""))
        instrument_type = str(leg.get("instrument_type", ""))
        method = str(leg.get("method", ""))
        qty = float(leg.get("quantity", 0.0))
        params = dict(leg.get("params", {}))

        try:
            priced = price_leg_with_greeks(instrument_type=instrument_type, method=method, market=market, params=params)
            price_total = priced.price_per_unit * qty
            greeks_total = scale_greeks(priced.greeks, qty)

            total_price += price_total
            total_g = add_greeks(total_g, greeks_total)

            results.append(
                {
                    "leg_id": leg_id,
                    "instrument_type": instrument_type,
                    "method": method,
                    "quantity": qty,
                    "status": "ok",
                    "price_per_unit": priced.price_per_unit,
                    "price_total": price_total,
                    "greeks": priced.greeks.model_dump(),
                }
            )
        except Exception as exc:  # noqa: BLE001
            results.append(
                {
                    "leg_id": leg_id,
                    "instrument_type": instrument_type,
                    "method": method,
                    "quantity": qty,
                    "status": "error",
                    "error": str(exc),
                }
            )
            if strict:
                raise

    return total_price, total_g, results


def scenario_grid_totals(
    *,
    market: dict[str, float],
    legs: list[dict[str, Any]],
    spot_shifts_pct: list[float],
    vol_shifts: list[float],
    rate_shift_bps: float,
) -> list[list[float]]:
    """Return grid totals indexed by [vol_index][spot_index].

    Uses price-only valuations for performance.
    """

    base_spot = float(market["spot"])
    base_rate = float(market["rate"])
    base_q = float(market.get("dividend_yield", 0.0))
    base_vol = float(market.get("vol", 0.0))
    bumped_rate = base_rate + rate_shift_bps / 10000.0

    grid: list[list[float]] = []
    for dv in vol_shifts:
        row: list[float] = []
        v = max(base_vol + float(dv), 1e-8)
        for ds_pct in spot_shifts_pct:
            s = base_spot * (1.0 + float(ds_pct) / 100.0)
            m = {"spot": s, "rate": bumped_rate, "dividend_yield": base_q, "vol": v}

            total = 0.0
            for leg in legs:
                qty = float(leg.get("quantity", 0.0))
                if qty == 0:
                    continue
                instrument_type = str(leg.get("instrument_type", ""))
                method = str(leg.get("method", ""))
                params = dict(leg.get("params", {}))
                try:
                    price = price_leg_price_only(
                        instrument_type=instrument_type,
                        method=method,
                        market=m,
                        params=params,
                        rng_cache=None,
                    )
                    total += price * qty
                except Exception:
                    # Skip invalid legs; grid is a quick visual.
                    continue
            row.append(total)
        grid.append(row)
    return grid


def payoff_curve(
    *,
    legs: list[dict[str, Any]],
    spots: list[float],
) -> tuple[list[float], list[str], list[dict[str, str]]]:
    """Compute a terminal payoff curve for path-independent legs.

    Returns (payoffs, included_leg_ids, excluded_list)
    """

    included: list[str] = []
    excluded: list[dict[str, str]] = []

    # Pre-parse leg payoff functions
    payoff_legs: list[tuple[str, float, Any]] = []
    for leg in legs:
        leg_id = str(leg.get("leg_id", ""))
        instrument_type = str(leg.get("instrument_type", ""))
        method = str(leg.get("method", ""))
        qty = float(leg.get("quantity", 0.0))
        params = dict(leg.get("params", {}))

        # Path-dependent types are excluded from payoff preview.
        if instrument_type in ("barrier", "asian"):
            excluded.append({"leg_id": leg_id, "reason": "path-dependent payoff"})
            continue

        try:
            if instrument_type in ("vanilla", "american"):
                ot = str(params.get("option_type", "call")).lower().strip()
                K = float(params.get("strike", 0.0))
                if ot not in ("call", "put"):
                    raise ValueError("option_type")

                def _payoff(s: float, _ot: str = ot, _K: float = K) -> float:
                    return max(0.0, s - _K) if _ot == "call" else max(0.0, _K - s)

                payoff_legs.append((leg_id, qty, _payoff))
                included.append(leg_id)
                continue

            if instrument_type == "digital":
                ot = str(params.get("option_type", "call")).lower().strip()
                K = float(params.get("strike", 0.0))
                payout = float(params.get("payout", 1.0))
                if ot not in ("call", "put"):
                    raise ValueError("option_type")

                def _payoff(s: float, _ot: str = ot, _K: float = K, _p: float = payout) -> float:
                    if _ot == "call":
                        return _p if s > _K else 0.0
                    return _p if s < _K else 0.0

                payoff_legs.append((leg_id, qty, _payoff))
                included.append(leg_id)
                continue

            if instrument_type == "forward":
                K = float(params.get("strike", 0.0))

                def _payoff(s: float, _K: float = K) -> float:
                    return s - _K

                payoff_legs.append((leg_id, qty, _payoff))
                included.append(leg_id)
                continue

            excluded.append({"leg_id": leg_id, "reason": f"unsupported payoff type: {instrument_type}"})

        except Exception:
            excluded.append({"leg_id": leg_id, "reason": "invalid leg params"})

    payoffs: list[float] = []
    for s in spots:
        total = 0.0
        for _, qty, fn in payoff_legs:
            total += qty * float(fn(float(s)))
        payoffs.append(total)

    return payoffs, included, excluded
