from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable

from app.schemas.tax import AssetType, TaxComputeRequest, TaxComputeResponse, TaxScenarioRow


# ----------------------------
# India tax logic (high-level)
# ----------------------------
#
# We intentionally implement a pragmatic subset of the Indian capital-gains rules,
# with explicit knobs for surcharge/cess and for user-supplied marginal slab rate.
#
# Key statutory references used in this implementation (see UI tooltips too):
# - Section 2(42A): holding-period definition (12/24 months from 23-Jul-2024)
# - Section 111A: STCG on STT-paid equity etc (15% pre-23-Jul-2024, 20% on/after)
# - Section 112A: LTCG on STT-paid equity etc (10% pre-23-Jul-2024, 12.5% on/after)
# - Section 112: other LTCG (20% pre-23-Jul-2024, 12.5% on/after; special proviso for land/building)
# - Section 48 (second proviso): indexation is available only for transfers before 23-Jul-2024
# - Section 50AA: deemed STCG for specified MF/MLD; expanded to unlisted bonds/debentures on/after 23-Jul-2024
# - Section 115BBH: tax on virtual digital assets (30%)


EFFECTIVE_DATE_CAP_GAINS_REFORM = date(2024, 7, 23)
EQUITY_GRANDFATHERING_CUTOFF = date(2018, 2, 1)


# Cost Inflation Index (CII) table (base year 2001-02 = 100)
# Source: Income Tax Dept. "Cost Inflation Index" table (Notification 70/2025).
CII_BY_FY_START: dict[int, int] = {
    2001: 100,
    2002: 105,
    2003: 109,
    2004: 113,
    2005: 117,
    2006: 122,
    2007: 129,
    2008: 137,
    2009: 148,
    2010: 167,
    2011: 184,
    2012: 200,
    2013: 220,
    2014: 240,
    2015: 254,
    2016: 264,
    2017: 272,
    2018: 280,
    2019: 289,
    2020: 301,
    2021: 317,
    2022: 331,
    2023: 348,
    2024: 363,
    2025: 376,
}


@dataclass(frozen=True)
class _TaxCore:
    classification: str
    holding_days: int
    holding_period_rule: str
    taxable_gain: float
    base_rate: float
    methodology: str
    notes: list[str]
    # Optional planner info
    earliest_ltcg_date: date | None = None


def _fy_start(d: date) -> int:
    """Indian financial year start (FY runs Apr 1 -> Mar 31)."""

    return d.year if d.month >= 4 else d.year - 1


def _cii_for_date(d: date) -> int | None:
    return CII_BY_FY_START.get(_fy_start(d))


def _last_day_of_month(year: int, month: int) -> int:
    # month: 1..12
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    return (next_month - timedelta(days=1)).day


def _add_months(d: date, months: int) -> date:
    """Add calendar months, clamping day to month-end."""

    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    day = min(d.day, _last_day_of_month(y, m))
    return date(y, m, day)


def _is_long_term(acquired: date, sold: date, months_threshold: int) -> bool:
    # As per definition: short-term if held for "not more than" threshold months.
    # So long-term iff held for strictly more than threshold months.
    return sold > _add_months(acquired, months_threshold)


def _apply_surcharge_cess(base_tax: float, surcharge_rate: float, cess_rate: float) -> tuple[float, float, float]:
    surcharge = base_tax * max(0.0, surcharge_rate)
    cess = (base_tax + surcharge) * max(0.0, cess_rate)
    total = base_tax + surcharge + cess
    return surcharge, cess, total


def _grandfathered_cost_112a(actual_cost: float, fmv_31jan2018: float, sale_value: float) -> float:
    """Section 55 grandfathering formula for 112A assets acquired before 1 Feb 2018."""

    # higher of: actual cost, lower of: FMV on 31-Jan-2018 and sale consideration
    return max(actual_cost, min(fmv_31jan2018, sale_value))


