from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class MacroSeriesMeta(BaseModel):
    series_id: str
    name: str
    units: str
    frequency: str
    source: str
    description: str

    last_date: date | None = None
    last_value: float | None = None


class MacroSeriesPoint(BaseModel):
    date: date
    value: float


class MacroSeriesResponse(BaseModel):
    series: MacroSeriesMeta
    points: list[MacroSeriesPoint]


class MacroTimelinePoint(BaseModel):
    month: date
    usdinr: float | None = None
    rate_3m_pct: float | None = None
    rate_10y_pct: float | None = None
    cpi_index: float | None = None
    cpi_yoy_pct: float | None = None
    curve_slope_bps: float | None = None


class MacroTimelineResponse(BaseModel):
    points: list[MacroTimelinePoint]


RateBucket = Literal["short", "long"]


class FixedIncomePosition(BaseModel):
    """A generic duration/convexity-based fixed-income exposure.

    It can represent a bond, a swap DV01 bucket, a cash ladder, etc.
    """

    label: str = Field(default="Fixed income")
    notional_inr: float = Field(..., description="PV/notional in INR (positive = long)")
    modified_duration: float = Field(..., ge=0)
    convexity: float = Field(default=0.0, ge=0)
    rate_bucket: RateBucket = Field(default="long")


class FxPosition(BaseModel):
    label: str = Field(default="USDINR exposure")
    notional_usd: float = Field(..., description="USD notional (positive = long USD)")


class MacroScenario(BaseModel):
    """A simple macro shock definition.

    - rate shocks are in **basis points**
    - FX shock is in **percent** (e.g., +2 means USDINR up 2%)
    """

    short_rate_shock_bps: float = Field(default=0.0)
    long_rate_shock_bps: float = Field(default=0.0)
    fx_spot_shock_pct: float = Field(default=0.0)
    inflation_shock_pp: float = Field(default=0.0, description="Optional, not used in P&L")


class MacroCarryInputs(BaseModel):
    """Carry proxy parameters."""

    horizon_days: int = Field(default=30, ge=1, le=3650)
    funding_rate_pct: float = Field(default=0.0, description="Funding rate in percent")


class MacroScenarioRequest(BaseModel):
    scenario: MacroScenario
    fixed_income: list[FixedIncomePosition] = Field(default_factory=list)
    fx: list[FxPosition] = Field(default_factory=list)
    carry: MacroCarryInputs = Field(default_factory=MacroCarryInputs)

    # Optional overrides for deterministic runs/tests
    base_usdinr: float | None = Field(default=None, gt=0)
    base_rate_3m_pct: float | None = Field(default=None)
    base_rate_10y_pct: float | None = Field(default=None)

    save_run: bool = Field(default=True)

    @model_validator(mode="after")
    def _validate_non_empty(self) -> "MacroScenarioRequest":
        if not self.fixed_income and not self.fx:
            raise ValueError("Provide at least one position (fixed_income or fx)")
        return self


class MacroPositionResult(BaseModel):
    label: str
    kind: Literal["fixed_income", "fx"]
    pnl_inr: float
    details: dict[str, float | str]


class MacroScenarioResult(BaseModel):
    run_id: str | None = None
    asof_date: date | None = None

    base_usdinr: float
    base_rate_3m_pct: float
    base_rate_10y_pct: float

    scenario: MacroScenario
    carry: MacroCarryInputs

    positions: list[MacroPositionResult]
    total_pnl_inr: float


