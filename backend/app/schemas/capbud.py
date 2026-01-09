from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class CapBudProfile(BaseModel):
    """NPV profile curve (rate -> NPV)."""

    rates: list[float]
    npvs: list[float]


class CapBudSensitivity(BaseModel):
    """Two-way sensitivity grid for NPV."""

    # Shifts are expressed as decimals (e.g. +0.01 = +1%).
    rate_shifts: list[float]
    scale_shifts: list[float]
    # grid[row = scale_shifts][col = rate_shifts]
    npv_grid: list[list[float]]


class CapBudCashflowTable(BaseModel):
    years: list[int]
    cashflows: list[float]
    discounted_cashflows: list[float]
    cumulative_cashflows: list[float]
    cumulative_discounted_cashflows: list[float]


class CapBudComputeRequest(BaseModel):
    project_name: str = Field(default="Project", max_length=120)
    currency: str = Field(default="USD", max_length=12)

    # Annual discount rate as a decimal (e.g. 0.10 = 10%)
    discount_rate: float = Field(default=0.10, ge=-0.99, le=5.0)
    cashflows: list[float] = Field(description="Cashflows from t=0..N", min_length=2)

    # MIRR knobs (optional; default to discount_rate)
    finance_rate: float | None = Field(default=None, ge=-0.99, le=5.0)
    reinvest_rate: float | None = Field(default=None, ge=-0.99, le=5.0)

    convention: Literal["end_of_period", "mid_year"] = Field(default="end_of_period")

    @model_validator(mode="after")
    def _validate_cashflows(self) -> "CapBudComputeRequest":
        if len(self.cashflows) < 2:
            raise ValueError("cashflows must have at least 2 values (t=0 and t=1)")
        if len(self.cashflows) > 60:
            raise ValueError("cashflows length must be <= 60")
        if all((abs(float(x)) < 1e-12) for x in self.cashflows):
            raise ValueError("cashflows cannot be all zeros")
        return self


class CapBudComputeResponse(BaseModel):
    run_id: str
    run_type: str = "capbud.compute"

    project_name: str
    currency: str
    discount_rate: float
    convention: str

    npv: float
    irr: float | None
    irr_candidates: list[float] = Field(default_factory=list)
    irr_warning: str | None = None

    mirr: float | None
    profitability_index: float | None
    payback_period: float | None
    discounted_payback_period: float | None

    cashflow_table: CapBudCashflowTable
    npv_profile: CapBudProfile
    sensitivity: CapBudSensitivity

    decision: str
    notes: list[str] = Field(default_factory=list)