def _compute_core(req: TaxComputeRequest, sale_value_override: float | None = None) -> _TaxCore:
    """Compute classification + taxable_gain + base_rate (no surcharge/cess)."""

    sale_value = float(sale_value_override) if sale_value_override is not None else float(req.sale_value)
    purchase_value = float(req.purchase_value)
    expenses = float(req.transfer_expenses)

    # Helpers
    notes: list[str] = []
    sold = req.sold_date
    acquired = req.acquired_date
    holding_days = (sold - acquired).days

    def slab_rate_or_default() -> float:
        if req.marginal_rate is None:
            notes.append("Marginal rate not provided; using 30% as a placeholder.")
            return 0.30
        return float(req.marginal_rate)

    # --- Virtual Digital Asset (115BBH) ---
    if req.asset_type == "virtual_digital_asset":
        # Per 115BBH: no deduction other than cost of acquisition. So ignore transfer expenses.
        gain = sale_value - purchase_value
        taxable_gain = max(0.0, gain)
        base_rate = 0.30
        classification = "VDA (115BBH)"
        holding_rule = "Special rate; holding period not used"
        methodology = "Section 115BBH: 30% tax on gains; no deductions other than cost (expenses ignored)."
        if expenses > 0:
            notes.append("Transfer expenses are not deducted for VDA under section 115BBH (we ignore them).")
        if gain < 0:
            notes.append("Loss set-off rules for VDA are restrictive; this calculator shows tax as 0 on negative gains.")
        return _TaxCore(
            classification=classification,
            holding_days=holding_days,
            holding_period_rule=holding_rule,
            taxable_gain=taxable_gain,
            base_rate=base_rate,
            methodology=methodology,
            notes=notes,
        )

    # --- Deemed STCG under section 50AA ---
    if req.asset_type in {
        "specified_mutual_fund_50aa",
        "market_linked_debenture_50aa",
        "unlisted_bond_debenture_50aa",
    }:
        gain = sale_value - purchase_value - expenses
        taxable_gain = max(0.0, gain)
        base_rate = slab_rate_or_default()
        classification = "Deemed STCG (50AA)"
        holding_rule = "Always short-term under section 50AA"
        methodology = "Section 50AA: gains deemed STCG; taxed at applicable slab/marginal rate (user input)."

        if req.asset_type == "unlisted_bond_debenture_50aa" and sold < EFFECTIVE_DATE_CAP_GAINS_REFORM:
            notes.append(
                "This category is treated as deemed STCG in 50AA only for transfers on/after 23-Jul-2024. "
                "For earlier transfers, pick 'other_capital_asset' and use holding period rules."
            )

        return _TaxCore(
            classification=classification,
            holding_days=holding_days,
            holding_period_rule=holding_rule,
            taxable_gain=taxable_gain,
            base_rate=base_rate,
            methodology=methodology,
            notes=notes,
        )

    # --- Listed equity / equity-oriented fund / business trust with STT (111A/112A) ---
    if req.asset_type == "listed_equity_stt":
        if not req.stt_paid:
            notes.append(
                "STT not marked as paid. 111A/112A concessional rates may not apply; using general capital gains rules."
            )
            # Fall through to general rules, treating it like a listed security.
            # (We keep the same UI inputs, but compute under section 112.)
            req_asset_type = "listed_security_other"
        else:
            req_asset_type = "listed_equity_stt"

        if req_asset_type == "listed_equity_stt":
            is_lt = _is_long_term(acquired, sold, 12)
            holding_rule = "Section 2(42A): equity/EO fund/business trust is long-term if held > 12 months"
            earliest_ltcg_date = _add_months(acquired, 12) + timedelta(days=1)

            # Compute gain with possible grandfathering
            cost_basis = purchase_value
            if acquired < EQUITY_GRANDFATHERING_CUTOFF:
                if req.fmv_31jan2018 is None:
                    notes.append(
                        "Acquired before 1-Feb-2018: provide FMV on 31-Jan-2018 to apply 112A grandfathering. "
                        "Using actual purchase value as cost basis."
                    )
                else:
                    cost_basis = _grandfathered_cost_112a(purchase_value, float(req.fmv_31jan2018), sale_value)
                    notes.append("112A grandfathering applied to cost basis (using 31-Jan-2018 FMV).")

            gain = sale_value - cost_basis - expenses

            if not is_lt:
                # STCG (111A)
                taxable_gain = max(0.0, gain)
                base_rate = 0.15 if sold < EFFECTIVE_DATE_CAP_GAINS_REFORM else 0.20
                classification = "STCG (111A)"
                methodology = "Section 111A: STT-paid equity/EO funds; rate 15% before 23-Jul-2024, else 20%."

                return _TaxCore(
                    classification=classification,
                    holding_days=holding_days,
                    holding_period_rule=holding_rule,
                    taxable_gain=taxable_gain,
                    base_rate=base_rate,
                    methodology=methodology,
                    notes=notes,
                    earliest_ltcg_date=earliest_ltcg_date,
                )

            # LTCG (112A)
            exemption = 100000.0 if sold < EFFECTIVE_DATE_CAP_GAINS_REFORM else 125000.0
            # Exemption is on aggregate 112A gains; allow user to account for already-used portion.
            remaining = max(0.0, exemption - float(req.other_112a_ltcg_in_same_fy))
            taxable_gain = max(0.0, max(0.0, gain) - remaining)

            # Optional: apply remaining basic exemption (resident individuals/HUF)
            if req.basic_exemption_remaining > 0:
                taxable_gain = max(0.0, taxable_gain - float(req.basic_exemption_remaining))
                notes.append("Applied basic exemption remaining against taxable LTCG (user-provided).")

            base_rate = 0.10 if sold < EFFECTIVE_DATE_CAP_GAINS_REFORM else 0.125
            classification = "LTCG (112A)"
            methodology = (
                "Section 112A: STT-paid equity/EO funds/business trust; exemption up to ₹1.25L (post 23-Jul-2024); "
                "rate 12.5% (post 23-Jul-2024)."
            )

            if gain <= 0:
                notes.append("No tax on negative/zero gains (but check set-off rules separately).")
            if remaining < exemption:
                notes.append(
                    f"112A exemption remaining in this FY: ₹{remaining:,.0f} (based on your input)."
                )

            return _TaxCore(
                classification=classification,
                holding_days=holding_days,
                holding_period_rule=holding_rule,
                taxable_gain=taxable_gain,
                base_rate=base_rate,
                methodology=methodology,
                notes=notes,
                earliest_ltcg_date=earliest_ltcg_date,
            )

    # --- Listed security (non-equity) ---
    if req.asset_type == "listed_security_other":
        # Under section 2(42A) first proviso: listed securities (including units post 23-Jul-2024) are 12-month.
        is_lt = _is_long_term(acquired, sold, 12)
        holding_rule = "Section 2(42A): listed securities long-term if held > 12 months"
        earliest_ltcg_date = _add_months(acquired, 12) + timedelta(days=1)

        gain = sale_value - purchase_value - expenses
        if not is_lt:
            taxable_gain = max(0.0, gain)
            base_rate = slab_rate_or_default()
            classification = "STCG (slab)"
            methodology = "General rule: short-term gains taxed at slab/marginal rate (user input)."
            return _TaxCore(
                classification=classification,
                holding_days=holding_days,
                holding_period_rule=holding_rule,
                taxable_gain=taxable_gain,
                base_rate=base_rate,
                methodology=methodology,
                notes=notes,
                earliest_ltcg_date=earliest_ltcg_date,
            )

        taxable_gain = max(0.0, gain)
        base_rate = 0.20 if sold < EFFECTIVE_DATE_CAP_GAINS_REFORM else 0.125
        classification = "LTCG (112)"
        methodology = "Section 112: non-112A long-term capital gains; 20% pre-23-Jul-2024, 12.5% on/after."
        return _TaxCore(
            classification=classification,
            holding_days=holding_days,
            holding_period_rule=holding_rule,
            taxable_gain=taxable_gain,
            base_rate=base_rate,
            methodology=methodology,
            notes=notes,
            earliest_ltcg_date=earliest_ltcg_date,
        )

    # --- Land/building ---
    if req.asset_type == "land_building":
        is_lt = _is_long_term(acquired, sold, 24)
        holding_rule = "Section 2(42A): land/building long-term if held > 24 months"
        earliest_ltcg_date = _add_months(acquired, 24) + timedelta(days=1)

        gain = sale_value - purchase_value - float(req.improvement_cost) - expenses
        if not is_lt:
            taxable_gain = max(0.0, gain)
            base_rate = slab_rate_or_default()
            classification = "STCG (slab)"
            methodology = "Immovable property STCG taxed at slab/marginal rate (user input)."
            return _TaxCore(
                classification=classification,
                holding_days=holding_days,
                holding_period_rule=holding_rule,
                taxable_gain=taxable_gain,
                base_rate=base_rate,
                methodology=methodology,
                notes=notes,
                earliest_ltcg_date=earliest_ltcg_date,
            )

        # LTCG: base rate depends on transfer date.
        if sold < EFFECTIVE_DATE_CAP_GAINS_REFORM:
            taxable_gain = max(0.0, gain)
            base_rate = 0.20
            classification = "LTCG (112)"
            methodology = "Section 112 (pre 23-Jul-2024): LTCG on land/building at 20% (indexation may apply)."
            notes.append("Transfer is before 23-Jul-2024; indexation rules may apply (not fully modeled here).")
            return _TaxCore(
                classification=classification,
                holding_days=holding_days,
                holding_period_rule=holding_rule,
                taxable_gain=taxable_gain,
                base_rate=base_rate,
                methodology=methodology,
                notes=notes,
                earliest_ltcg_date=earliest_ltcg_date,
            )

        # Post 23-Jul-2024: 12.5% without indexation. But for assets acquired before 23-Jul-2024,
        # resident individuals/HUF can compare and ignore excess if old-method tax is lower.
        taxable_gain_new = max(0.0, gain)
        tax_new = taxable_gain_new * 0.125

        # Compute old-method tax (20% with indexation) if eligible.
        use_comparison = req.resident_individual_or_huf and acquired < EFFECTIVE_DATE_CAP_GAINS_REFORM
        if use_comparison:
            cii_acq = _cii_for_date(acquired)
            cii_sale = _cii_for_date(sold)
            imp_date = req.improvement_date or acquired
            cii_imp = _cii_for_date(imp_date)
            if cii_acq is None or cii_sale is None or cii_imp is None:
                notes.append("CII not found for one of the dates; cannot compute indexation comparison.")
            else:
                indexed_cost = purchase_value * (cii_sale / cii_acq)
                indexed_impr = float(req.improvement_cost) * (cii_sale / cii_imp)
                gain_old = sale_value - indexed_cost - indexed_impr - expenses
                taxable_gain_old = max(0.0, gain_old)
                tax_old = taxable_gain_old * 0.20

                if tax_old < tax_new:
                    notes.append(
                        "Applied land/building grandfathering comparison: 20% with indexation yields lower tax than 12.5% without."
                    )
                    # Convert old-tax back into an equivalent base_rate for reporting.
                    # We'll keep base_rate as 0.20 but taxable_gain as taxable_gain_old.
                    return _TaxCore(
                        classification="LTCG (112)",
                        holding_days=holding_days,
                        holding_period_rule=holding_rule,
                        taxable_gain=taxable_gain_old,
                        base_rate=0.20,
                        methodology=(
                            "Section 112 (proviso for land/building acquired before 23-Jul-2024): use lower of "
                            "(12.5% without indexation) vs (20% with indexation) for resident individuals/HUF."
                        ),
                        notes=notes,
                        earliest_ltcg_date=earliest_ltcg_date,
                    )
                notes.append(
                    "Land/building comparison computed: 12.5% without indexation is not higher than indexed 20%; using 12.5%."
                )

        classification = "LTCG (112)"
        methodology = "Section 112: LTCG on/after 23-Jul-2024 at 12.5% (indexation generally removed)."
        return _TaxCore(
            classification=classification,
            holding_days=holding_days,
            holding_period_rule=holding_rule,
            taxable_gain=taxable_gain_new,
            base_rate=0.125,
            methodology=methodology,
            notes=notes,
            earliest_ltcg_date=earliest_ltcg_date,
        )

    # --- Other capital asset (generic) ---
    if req.asset_type == "other_capital_asset":
        is_lt = _is_long_term(acquired, sold, 24)
        holding_rule = "Section 2(42A): long-term if held > 24 months (general rule)"
        earliest_ltcg_date = _add_months(acquired, 24) + timedelta(days=1)

        gain = sale_value - purchase_value - expenses
        if not is_lt:
            taxable_gain = max(0.0, gain)
            base_rate = slab_rate_or_default()
            classification = "STCG (slab)"
            methodology = "General rule: STCG taxed at slab/marginal rate (user input)."
            return _TaxCore(
                classification=classification,
                holding_days=holding_days,
                holding_period_rule=holding_rule,
                taxable_gain=taxable_gain,
                base_rate=base_rate,
                methodology=methodology,
                notes=notes,
                earliest_ltcg_date=earliest_ltcg_date,
            )

        taxable_gain = max(0.0, gain)
        base_rate = 0.20 if sold < EFFECTIVE_DATE_CAP_GAINS_REFORM else 0.125
        classification = "LTCG (112)"
        methodology = "Section 112: LTCG taxed at 20% pre-23-Jul-2024, 12.5% on/after (indexation generally removed)."
        return _TaxCore(
            classification=classification,
            holding_days=holding_days,
            holding_period_rule=holding_rule,
            taxable_gain=taxable_gain,
            base_rate=base_rate,
            methodology=methodology,
            notes=notes,
            earliest_ltcg_date=earliest_ltcg_date,
        )

    # Should not happen (schema constrains), but keep safe.
    gain = sale_value - purchase_value - expenses
    return _TaxCore(
        classification="Unknown",
        holding_days=holding_days,
        holding_period_rule="Unknown",
        taxable_gain=max(0.0, gain),
        base_rate=slab_rate_or_default(),
        methodology="Unknown",
        notes=notes,
    )


