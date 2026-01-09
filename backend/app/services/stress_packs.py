from __future__ import annotations

"""Built-in stress packs for the macro scenario module.

These are intentionally opinionated, short, and easy to extend.

A stress pack is just a named set of shocks (rate + FX), expressed as:
- rates in basis points
- FX in percent

The library complements user-saved packs stored in the database.
"""

from app.schemas.macro import MacroScenario, StressPack


def builtin_stress_packs() -> list[StressPack]:
    # NOTE: You can add more packs later; keep them small and interpretable.
    packs = [
        StressPack(
            pack_id="builtin:inflation_spike",
            name="Inflation spike + long-end selloff + INR risk-off",
            description=(
                "Higher inflation expectations push long-end yields up; risk-off sentiment drives INR depreciation. "
                "Short-end moves less (policy responds with a lag)."
            ),
            tags=["inflation", "rates", "fx", "risk-off"],
            scenario=MacroScenario(short_rate_shock_bps=25.0, long_rate_shock_bps=150.0, fx_spot_shock_pct=3.0, inflation_shock_pp=1.0),
            is_builtin=True,
            owner_user_id=None,
        ),
        StressPack(
            pack_id="builtin:rbi_easing",
            name="RBI easing + curve bull-steepener + INR risk-on",
            description=(
                "Policy easing lowers short rates; long end rallies less. INR typically strengthens modestly in risk-on."
            ),
            tags=["policy", "rates", "fx", "risk-on"],
            scenario=MacroScenario(short_rate_shock_bps=-75.0, long_rate_shock_bps=-25.0, fx_spot_shock_pct=-1.5, inflation_shock_pp=-0.5),
            is_builtin=True,
            owner_user_id=None,
        ),
        StressPack(
            pack_id="builtin:oil_shock",
            name="Oil shock + INR selloff + front-end repricing",
            description=(
                "Import inflation via oil can pressure INR; short-end reprices funding/expectations more than long end."
            ),
            tags=["oil", "inflation", "fx"],
            scenario=MacroScenario(short_rate_shock_bps=60.0, long_rate_shock_bps=30.0, fx_spot_shock_pct=4.0, inflation_shock_pp=1.5),
            is_builtin=True,
            owner_user_id=None,
        ),
        StressPack(
            pack_id="builtin:curve_steepener",
            name="Curve steepener (long-end selloff)",
            description="Long-end yields rise more than the short end (bear-steepener).",
            tags=["rates", "curve"],
            scenario=MacroScenario(short_rate_shock_bps=10.0, long_rate_shock_bps=100.0, fx_spot_shock_pct=0.0, inflation_shock_pp=0.0),
            is_builtin=True,
            owner_user_id=None,
        ),
        StressPack(
            pack_id="builtin:curve_flattener",
            name="Curve flattener (long-end rally)",
            description="Long-end yields fall more than the short end (bull-flattener).",
            tags=["rates", "curve"],
            scenario=MacroScenario(short_rate_shock_bps=-25.0, long_rate_shock_bps=-125.0, fx_spot_shock_pct=0.0, inflation_shock_pp=0.0),
            is_builtin=True,
            owner_user_id=None,
        ),
    ]

    return packs
