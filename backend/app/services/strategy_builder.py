from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from typing import Any

from app.meta.instrument_catalog import CATALOG
from app.schemas.instruments import InstrumentLeg, MarketInputs
from app.schemas.pricing import Greeks
from app.schemas.strategy import (
    StrategyAnalyzeRequest,
    StrategyAnalyzeResponse,
    StrategyCandidate,
    StrategyConstraints,
    StrategyCurve,
    StrategyGeneration,
    StrategyHeatmap,
    StrategyRecommendRequest,
    StrategyRecommendResponse,
    StrategyScenarioRow,
    StrategyView,
)
from app.services.instrument_pricer import price_leg_price_only
from app.services.portfolio import payoff_curve, price_portfolio_with_greeks, scenario_grid_totals


@dataclass(frozen=True)
class NormalizedView:
    signed_move_pct: float
    move_mag_pct: float
    expected_spot: float
    horizon_years: float
    signed_vol_shift: float


def _round_to_step(x: float, step: float) -> float:
    if step <= 0:
        return float(x)
    return float(round(x / step) * step)


def _method_note_for_vanilla(method: str) -> str:
    try:
        instruments = CATALOG.get("instruments", [])  # type: ignore[assignment]
        for inst in instruments:  # type: ignore[assignment]
            if inst.get("key") == "vanilla":
                for m in inst.get("methods", []):
                    if m.get("key") == method:
                        return str(m.get("note", ""))
    except Exception:
        pass
    return ""


STRATEGY_NOTES: dict[str, str] = {
    "bull_call_spread": "Defined-risk bullish structure: long a lower strike call, short a higher strike call.",
    "bear_put_spread": "Defined-risk bearish structure: long a higher strike put, short a lower strike put.",
    "bull_put_spread": "Defined-risk income-leaning bullish structure: short a higher strike put, long a lower strike put.",
    "bear_call_spread": "Defined-risk income-leaning bearish structure: short a lower strike call, long a higher strike call.",
    "straddle": "Convex / event-style structure: long call + long put at the same strike (typically ATM).",
    "strangle": "Convex structure: long OTM put + long OTM call; cheaper than a straddle but needs a larger move.",
    "butterfly_call": "Range-bound structure (calls): 1:-2:1 call fly around a center strike.",
    "butterfly_put": "Range-bound structure (puts): 1:-2:1 put fly around a center strike.",
    "calendar_call": "Time/vol structure: sell near-term call, buy longer-term call at same strike.",
    "calendar_put": "Time/vol structure: sell near-term put, buy longer-term put at same strike.",
    "strap": "Directional convexity: long 2 calls + long 1 put (same strike).",
    "strip": "Directional convexity: long 1 call + long 2 puts (same strike).",
}


def normalize_view(view: StrategyView, *, spot: float, vol: float) -> NormalizedView:
    if view.target_price is not None:
        raw_move_pct = (float(view.target_price) / float(spot) - 1.0) * 100.0
    else:
        raw_move_pct = float(view.move_pct or 0.0)

    move_mag_pct = abs(raw_move_pct)

    # Align sign to direction so the UI can accept "5" and direction decides the sign.
    if view.direction == "bullish":
        signed_move_pct = abs(raw_move_pct)
        expected_spot = spot * (1.0 + signed_move_pct / 100.0)
    elif view.direction == "bearish":
        signed_move_pct = -abs(raw_move_pct)
        expected_spot = spot * (1.0 + signed_move_pct / 100.0)
    else:
        # Neutral: treat raw move as a *range width* (used for strike placement), center stays at spot.
        signed_move_pct = 0.0
        expected_spot = spot

    horizon_years = max(1.0 / 365.0, float(view.horizon_days) / 365.0)

    if view.vol_view == "up":
        signed_vol_shift = float(view.vol_shift)
    elif view.vol_view == "down":
        signed_vol_shift = -float(view.vol_shift)
    else:
        signed_vol_shift = 0.0

    # Clamp so we don't create negative vols.
    if vol + signed_vol_shift <= 0:
        signed_vol_shift = max(-vol + 1e-6, signed_vol_shift)

    return NormalizedView(
        signed_move_pct=signed_move_pct,
        move_mag_pct=move_mag_pct,
        expected_spot=expected_spot,
        horizon_years=horizon_years,
        signed_vol_shift=signed_vol_shift,
    )


