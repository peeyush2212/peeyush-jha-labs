from __future__ import annotations

import math
from typing import Iterable, Sequence

import numpy as np

from app.schemas.capbud import (
    CapBudCashflowTable,
    CapBudComputeRequest,
    CapBudComputeResponse,
    CapBudProfile,
    CapBudSensitivity,
)


def _npv(cashflows: Sequence[float], r: float, *, mid_year: bool = False) -> float:
    """Net present value.

    mid_year=True applies the mid-year convention (cashflows occur in the middle
    of each year, except t=0).
    """

    if r <= -1.0:
        # Avoid division by zero / sign flips.
        raise ValueError("discount_rate must be > -1")

    total = 0.0
    for t, cf in enumerate(cashflows):
        if t == 0:
            total += float(cf)
            continue
        exp = t - 0.5 if mid_year else t
        total += float(cf) / ((1.0 + r) ** exp)
    return float(total)


def _discount_series(cashflows: Sequence[float], r: float, *, mid_year: bool = False) -> list[float]:
    out: list[float] = []
    for t, cf in enumerate(cashflows):
        if t == 0:
            out.append(float(cf))
        else:
            exp = t - 0.5 if mid_year else t
            out.append(float(cf) / ((1.0 + r) ** exp))
    return out


def _cumulative(xs: Iterable[float]) -> list[float]:
    s = 0.0
    out: list[float] = []
    for x in xs:
        s += float(x)
        out.append(float(s))
    return out


def _sign_changes(cashflows: Sequence[float]) -> int:
    """Count sign changes ignoring zeros."""

    cleaned: list[int] = []
    for cf in cashflows:
        v = float(cf)
        if abs(v) < 1e-12:
            continue
        cleaned.append(1 if v > 0 else -1)

    if len(cleaned) < 2:
        return 0
    changes = 0
    for a, b in zip(cleaned, cleaned[1:]):
        if a != b:
            changes += 1
    return changes


def _irr_candidates(cashflows: Sequence[float]) -> list[float]:
    """Compute IRR candidates via polynomial roots.

    For x = 1 + r, solve: sum_{t=0..n} CF_t * x^{n-t} = 0.
    Return real roots with x>0 mapped to r=x-1.
    """

    cfs = np.array([float(x) for x in cashflows], dtype=float)
    n = len(cfs) - 1
    if n < 1:
        return []

    # All-zero coefficients -> no roots.
    if np.all(np.abs(cfs) < 1e-18):
        return []

    roots = np.roots(cfs)
    out: list[float] = []
    for z in roots:
        if abs(z.imag) > 1e-8:
            continue
        x = float(z.real)
        if x <= 0.0:
            continue
        r = x - 1.0
        # Exclude nonsensical values.
        if r <= -0.999999:
            continue
        out.append(float(r))

    # Sort and de-dupe (roots can be near-identical)
    out.sort()
    deduped: list[float] = []
    for r in out:
        if not deduped or abs(r - deduped[-1]) > 1e-6:
            deduped.append(r)
    return deduped


def _mirr(cashflows: Sequence[float], finance_rate: float, reinvest_rate: float) -> float | None:
    n = len(cashflows) - 1
    if n <= 0:
        return None

    pv_neg = 0.0
    fv_pos = 0.0
    for t, cf in enumerate(cashflows):
        cf = float(cf)
        if cf < 0:
            pv_neg += cf / ((1.0 + finance_rate) ** t)
        elif cf > 0:
            fv_pos += cf * ((1.0 + reinvest_rate) ** (n - t))

    if abs(pv_neg) < 1e-18 or abs(fv_pos) < 1e-18:
        return None

    try:
        return float((fv_pos / (-pv_neg)) ** (1.0 / n) - 1.0)
    except Exception:
        return None


def _payback(cashflows: Sequence[float]) -> float | None:
    """Simple payback period (supports fractional year)."""

    cum = 0.0
    for t, cf in enumerate(cashflows):
        cf = float(cf)
        prev = cum
        cum += cf
        if cum >= 0:
            if t == 0:
                return 0.0
            if abs(cf) < 1e-18:
                return float(t)
            # Linear interpolation inside the year.
            frac = (-prev) / cf
            return float((t - 1) + frac)
    return None