class MacroGridRequest(BaseModel):
    scenario: MacroScenario
    fixed_income: list[FixedIncomePosition] = Field(default_factory=list)
    fx: list[FxPosition] = Field(default_factory=list)
    carry: MacroCarryInputs = Field(default_factory=MacroCarryInputs)

    # Grid axes
    short_rate_shocks_bps: list[float] = Field(default_factory=list, max_length=25)
    long_rate_shocks_bps: list[float] = Field(default_factory=list, max_length=25)
    fx_spot_shocks_pct: list[float] = Field(..., min_length=1, max_length=25)

    # Optional overrides
    base_usdinr: float | None = Field(default=None, gt=0)
    base_rate_3m_pct: float | None = Field(default=None)
    base_rate_10y_pct: float | None = Field(default=None)

    save_run: bool = Field(default=True)

    @model_validator(mode="after")
    def _validate_positions_and_grid(self) -> "MacroGridRequest":
        if not self.fixed_income and not self.fx:
            raise ValueError("Provide at least one position (fixed_income or fx)")

        # Enforce at least one rate axis (short or long) + FX axis
        if not self.fx_spot_shocks_pct:
            raise ValueError("fx_spot_shocks_pct must have at least 1 value")

        if not self.short_rate_shocks_bps and not self.long_rate_shocks_bps:
            raise ValueError("Provide short_rate_shocks_bps and/or long_rate_shocks_bps")

        if self.short_rate_shocks_bps and len(self.short_rate_shocks_bps) * len(self.fx_spot_shocks_pct) > 225:
            raise ValueError("grid too large (max 225 points)")
        if self.long_rate_shocks_bps and len(self.long_rate_shocks_bps) * len(self.fx_spot_shocks_pct) > 225:
            raise ValueError("grid too large (max 225 points)")

        return self


class MacroGridResponse(BaseModel):
    run_id: str | None = None
    asof_date: date | None = None

    base_usdinr: float
    base_rate_3m_pct: float
    base_rate_10y_pct: float

    fx_spot_shocks_pct: list[float]

    # If provided, will include these matrices
    short_rate_shocks_bps: list[float] | None = None
    short_rate_grid_pnl: list[list[float]] | None = None

    long_rate_shocks_bps: list[float] | None = None
    long_rate_grid_pnl: list[list[float]] | None = None


# -----------------
# Scenario library (stress packs)
# -----------------


class StressPack(BaseModel):
    pack_id: str
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    scenario: MacroScenario

    # Metadata
    is_builtin: bool = False
    owner_user_id: str | None = None


class StressPackCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    description: str = Field(default="", max_length=400)
    tags: list[str] = Field(default_factory=list, max_length=12)
    scenario: MacroScenario


class StressPackUpdateRequest(StressPackCreateRequest):
    pass


# -----------------
# Side-by-side compare
# -----------------


class MacroNamedScenario(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    scenario: MacroScenario


class MacroCompareRequest(BaseModel):
    fixed_income: list[FixedIncomePosition] = Field(default_factory=list)
    fx: list[FxPosition] = Field(default_factory=list)
    carry: MacroCarryInputs = Field(default_factory=MacroCarryInputs)

    scenarios: list[MacroNamedScenario] = Field(..., min_length=2, max_length=4)

    # Optional overrides
    base_usdinr: float | None = Field(default=None, gt=0)
    base_rate_3m_pct: float | None = Field(default=None)
    base_rate_10y_pct: float | None = Field(default=None)

    save_run: bool = Field(default=False)

    @model_validator(mode="after")
    def _validate_compare(self) -> "MacroCompareRequest":
        if not self.fixed_income and not self.fx:
            raise ValueError("Provide at least one position (fixed_income or fx)")
        if len(self.scenarios) < 2:
            raise ValueError("Provide at least 2 scenarios")
        # Unique names
        names = [s.name for s in self.scenarios]
        if len(set(names)) != len(names):
            raise ValueError("Scenario names must be unique")
        return self


class MacroCompareItem(BaseModel):
    name: str
    scenario: MacroScenario
    carry: MacroCarryInputs
    positions: list[MacroPositionResult]
    total_pnl_inr: float


class MacroCompareResponse(BaseModel):
    run_id: str | None = None
    asof_date: date | None = None

    base_usdinr: float
    base_rate_3m_pct: float
    base_rate_10y_pct: float

    items: list[MacroCompareItem]