def _auto_width_pct(*, move_mag_pct: float, vol: float, horizon_years: float) -> float:
    # Use a blend of the user's move and the implied 1-sigma move.
    sigma_pct = vol * math.sqrt(max(1e-9, horizon_years)) * 100.0
    band = max(move_mag_pct, 0.6 * sigma_pct)
    # Keep it in a sane range.
    return float(min(40.0, max(2.0, band)))


def _base_strikes(*, spot: float, step: float, width_abs: float) -> tuple[float, float, float]:
    k_atm = _round_to_step(spot, step)
    k_up = _round_to_step(spot + width_abs, step)
    k_dn = _round_to_step(max(1e-6, spot - width_abs), step)

    if k_up <= k_atm:
        k_up = k_atm + step
    if k_dn >= k_atm:
        k_dn = max(1e-6, k_atm - step)
    return k_atm, k_dn, k_up


def _leg_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _make_vanilla_leg(
    *,
    qty: float,
    option_type: str,
    strike: float,
    t_years: float,
    method: str,
    tree_steps: int,
) -> InstrumentLeg:
    params: dict[str, Any] = {
        "option_type": option_type,
        "strike": float(strike),
        "time_to_expiry": float(t_years),
    }
    if method == "binomial_crr":
        params["steps"] = int(tree_steps)

    return InstrumentLeg(
        leg_id=_leg_id("L"),
        instrument_type="vanilla",
        method=method,
        quantity=float(qty),
        params=params,
    )


def build_strategy_legs(
    strategy_key: str,
    *,
    market: MarketInputs,
    view: NormalizedView,
    gen: StrategyGeneration,
    method: str,
) -> list[InstrumentLeg]:
    spot = float(market.spot)
    step = float(gen.strike_step)

    width_pct = float(gen.width_pct) if gen.width_pct is not None else _auto_width_pct(move_mag_pct=view.move_mag_pct, vol=float(market.vol), horizon_years=view.horizon_years)
    width_abs = max(step, spot * width_pct / 100.0)

    k_atm, k_dn, k_up = _base_strikes(spot=spot, step=step, width_abs=width_abs)

    t_short = max(1.0 / 365.0, float(gen.expiry_days) / 365.0)
    t_long = max(t_short + 1.0 / 365.0, float(gen.long_expiry_days) / 365.0)

    if strategy_key == "bull_call_spread":
        return [
            _make_vanilla_leg(qty=+1, option_type="call", strike=k_atm, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=-1, option_type="call", strike=k_up, t_years=t_short, method=method, tree_steps=gen.tree_steps),
        ]
    if strategy_key == "bear_put_spread":
        return [
            _make_vanilla_leg(qty=+1, option_type="put", strike=k_atm, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=-1, option_type="put", strike=k_dn, t_years=t_short, method=method, tree_steps=gen.tree_steps),
        ]
    if strategy_key == "bull_put_spread":
        return [
            _make_vanilla_leg(qty=-1, option_type="put", strike=k_atm, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=+1, option_type="put", strike=k_dn, t_years=t_short, method=method, tree_steps=gen.tree_steps),
        ]
    if strategy_key == "bear_call_spread":
        return [
            _make_vanilla_leg(qty=-1, option_type="call", strike=k_atm, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=+1, option_type="call", strike=k_up, t_years=t_short, method=method, tree_steps=gen.tree_steps),
        ]
    if strategy_key == "straddle":
        return [
            _make_vanilla_leg(qty=+1, option_type="call", strike=k_atm, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=+1, option_type="put", strike=k_atm, t_years=t_short, method=method, tree_steps=gen.tree_steps),
        ]
    if strategy_key == "strangle":
        return [
            _make_vanilla_leg(qty=+1, option_type="put", strike=k_dn, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=+1, option_type="call", strike=k_up, t_years=t_short, method=method, tree_steps=gen.tree_steps),
        ]
    if strategy_key == "butterfly_call":
        k2 = _round_to_step(view.expected_spot, step)
        k1 = _round_to_step(max(1e-6, k2 - width_abs), step)
        k3 = _round_to_step(k2 + width_abs, step)
        if k1 <= 0:
            k1 = step
        if not (k1 < k2 < k3):
            k1, k2, k3 = k_dn, k_atm, k_up
        return [
            _make_vanilla_leg(qty=+1, option_type="call", strike=k1, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=-2, option_type="call", strike=k2, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=+1, option_type="call", strike=k3, t_years=t_short, method=method, tree_steps=gen.tree_steps),
        ]
    if strategy_key == "butterfly_put":
        k2 = _round_to_step(view.expected_spot, step)
        k1 = _round_to_step(max(1e-6, k2 - width_abs), step)
        k3 = _round_to_step(k2 + width_abs, step)
        if k1 <= 0:
            k1 = step
        if not (k1 < k2 < k3):
            k1, k2, k3 = k_dn, k_atm, k_up
        return [
            _make_vanilla_leg(qty=+1, option_type="put", strike=k1, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=-2, option_type="put", strike=k2, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=+1, option_type="put", strike=k3, t_years=t_short, method=method, tree_steps=gen.tree_steps),
        ]
    if strategy_key == "calendar_call":
        return [
            _make_vanilla_leg(qty=-1, option_type="call", strike=k_atm, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=+1, option_type="call", strike=k_atm, t_years=t_long, method=method, tree_steps=gen.tree_steps),
        ]
    if strategy_key == "calendar_put":
        return [
            _make_vanilla_leg(qty=-1, option_type="put", strike=k_atm, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=+1, option_type="put", strike=k_atm, t_years=t_long, method=method, tree_steps=gen.tree_steps),
        ]
    if strategy_key == "strap":
        return [
            _make_vanilla_leg(qty=+2, option_type="call", strike=k_atm, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=+1, option_type="put", strike=k_atm, t_years=t_short, method=method, tree_steps=gen.tree_steps),
        ]
    if strategy_key == "strip":
        return [
            _make_vanilla_leg(qty=+1, option_type="call", strike=k_atm, t_years=t_short, method=method, tree_steps=gen.tree_steps),
            _make_vanilla_leg(qty=+2, option_type="put", strike=k_atm, t_years=t_short, method=method, tree_steps=gen.tree_steps),
        ]

    raise ValueError(f"Unknown strategy_key: {strategy_key}")