def compute_capbud(req: CapBudComputeRequest, *, run_id: str) -> CapBudComputeResponse:
    mid_year = req.convention == "mid_year"
    cashflows = [float(x) for x in req.cashflows]
    r = float(req.discount_rate)

    notes: list[str] = []
    if mid_year:
        notes.append("Mid-year convention: t>=1 cashflows discounted at (t-0.5) years.")

    # Core metrics
    npv_val = _npv(cashflows, r, mid_year=mid_year)

    # IRR
    sc = _sign_changes(cashflows)
    irr_candidates = _irr_candidates(cashflows)
    irr_val: float | None = None
    irr_warning: str | None = None

    if sc > 1:
        irr_warning = "Non-conventional cashflows (multiple sign changes): IRR may be non-unique."
    if irr_candidates:
        # Pick the candidate that minimizes |NPV| (robust selection when multiple exist).
        best = min(irr_candidates, key=lambda x: abs(_npv(cashflows, x, mid_year=mid_year)))
        irr_val = float(best)
        if len(irr_candidates) > 1 and not irr_warning:
            irr_warning = "Multiple IRR candidates detected; showing the closest-to-zero NPV root."
    else:
        irr_val = None
        if sc == 0:
            irr_warning = "IRR undefined: cashflows do not change sign."
        elif sc >= 1:
            irr_warning = "No real IRR found in (r > -100%)."

    if irr_warning:
        notes.append(irr_warning)

    # MIRR
    finance_rate = float(req.finance_rate) if req.finance_rate is not None else r
    reinvest_rate = float(req.reinvest_rate) if req.reinvest_rate is not None else r
    mirr_val = _mirr(cashflows, finance_rate=finance_rate, reinvest_rate=reinvest_rate)

    # Profitability index (standard definition assumes negative CF0)
    pi_val: float | None = None
    if cashflows[0] < 0:
        pv_future = _npv([0.0, *cashflows[1:]], r, mid_year=mid_year)
        pi_val = float(pv_future / (-cashflows[0])) if abs(cashflows[0]) > 1e-18 else None
    else:
        notes.append("Profitability Index is shown only when the initial cashflow (t=0) is negative.")

    # Payback periods
    payback = _payback(cashflows)
    discounted_cfs = _discount_series(cashflows, r, mid_year=mid_year)
    disc_payback = _payback(discounted_cfs)

    # Build cashflow table
    years = list(range(len(cashflows)))
    cum = _cumulative(cashflows)
    cum_disc = _cumulative(discounted_cfs)
    table = CapBudCashflowTable(
        years=years,
        cashflows=cashflows,
        discounted_cashflows=discounted_cfs,
        cumulative_cashflows=cum,
        cumulative_discounted_cashflows=cum_disc,
    )

    # NPV profile curve
    # Use a sensible range for interview demos (0%..max(30%, 2*discount_rate), capped at 100%).
    max_r = max(0.30, min(1.0, (abs(r) * 2.0) if abs(r) > 1e-9 else 0.30))
    # Use 1% increments for a smooth-ish curve without heavy payload.
    steps = int(round(max_r * 100))
    profile_rates = [i / 100.0 for i in range(0, steps + 1)]
    profile_npvs = [float(_npv(cashflows, rr, mid_year=mid_year)) for rr in profile_rates]
    profile = CapBudProfile(rates=profile_rates, npvs=profile_npvs)

    # Sensitivity grid (discount rate +/- 200 bps, cashflow scale +/- 10%)
    rate_shifts = [-0.02, -0.01, 0.0, 0.01, 0.02]
    scale_shifts = [-0.10, 0.0, 0.10]

    grid: list[list[float]] = []
    for sft in scale_shifts:
        scale = 1.0 + sft
        scaled = [cashflows[0], *[float(cf) * scale for cf in cashflows[1:]]]
        row: list[float] = []
        for dr in rate_shifts:
            rr = max(-0.99, r + dr)
            row.append(float(_npv(scaled, rr, mid_year=mid_year)))
        grid.append(row)

    sens = CapBudSensitivity(rate_shifts=rate_shifts, scale_shifts=scale_shifts, npv_grid=grid)

    # Decision line
    if npv_val > 0:
        decision = "ACCEPT: NPV is positive at the hurdle rate."
    elif npv_val < 0:
        decision = "REJECT: NPV is negative at the hurdle rate."
    else:
        decision = "INDIFFERENT: NPV is approximately zero at the hurdle rate."

    if irr_val is not None:
        decision += f" IRR ≈ {irr_val * 100:.2f}% vs hurdle {r * 100:.2f}%."

    return CapBudComputeResponse(
        run_id=run_id,
        project_name=req.project_name,
        currency=req.currency,
        discount_rate=r,
        convention=req.convention,
        npv=float(npv_val),
        irr=irr_val,
        irr_candidates=irr_candidates,
        irr_warning=irr_warning,
        mirr=mirr_val,
        profitability_index=pi_val,
        payback_period=payback,
        discounted_payback_period=disc_payback,
        cashflow_table=table,
        npv_profile=profile,
        sensitivity=sens,
        decision=decision,
        notes=notes,
    )
