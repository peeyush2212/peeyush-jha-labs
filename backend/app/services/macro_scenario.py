from __future__ import annotations

import csv
import io
from dataclasses import asdict
from datetime import date

from app.schemas.macro import (
    FxPosition,
    FixedIncomePosition,
    MacroCarryInputs,
    MacroCompareItem,
    MacroCompareRequest,
    MacroCompareResponse,
    MacroGridRequest,
    MacroGridResponse,
    MacroPositionResult,
    MacroScenario,
    MacroScenarioRequest,
    MacroScenarioResult,
)
from app.services import macro_data


def _bond_price_change_pct(mod_dur: float, conv: float, shock_bps: float) -> float:
    """Duration/convexity approximation.

    ΔP/P ≈ -D * Δy + 0.5 * C * (Δy)^2
    where Δy is in decimal (e.g. 100 bps -> 0.01)
    """

    dy = shock_bps / 10000.0
    return (-mod_dur * dy) + 0.5 * conv * (dy * dy)


def _fixed_income_leg(pos: FixedIncomePosition, *, shock_bps: float) -> tuple[float, dict[str, float | str]]:
    pct = _bond_price_change_pct(pos.modified_duration, pos.convexity, shock_bps)
    pnl = pos.notional_inr * pct
    dv01 = pos.notional_inr * pos.modified_duration * 0.0001
    details: dict[str, float | str] = {
        "notional_inr": pos.notional_inr,
        "modified_duration": pos.modified_duration,
        "convexity": pos.convexity,
        "shock_bps": shock_bps,
        "price_change_pct": pct * 100.0,
        "dv01_inr": dv01,
    }
    return pnl, details


def _fx_leg(pos: FxPosition, *, base_usdinr: float, fx_shock_pct: float, carry: MacroCarryInputs, base_rate_3m_pct: float, short_rate_shock_bps: float) -> tuple[float, dict[str, float | str]]:
    shock = fx_shock_pct / 100.0
    spot0 = base_usdinr
    spot1 = spot0 * (1.0 + shock)

    spot_pnl = pos.notional_usd * (spot1 - spot0)

    # Carry proxy: (domestic short rate - funding rate) * T
    t_years = carry.horizon_days / 365.0
    dom_rate_pct = base_rate_3m_pct + (short_rate_shock_bps / 100.0)
    carry_pnl = pos.notional_usd * spot0 * ((dom_rate_pct - carry.funding_rate_pct) / 100.0) * t_years

    total = spot_pnl + carry_pnl
    details: dict[str, float | str] = {
        "notional_usd": pos.notional_usd,
        "base_usdinr": spot0,
        "fx_shock_pct": fx_shock_pct,
        "spot_pnl_inr": spot_pnl,
        "horizon_days": carry.horizon_days,
        "domestic_rate_3m_pct": base_rate_3m_pct,
        "short_rate_shock_bps": short_rate_shock_bps,
        "funding_rate_pct": carry.funding_rate_pct,
        "carry_pnl_inr": carry_pnl,
    }
    return total, details


def get_base_snapshot(req: MacroScenarioRequest | MacroGridRequest | MacroCompareRequest) -> tuple[date | None, float, float, float]:
    """Resolve base values using request overrides or latest cached/bundled data."""

    timeline = macro_data.build_combined_timeline(12)
    asof = timeline[-1]["month"] if timeline else None
    base_usdinr = req.base_usdinr
    base_r3 = req.base_rate_3m_pct
    base_y10 = req.base_rate_10y_pct

    if base_usdinr is None or base_r3 is None or base_y10 is None:
        # Attempt to pull from the latest combined timeline
        if timeline:
            last = timeline[-1]
            if base_usdinr is None:
                base_usdinr = float(last.get("usdinr") or 0.0) or None
            if base_r3 is None:
                base_r3 = float(last.get("rate_3m_pct") or 0.0) or None
            if base_y10 is None:
                base_y10 = float(last.get("rate_10y_pct") or 0.0) or None

    if base_usdinr is None or base_r3 is None or base_y10 is None:
        raise ValueError("Base snapshot missing. Provide overrides or ensure macro bundled data exists.")

    return asof, float(base_usdinr), float(base_r3), float(base_y10)