def _pnl_metrics(
    *,
    market: MarketInputs,
    legs: list[InstrumentLeg],
    premium: float,
    spot_range_pct: float,
    steps: int,
    expected_spot: float,
) -> tuple[list[float], list[float], float, float, list[float]]:
    spot = float(market.spot)
    lo = max(1e-6, spot * (1.0 - spot_range_pct / 100.0))
    hi = spot * (1.0 + spot_range_pct / 100.0)

    spots = [lo + (hi - lo) * i / (steps - 1) for i in range(steps)]
    payoff, _included, _excluded = payoff_curve(legs=[l.model_dump() for l in legs], spots=spots)
    pnl = [float(p) - float(premium) for p in payoff]

    max_pnl = max(pnl) if pnl else 0.0
    min_pnl = min(pnl) if pnl else 0.0

    # Breakevens: find sign changes and linearly interpolate.
    breakevens: list[float] = []
    for i in range(1, len(pnl)):
        a = pnl[i - 1]
        b = pnl[i]
        if (a == 0) or (b == 0) or (a < 0 < b) or (a > 0 > b):
            # Avoid duplicates when we hit exact zeros.
            if a == 0:
                be = spots[i - 1]
            elif b == 0:
                be = spots[i]
            else:
                t = -a / (b - a)
                be = spots[i - 1] + t * (spots[i] - spots[i - 1])
            if not breakevens or abs(breakevens[-1] - be) > 1e-6:
                breakevens.append(float(be))

    # PnL at expected spot (linear interp over the grid)
    pnl_expected = pnl[0]
    if expected_spot <= spots[0]:
        pnl_expected = pnl[0]
    elif expected_spot >= spots[-1]:
        pnl_expected = pnl[-1]
    else:
        for i in range(1, len(spots)):
            if spots[i] >= expected_spot:
                x0, x1 = spots[i - 1], spots[i]
                y0, y1 = pnl[i - 1], pnl[i]
                t = (expected_spot - x0) / (x1 - x0)
                pnl_expected = y0 + t * (y1 - y0)
                break

    return spots, pnl, float(max_pnl), float(min_pnl), breakevens


