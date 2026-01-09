from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator


# Keep these string values stable; the frontend persists them in Runs.
AssetType = Literal[
    # Capital gains
    "listed_equity_stt",  # STT-paid listed equity / equity-oriented fund / listed business trust
    "listed_security_other",  # other listed security (e.g., listed bond/ETF) - NOT equity-oriented
    "land_building",  # immovable property (land/building)
    "other_capital_asset",  # generic (typically unlisted / non-listed) capital asset

    # Deemed short-term under section 50AA
    "specified_mutual_fund_50aa",
    "market_linked_debenture_50aa",
    "unlisted_bond_debenture_50aa",

    # Virtual digital assets
    "virtual_digital_asset",
]


class TaxComputeRequest(BaseModel):
    """Compute Indian tax impact for a single realization (sale / redemption / maturity).

    All monetary amounts are in INR.

    We intentionally keep this model transaction-like (one asset, one sale event)
    so the UI can later add a batch importer or portfolio-level tax view without
    breaking this API.
    """

    asset_type: AssetType

    acquired_date: date = Field(..., description="Date of acquisition / purchase")
    sold_date: date = Field(..., description="Date of sale / transfer / redemption")

    purchase_value: float = Field(..., gt=0, description="Cost of acquisition (INR)")
    sale_value: float = Field(..., gt=0, description="Full value of consideration (INR)")

    transfer_expenses: float = Field(
        default=0.0,
        ge=0.0,
        description="Expenses wholly & exclusively in connection with transfer (INR)",
    )

    # Section 111A/112A eligibility input
    stt_paid: bool = Field(
        default=True,
        description="For STT-eligible equity/business-trust/equity-fund transactions",
    )

    # Section 112A grandfathering (only when acquired before 1 Feb 2018)
    fmv_31jan2018: float | None = Field(
        default=None,
        gt=0,
        description="Fair market value on 31-Jan-2018 (INR). Required only for grandfathering.",
    )

    # Section 112A exemption is on *aggregate* LTCG under 112A.
    other_112a_ltcg_in_same_fy: float = Field(
        default=0.0,
        ge=0.0,
        description="Other LTCG already realized under section 112A in the same FY (INR)",
    )

    # Optional: let users apply remaining basic-exemption (resident individuals/HUF) against LTCG.
    basic_exemption_remaining: float = Field(
        default=0.0,
        ge=0.0,
        description="Remaining basic exemption that can reduce taxable LTCG (INR)",
    )

    # Slab-based categories (e.g., section 50AA deemed STCG). We don't compute full slab tax; user supplies marginal rate.
    marginal_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=0.60,
        description="Marginal tax rate as decimal (e.g., 0.30 for 30%). Used for slab-taxed gains.",
    )

    # Surcharge & cess (kept explicit; rates can vary by FY and income levels)
    surcharge_rate: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Surcharge rate as decimal (e.g., 0.10 for 10%)",
    )
    cess_rate: float = Field(
        default=0.04,
        ge=0.0,
        le=0.10,
        description="Cess rate as decimal (default 0.04)",
    )

    # Property specifics
    improvement_cost: float = Field(
        default=0.0,
        ge=0.0,
        description="Cost of improvement (INR) - optional; used for property indexation comparison",
    )
    improvement_date: date | None = Field(
        default=None,
        description="Date of improvement spend (optional). If omitted, we assume same FY as acquisition.",
    )
    resident_individual_or_huf: bool = Field(
        default=True,
        description="Needed for the land/building grandfathering comparison in section 112 proviso",
    )

    @model_validator(mode="after")
    def _validate_dates(self) -> "TaxComputeRequest":
        if self.sold_date <= self.acquired_date:
            raise ValueError("sold_date must be after acquired_date")
        if self.improvement_cost > 0 and self.improvement_date is not None:
            if self.improvement_date < self.acquired_date:
                raise ValueError("improvement_date cannot be before acquired_date")
            if self.improvement_date > self.sold_date:
                raise ValueError("improvement_date cannot be after sold_date")
        return self


class TaxScenarioRow(BaseModel):
    label: str
    sale_value: float
    gain: float
    total_tax: float
    post_tax_proceeds: float


class TaxComputeResponse(BaseModel):
    run_id: str

    asset_type: AssetType
    holding_days: int
    holding_period_rule: str
    classification: str

    gain: float
    taxable_gain: float

    base_rate: float
    base_tax: float
    surcharge_rate: float
    surcharge: float
    cess_rate: float
    cess: float
    total_tax: float

    post_tax_proceeds: float

    methodology: str
    notes: list[str]

    scenario_rows: list[TaxScenarioRow]

    # Optional “planner” outputs
    earliest_ltcg_date: date | None = None
    tax_if_sold_on_earliest_ltcg_date: float | None = None
    tax_saving_if_wait: float | None = None