def analyze_scenario(req: MacroScenarioRequest) -> tuple[MacroScenarioResult, str]:
    """Compute per-position and total P&L.

    Returns (result_model, result_csv).
    """

    asof, base_usdinr, base_r3, base_y10 = get_base_snapshot(req)

    scen: MacroScenario = req.scenario
    carry: MacroCarryInputs = req.carry

    results: list[MacroPositionResult] = []
    total_pnl = 0.0

    for pos in req.fixed_income:
        shock_bps = scen.short_rate_shock_bps if pos.rate_bucket == "short" else scen.long_rate_shock_bps
        pnl, details = _fixed_income_leg(pos, shock_bps=shock_bps)
        results.append(
            MacroPositionResult(
                label=pos.label,
                kind="fixed_income",
                pnl_inr=pnl,
                details=details,
            )
        )
        total_pnl += pnl

    for pos in req.fx:
        pnl, details = _fx_leg(
            pos,
            base_usdinr=base_usdinr,
            fx_shock_pct=scen.fx_spot_shock_pct,
            carry=carry,
            base_rate_3m_pct=base_r3,
            short_rate_shock_bps=scen.short_rate_shock_bps,
        )
        results.append(
            MacroPositionResult(
                label=pos.label,
                kind="fx",
                pnl_inr=pnl,
                details=details,
            )
        )
        total_pnl += pnl

    model = MacroScenarioResult(
        run_id=None,
        asof_date=asof,
        base_usdinr=base_usdinr,
        base_rate_3m_pct=base_r3,
        base_rate_10y_pct=base_y10,
        scenario=scen,
        carry=carry,
        positions=results,
        total_pnl_inr=total_pnl,
    )

    # Build a small CSV for downloads/runs
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["label", "kind", "pnl_inr"])
    for r in results:
        w.writerow([r.label, r.kind, f"{r.pnl_inr:.6f}"])
    w.writerow(["TOTAL", "", f"{total_pnl:.6f}"])
    csv_text = buf.getvalue()

    return model, csv_text


def _grid_total_pnl(
    fixed_income: list[FixedIncomePosition],
    fx: list[FxPosition],
    *,
    base_usdinr: float,
    base_r3: float,
    carry: MacroCarryInputs,
    short_rate_shock_bps: float,
    long_rate_shock_bps: float,
    fx_spot_shock_pct: float,
) -> float:
    total = 0.0
    for pos in fixed_income:
        shock_bps = short_rate_shock_bps if pos.rate_bucket == "short" else long_rate_shock_bps
        pnl, _ = _fixed_income_leg(pos, shock_bps=shock_bps)
        total += pnl
    for pos in fx:
        pnl, _ = _fx_leg(
            pos,
            base_usdinr=base_usdinr,
            fx_shock_pct=fx_spot_shock_pct,
            carry=carry,
            base_rate_3m_pct=base_r3,
            short_rate_shock_bps=short_rate_shock_bps,
        )
        total += pnl
    return total


