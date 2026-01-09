from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.pricing import Greeks


InstrumentType = Literal["vanilla", "american", "digital", "barrier", "asian", "forward"]


class MarketInputs(BaseModel):
    spot: float = Field(gt=0, description="Spot price")
    rate: float = Field(description="Continuously-compounded annual risk-free rate")
    dividend_yield: float = Field(default=0.0, description="Continuously-compounded annual dividend yield")
    vol: float = Field(gt=0, description="Annualized volatility")


class InstrumentLeg(BaseModel):
    leg_id: str = Field(description="Client-side leg id")
    instrument_type: InstrumentType
    method: str = Field(description="Pricing method key")
    quantity: float = Field(description="Signed quantity (negative = short)")
    params: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_quantity(self) -> "InstrumentLeg":
        if self.quantity == 0:
            raise ValueError("quantity must be non-zero")
        return self


class InstrumentPricingRequest(BaseModel):
    market: MarketInputs
    leg: InstrumentLeg


class InstrumentPricingResponse(BaseModel):
    run_id: str
    result: "LegPricingResult"


class LegPricingResult(BaseModel):
    leg_id: str
    instrument_type: str
    method: str
    quantity: float
    status: Literal["ok", "error"]
    price_per_unit: float | None = None
    price_total: float | None = None
    greeks: Greeks | None = None
    error: str | None = None


class PortfolioDefinition(BaseModel):
    portfolio_id: str | None = None
    name: str = Field(default="Untitled")
    legs: list[InstrumentLeg] = Field(default_factory=list)


class PortfolioPriceRequest(BaseModel):
    market: MarketInputs
    portfolio: PortfolioDefinition
    strict: bool = Field(default=False, description="If true, fail on first leg error")


class PortfolioPriceResponse(BaseModel):
    run_id: str
    total_price: float
    total_greeks: Greeks
    legs: list[LegPricingResult]
    summary: dict[str, int]


class PortfolioScenarioGridRequest(BaseModel):
    market: MarketInputs
    portfolio: PortfolioDefinition

    # Grid defined in terms of shifts from base (spot pct, vol abs)
    spot_shifts_pct: list[float] = Field(..., min_length=1, max_length=25)
    vol_shifts: list[float] = Field(..., min_length=1, max_length=25)
    rate_shift_bps: float = Field(default=0.0)

    @model_validator(mode="after")
    def _validate_grid_size(self) -> "PortfolioScenarioGridRequest":
        if len(self.spot_shifts_pct) * len(self.vol_shifts) > 225:
            raise ValueError("grid too large (max 225 points)")
        return self


class PortfolioScenarioGridResponse(BaseModel):
    run_id: str
    spot_shifts_pct: list[float]
    vol_shifts: list[float]
    base_total: float
    grid_totals: list[list[float]]


class PortfolioPayoffRequest(BaseModel):
    portfolio: PortfolioDefinition
    spot_min: float = Field(gt=0)
    spot_max: float = Field(gt=0)
    steps: int = Field(default=41, ge=3, le=401)

    @model_validator(mode="after")
    def _validate_range(self) -> "PortfolioPayoffRequest":
        if self.spot_max <= self.spot_min:
            raise ValueError("spot_max must be > spot_min")
        return self


class PortfolioPayoffResponse(BaseModel):
    run_id: str
    spots: list[float]
    payoff: list[float]
    included_leg_ids: list[str]
    excluded: list[dict[str, str]]