def _payoff_slope_high(legs: list[InstrumentLeg]) -> float:
    # Approximate slope of terminal payoff as S -> +infty.
    slope = 0.0
    for l in legs:
        if l.instrument_type == "forward":
            slope += float(l.quantity)
        elif l.instrument_type in ("vanilla", "american", "digital", "barrier", "asian"):
            # For vanilla-style terminal payoff:
            ot = str(l.params.get("option_type", "call")).lower()
            if ot == "call":
                slope += float(l.quantity)
    return float(slope)


def score_candidate(
    *,
    view: StrategyView,
    norm: NormalizedView,
    constraints: StrategyConstraints,
    net_premium: float,
    greeks: Greeks,
    pnl_expected: float,
    max_loss_est: float | None,
    legs_count: int,
) -> tuple[int, str]:
    score = 50.0

    delta = float(greeks.delta)
    gamma = float(greeks.gamma)
    vega = float(greeks.vega)
    theta = float(greeks.theta)

    # Direction alignment
    if view.direction == "bullish":
        score += 20.0 * math.tanh(delta / 0.5)
    elif view.direction == "bearish":
        score += 20.0 * math.tanh(-delta / 0.5)
    else:
        score += 10.0 - 20.0 * min(1.0, abs(delta) / 0.3)

    # Vol alignment
    if view.vol_view == "up":
        score += 10.0 * math.tanh(vega / 35.0)
    elif view.vol_view == "down":
        score += 10.0 * math.tanh(-vega / 35.0)
    else:
        score += 5.0 - 5.0 * min(1.0, abs(vega) / 45.0)

    # Magnitude alignment (payoff at expected spot, normalized by risk)
    denom = 1.0
    if max_loss_est is not None and max_loss_est > 1e-9:
        denom = max_loss_est
    else:
        denom = max(1.0, abs(net_premium))
    score += 15.0 * max(-1.0, min(1.0, pnl_expected / denom))

    # Preference slider: income vs convexity
    pref = float(constraints.income_vs_convexity)
    if pref < 0.45:
        # Income: prefer credit and positive theta
        if net_premium < 0:
            score += 6.0
        if theta > 0:
            score += 2.0
    elif pref > 0.55:
        # Convexity: prefer debit and positive gamma/vega
        if net_premium > 0:
            score += 4.0
        if gamma > 0:
            score += 2.0
        if vega > 0:
            score += 2.0

    # Fewer legs gets a small bonus.
    if legs_count <= 2:
        score += 4.0
    elif legs_count == 3:
        score += 2.0

    # Event toggle nudges towards convex/long vol.
    if view.event:
        if gamma > 0:
            score += 2.0
        if vega > 0:
            score += 2.0

    score = max(0.0, min(100.0, score))

    # Rationale string
    reasons: list[str] = []
    if view.direction == "bullish" and delta > 0.05:
        reasons.append("positive Δ")
    if view.direction == "bearish" and delta < -0.05:
        reasons.append("negative Δ")
    if view.direction == "neutral" and abs(delta) < 0.08:
        reasons.append("near-neutral Δ")

    if view.vol_view == "up" and vega > 0:
        reasons.append("positive ν")
    if view.vol_view == "down" and vega < 0:
        reasons.append("negative ν")

    if net_premium < 0:
        reasons.append("net credit")
    else:
        reasons.append("net debit")

    if max_loss_est is not None:
        reasons.append("defined risk")

    if pnl_expected > 0:
        reasons.append("positive PnL at target")

    rationale = ", ".join(reasons) if reasons else "ranked by Δ/ν alignment, risk, and expected payoff"

    return int(round(score)), rationale