def compute_tax(req: TaxComputeRequest, run_id: str) -> TaxComputeResponse:
    """Public entrypoint used by the API route."""

    core = _compute_core(req)

    # Gain (reported) is computed from request values (not taxable-gain), consistent with UI.
    # For some categories (112A grandfathering, VDA expenses), the taxable base differs.
    gross_gain = req.sale_value - req.purchase_value - req.transfer_expenses
    if req.asset_type == "virtual_digital_asset":
        gross_gain = req.sale_value - req.purchase_value

    base_tax = max(0.0, core.taxable_gain) * max(0.0, core.base_rate)
    surcharge, cess, total = _apply_surcharge_cess(base_tax, req.surcharge_rate, req.cess_rate)
    post_tax_proceeds = req.sale_value - total

    # Scenario analysis (sale value shifts)
    scenario_rows: list[TaxScenarioRow] = []
    for shift in (-0.10, -0.05, 0.0, 0.05, 0.10):
        sv = max(0.01, req.sale_value * (1.0 + shift))
        core_s = _compute_core(req, sale_value_override=sv)
        base_tax_s = max(0.0, core_s.taxable_gain) * max(0.0, core_s.base_rate)
        surcharge_s, cess_s, total_s = _apply_surcharge_cess(base_tax_s, req.surcharge_rate, req.cess_rate)
        gross_gain_s = sv - req.purchase_value - req.transfer_expenses
        if req.asset_type == "virtual_digital_asset":
            gross_gain_s = sv - req.purchase_value
        scenario_rows.append(
            TaxScenarioRow(
                label=f"{int(shift*100):+d}%",
                sale_value=sv,
                gain=gross_gain_s,
                total_tax=total_s,
                post_tax_proceeds=sv - total_s,
            )
        )

    # Planner: if the current classification is short-term and a natural LTCG threshold exists,
    # compute a "wait until" estimate using the same sale value.
    earliest = core.earliest_ltcg_date
    tax_if_wait = None
    tax_saving = None
    if earliest is not None and req.sold_date < earliest:
        # Construct a synthetic request with sold_date=earliest
        req2 = req.model_copy(update={"sold_date": earliest})
        core2 = _compute_core(req2)
        base_tax2 = max(0.0, core2.taxable_gain) * max(0.0, core2.base_rate)
        _, _, total2 = _apply_surcharge_cess(base_tax2, req.surcharge_rate, req.cess_rate)
        tax_if_wait = total2
        tax_saving = max(0.0, total - total2)

    # Notes: add a general disclaimer note (UI also has a disclaimer block).
    notes = list(core.notes)
    notes.append(
        "Tax rules change over time; this tool is for estimation and learning. For filing, verify with the Act/notifications or a professional."
    )

    return TaxComputeResponse(
        run_id=run_id,
        asset_type=req.asset_type,
        holding_days=core.holding_days,
        holding_period_rule=core.holding_period_rule,
        classification=core.classification,
        gain=gross_gain,
        taxable_gain=core.taxable_gain,
        base_rate=core.base_rate,
        base_tax=base_tax,
        surcharge_rate=req.surcharge_rate,
        surcharge=surcharge,
        cess_rate=req.cess_rate,
        cess=cess,
        total_tax=total,
        post_tax_proceeds=post_tax_proceeds,
        methodology=core.methodology,
        notes=notes,
        scenario_rows=scenario_rows,
        earliest_ltcg_date=earliest,
        tax_if_sold_on_earliest_ltcg_date=tax_if_wait,
        tax_saving_if_wait=tax_saving,
    )