def build_grid(req: MacroGridRequest) -> tuple[MacroGridResponse, str]:
    asof, base_usdinr, base_r3, base_y10 = get_base_snapshot(req)

    scen: MacroScenario = req.scenario
    carry: MacroCarryInputs = req.carry

    fx_shocks = req.fx_spot_shocks_pct
    short_shocks = req.short_rate_shocks_bps
    long_shocks = req.long_rate_shocks_bps

    short_grid: list[list[float]] | None = None
    long_grid: list[list[float]] | None = None

    if short_shocks:
        short_grid = []
        for fx_s in fx_shocks:
            row = []
            for r_s in short_shocks:
                row.append(
                    _grid_total_pnl(
                        req.fixed_income,
                        req.fx,
                        base_usdinr=base_usdinr,
                        base_r3=base_r3,
                        carry=carry,
                        short_rate_shock_bps=r_s,
                        long_rate_shock_bps=scen.long_rate_shock_bps,
                        fx_spot_shock_pct=fx_s,
                    )
                )
            short_grid.append(row)

    if long_shocks:
        long_grid = []
        for fx_s in fx_shocks:
            row = []
            for r_s in long_shocks:
                row.append(
                    _grid_total_pnl(
                        req.fixed_income,
                        req.fx,
                        base_usdinr=base_usdinr,
                        base_r3=base_r3,
                        carry=carry,
                        short_rate_shock_bps=scen.short_rate_shock_bps,
                        long_rate_shock_bps=r_s,
                        fx_spot_shock_pct=fx_s,
                    )
                )
            long_grid.append(row)

    model = MacroGridResponse(
        run_id=None,
        asof_date=asof,
        base_usdinr=base_usdinr,
        base_rate_3m_pct=base_r3,
        base_rate_10y_pct=base_y10,
        fx_spot_shocks_pct=fx_shocks,
        short_rate_shocks_bps=short_shocks or None,
        short_rate_grid_pnl=short_grid,
        long_rate_shocks_bps=long_shocks or None,
        long_rate_grid_pnl=long_grid,
    )

    # CSV (wide) – whichever grid exists (prefer long, else short)
    buf = io.StringIO()
    w = csv.writer(buf)
    if long_grid and long_shocks:
        w.writerow(["fx_shock_pct"] + [f"long_rate_{x:.2f}_bps" for x in long_shocks])
        for i, fx_s in enumerate(fx_shocks):
            w.writerow([fx_s] + [f"{v:.6f}" for v in long_grid[i]])
    elif short_grid and short_shocks:
        w.writerow(["fx_shock_pct"] + [f"short_rate_{x:.2f}_bps" for x in short_shocks])
        for i, fx_s in enumerate(fx_shocks):
            w.writerow([fx_s] + [f"{v:.6f}" for v in short_grid[i]])
    csv_text = buf.getvalue()

    return model, csv_text



def analyze_compare(req: MacroCompareRequest) -> tuple[MacroCompareResponse, str]:
    """Compute multiple scenarios on the same base snapshot (side-by-side compare).

    Returns (result_model, result_csv).
    """

    asof, base_usdinr, base_r3, base_y10 = get_base_snapshot(req)
    carry: MacroCarryInputs = req.carry

    items: list[MacroCompareItem] = []

    # For downloads / easy copy-paste
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["scenario", "label", "kind", "pnl_inr"])

    for named in req.scenarios:
        scen: MacroScenario = named.scenario

        results: list[MacroPositionResult] = []
        total_pnl = 0.0

        for pos in req.fixed_income:
            shock_bps = scen.short_rate_shock_bps if pos.rate_bucket == "short" else scen.long_rate_shock_bps
            pnl, details = _fixed_income_leg(pos, shock_bps=shock_bps)
            results.append(MacroPositionResult(label=pos.label, kind="fixed_income", pnl_inr=pnl, details=details))
            total_pnl += pnl
            w.writerow([named.name, pos.label, "fixed_income", f"{pnl:.6f}"])

        for pos in req.fx:
            pnl, details = _fx_leg(
                pos,
                base_usdinr=base_usdinr,
                fx_shock_pct=scen.fx_spot_shock_pct,
                carry=carry,
                base_rate_3m_pct=base_r3,
                short_rate_shock_bps=scen.short_rate_shock_bps,
            )
            results.append(MacroPositionResult(label=pos.label, kind="fx", pnl_inr=pnl, details=details))
            total_pnl += pnl
            w.writerow([named.name, pos.label, "fx", f"{pnl:.6f}"])

        # Total row
        w.writerow([named.name, "TOTAL", "", f"{total_pnl:.6f}"])

        items.append(
            MacroCompareItem(
                name=named.name,
                scenario=scen,
                carry=carry,
                positions=results,
                total_pnl_inr=total_pnl,
            )
        )

    model = MacroCompareResponse(
        run_id=None,
        asof_date=asof,
        base_usdinr=base_usdinr,
        base_rate_3m_pct=base_r3,
        base_rate_10y_pct=base_y10,
        items=items,
    )

    return model, buf.getvalue()