def recommend_strategies(req: StrategyRecommendRequest) -> tuple[StrategyRecommendResponse, dict[str, Any]]:
    market = req.market
    norm = normalize_view(req.view, spot=float(market.spot), vol=float(market.vol))

    # Strategy universe filtered by view + constraints.
    keys: list[str] = []
    if req.view.direction == "bullish":
        keys = ["bull_call_spread", "bull_put_spread", "strap", "butterfly_call"]
        if req.constraints.allow_multi_expiry:
            keys.append("calendar_call")
        if req.view.vol_view == "up" or req.view.event or norm.move_mag_pct >= 6.0:
            keys.extend(["straddle", "strangle"])
    elif req.view.direction == "bearish":
        keys = ["bear_put_spread", "bear_call_spread", "strip", "butterfly_put"]
        if req.constraints.allow_multi_expiry:
            keys.append("calendar_put")
        if req.view.vol_view == "up" or req.view.event or norm.move_mag_pct >= 6.0:
            keys.extend(["straddle", "strangle"])
    else:
        keys = ["straddle", "strangle", "butterfly_call", "butterfly_put"]
        if req.constraints.allow_multi_expiry:
            keys.extend(["calendar_call", "calendar_put"])

    # De-dup while preserving order
    seen: set[str] = set()
    keys = [k for k in keys if not (k in seen or seen.add(k))]

    candidates: list[StrategyCandidate] = []

    for key in keys:
        # Multi-expiry guard
        if (key.startswith("calendar")) and (not req.constraints.allow_multi_expiry):
            continue

        legs = build_strategy_legs(key, market=market, view=norm, gen=req.generation, method=req.method)

        if len(legs) > req.constraints.max_legs:
            continue

        total_price, total_greeks, leg_results = price_portfolio_with_greeks(market=market.model_dump(), legs=[l.model_dump() for l in legs], strict=True)

        # Use a wide spot range for risk metrics (auto from move/vol)
        spot_range_pct = max(20.0, min(80.0, 2.0 * norm.move_mag_pct + 10.0))
        spots, pnl, max_pnl, min_pnl, breakevens = _pnl_metrics(
            market=market,
            legs=legs,
            premium=total_price,
            spot_range_pct=spot_range_pct,
            steps=121,
            expected_spot=norm.expected_spot,
        )
        # PnL at expected spot is already computed inside _pnl_metrics as last value (we didn't return); re-interp quickly:
        # We'll re-use the interpolation by calling again with the expected spot, but that's waste.
        # Instead, approximate from pnl array around expected spot.
        pnl_expected = 0.0
        if spots and pnl:
            if norm.expected_spot <= spots[0]:
                pnl_expected = pnl[0]
            elif norm.expected_spot >= spots[-1]:
                pnl_expected = pnl[-1]
            else:
                for i in range(1, len(spots)):
                    if spots[i] >= norm.expected_spot:
                        x0, x1 = spots[i - 1], spots[i]
                        y0, y1 = pnl[i - 1], pnl[i]
                        t = (norm.expected_spot - x0) / (x1 - x0)
                        pnl_expected = y0 + t * (y1 - y0)
                        break

        max_loss_est: float | None = None
        if min_pnl < 0:
            max_loss_est = -min_pnl
        else:
            max_loss_est = 0.0

        # Apply max_loss filter
        if req.constraints.max_loss is not None and max_loss_est is not None:
            if max_loss_est > float(req.constraints.max_loss) + 1e-9:
                continue

        slope_high = _payoff_slope_high(legs)
        unlimited_upside = slope_high > 1e-9

        max_profit: float | None = None if unlimited_upside else max_pnl

        score, rationale = score_candidate(
            view=req.view,
            norm=norm,
            constraints=req.constraints,
            net_premium=total_price,
            greeks=total_greeks,
            pnl_expected=pnl_expected,
            max_loss_est=max_loss_est,
            legs_count=len(legs),
        )

        name_map = {
            "bull_call_spread": "Bull call spread",
            "bear_put_spread": "Bear put spread",
            "bull_put_spread": "Bull put spread",
            "bear_call_spread": "Bear call spread",
            "straddle": "Long straddle",
            "strangle": "Long strangle",
            "butterfly_call": "Call butterfly",
            "butterfly_put": "Put butterfly",
            "calendar_call": "Call calendar",
            "calendar_put": "Put calendar",
            "strap": "Strap",
            "strip": "Strip",
        }

        strategy_note = STRATEGY_NOTES.get(key, "")
        method_note = _method_note_for_vanilla(req.method)

        candidates.append(
            StrategyCandidate(
                candidate_id=str(uuid.uuid4()),
                strategy_key=key,
                name=name_map.get(key, key),
                fit_score=score,
                rationale=rationale,
                legs=legs,
                net_premium=float(total_price),
                max_profit=None if unlimited_upside else float(max_pnl),
                max_loss=float(max_loss_est) if max_loss_est is not None else None,
                breakevens=breakevens,
                total_greeks=total_greeks,
                strategy_note=strategy_note,
                method_note=method_note,
            )
        )

    # Sort and keep top 5
    candidates.sort(key=lambda c: c.fit_score, reverse=True)
    candidates = candidates[:5]

    response = StrategyRecommendResponse(
        run_id="",
        normalized_move_pct=float(norm.signed_move_pct),
        expected_spot=float(norm.expected_spot),
        signed_vol_shift=float(norm.signed_vol_shift),
        candidates=candidates,
    )

    meta = {
        "strategy_keys": keys,
    }

    return response, meta


def analyze_strategy(req: StrategyAnalyzeRequest) -> StrategyAnalyzeResponse:
    market = req.market
    spot0 = float(market.spot)

    norm = normalize_view(req.view, spot=spot0, vol=float(market.vol))

    # Base price + greeks at t0
    total_price, total_greeks, legs_priced = price_portfolio_with_greeks(market=market.model_dump(), legs=[l.model_dump() for l in req.legs], strict=True)

    # Payoff curve at expiry (terminal)
    range_pct = float(req.settings.spot_range_pct)
    lo = max(1e-6, spot0 * (1.0 - range_pct / 100.0))
    hi = spot0 * (1.0 + range_pct / 100.0)
    steps = int(req.settings.spot_steps)

    spots = [lo + (hi - lo) * i / (steps - 1) for i in range(steps)]

    payoff, _included, _excluded = payoff_curve(legs=[l.model_dump() for l in req.legs], spots=spots)
    payoff_pnl = [float(p) - float(total_price) for p in payoff]

    # Horizon revaluation curve (mark-to-model)
    horizon = norm.horizon_years
    market_h = market.model_dump()
    market_h["vol"] = float(market_h["vol"]) + float(norm.signed_vol_shift)

    horizon_vals: list[float] = []

    # Prepare legs with reduced time
    legs_h: list[InstrumentLeg] = []
    for l in req.legs:
        p = dict(l.params)
        t0 = float(p.get("time_to_expiry", 0.0))
        p["time_to_expiry"] = max(0.0, t0 - horizon)
        legs_h.append(
            InstrumentLeg(
                leg_id=l.leg_id,
                instrument_type=l.instrument_type,
                method=l.method,
                quantity=l.quantity,
                params=p,
            )
        )

    for s in spots:
        m = dict(market_h)
        m["spot"] = float(s)
        total = 0.0
        for l in legs_h:
            price = price_leg_price_only(
                instrument_type=l.instrument_type,
                method=l.method,
                market=m,
                params=l.params,
            )
            total += float(price) * float(l.quantity)
        horizon_vals.append(float(total))

    horizon_pnl = [float(v) - float(total_price) for v in horizon_vals]

    # Breakevens + max profit/loss from payoff curve
    be: list[float] = []
    for i in range(1, len(payoff_pnl)):
        a = payoff_pnl[i - 1]
        b = payoff_pnl[i]
        if (a == 0) or (b == 0) or (a < 0 < b) or (a > 0 > b):
            if a == 0:
                x = spots[i - 1]
            elif b == 0:
                x = spots[i]
            else:
                t = -a / (b - a)
                x = spots[i - 1] + t * (spots[i] - spots[i - 1])
            if not be or abs(be[-1] - x) > 1e-6:
                be.append(float(x))

    max_pnl = max(payoff_pnl) if payoff_pnl else 0.0
    min_pnl = min(payoff_pnl) if payoff_pnl else 0.0

    max_loss = -min_pnl if min_pnl < 0 else 0.0

    slope_high = _payoff_slope_high(req.legs)
    unlimited_upside = slope_high > 1e-9
    max_profit: float | None = None if unlimited_upside else max_pnl

    # Heatmap around horizon (spot x vol)
    spot_shifts = list(req.settings.grid_spot_shifts_pct)
    vol_shifts = list(req.settings.grid_vol_shifts)
    rate_shift_bps = float(req.settings.grid_rate_shift_bps)

    base_total_h = horizon_vals[spots.index(spot0)] if spot0 in spots else horizon_vals[len(horizon_vals)//2]

    # Compute base_total at spot0 precisely (not from grid)
    base_total_h = 0.0
    base_m = dict(market_h)
    base_m["spot"] = spot0
    for l in legs_h:
        base_total_h += price_leg_price_only(
            instrument_type=l.instrument_type,
            method=l.method,
            market=base_m,
            params=l.params,
        ) * float(l.quantity)

    grid_totals = scenario_grid_totals(
        market=market_h,
        legs=[l.model_dump() for l in legs_h],
        spot_shifts_pct=spot_shifts,
        vol_shifts=vol_shifts,
        rate_shift_bps=rate_shift_bps,
    )
    grid_pnl = [[float(x) - float(base_total_h) for x in row] for row in grid_totals]

    # Focus cell (expected move, vol view)
    focus_spot_shift = (norm.expected_spot / spot0 - 1.0) * 100.0
    focus_vol = float(norm.signed_vol_shift)
    fi = min(range(len(spot_shifts)), key=lambda i: abs(spot_shifts[i] - focus_spot_shift)) if spot_shifts else 0
    fj = min(range(len(vol_shifts)), key=lambda j: abs(vol_shifts[j] - focus_vol)) if vol_shifts else 0
    focus_ij: tuple[int, int] | None = None
    if spot_shifts and vol_shifts:
        focus_ij = (fi, fj)

    heatmap = StrategyHeatmap(
        spot_shifts_pct=spot_shifts,
        vol_shifts=vol_shifts,
        base_total=float(base_total_h),
        grid_totals=grid_totals,
        grid_pnl=grid_pnl,
        focus_spot_shift_pct=float(focus_spot_shift),
        focus_vol_shift=float(focus_vol),
        focus_ij=focus_ij,
    )

    # Scenario pack at horizon (simple, interpretable)
    scenario_defs: list[tuple[str, float, float, float]] = [
        ("Spot -10%", -10.0, 0.0, 0.0),
        ("Spot -5%", -5.0, 0.0, 0.0),
        ("Spot +5%", 5.0, 0.0, 0.0),
        ("Spot +10%", 10.0, 0.0, 0.0),
        ("Vol -5", 0.0, -0.05, 0.0),
        ("Vol +5", 0.0, 0.05, 0.0),
        ("Rate -25bp", 0.0, 0.0, -25.0),
        ("Rate +25bp", 0.0, 0.0, 25.0),
    ]

    rows: list[StrategyScenarioRow] = []
    for label, ds, dv, dr_bps in scenario_defs:
        m = dict(market_h)
        m["spot"] = spot0 * (1.0 + ds / 100.0)
        m["vol"] = max(1e-6, float(m["vol"]) + dv)
        m["rate"] = float(m["rate"]) + dr_bps / 10000.0
        total = 0.0
        for l in legs_h:
            total += price_leg_price_only(
                instrument_type=l.instrument_type,
                method=l.method,
                market=m,
                params=l.params,
            ) * float(l.quantity)
        rows.append(
            StrategyScenarioRow(
                label=label,
                spot_shift_pct=ds,
                vol_shift=dv,
                rate_shift_bps=dr_bps,
                total_value=float(total),
                pnl_vs_initial=float(total) - float(total_price),
            )
        )

    return StrategyAnalyzeResponse(
        run_id="",
        base_total=float(total_price),
        total_greeks=total_greeks,
        per_leg=legs_priced,
        payoff=StrategyCurve(spots=spots, values=payoff_pnl),
        horizon=StrategyCurve(spots=spots, values=horizon_pnl),
        breakevens=be,
        max_profit=max_profit,
        max_loss=float(max_loss),
        heatmap=heatmap,
        scenario_pack=rows,
    )
