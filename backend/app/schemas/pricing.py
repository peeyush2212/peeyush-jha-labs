from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Greeks(BaseModel):
    delta: float
    gamma: float
    vega: float
    theta: float
    rho: float


# ----------------------
# Vanilla option pricing
# ----------------------


class VanillaPricingRequest(BaseModel):
    option_type: Literal["call", "put"] = Field(description="Option type")
    spot: float = Field(gt=0, description="Spot price")
    strike: float = Field(gt=0, description="Strike price")
    rate: float = Field(description="Continuously-compounded annual risk-free rate (e.g., 0.05)")
    dividend_yield: float = Field(
        default=0.0, description="Continuously-compounded annual dividend yield (e.g., 0.01)"
    )
    vol: float = Field(gt=0, description="Annualized volatility (e.g., 0.20)")
    time_to_expiry: float = Field(gt=0, description="Time to expiry in years (e.g., 0.5)")
    quantity: float = Field(default=1.0, gt=0, description="Number of option units")


class VanillaPricingResponse(BaseModel):
    run_id: str
    price_per_unit: float
    price_total: float
    greeks: Greeks


# -----------
# Call spread
# -----------


class CallSpreadPricingRequest(BaseModel):
    spot: float = Field(gt=0, description="Spot price")
    strike_long: float = Field(gt=0, description="Long call strike (lower strike)")
    strike_short: float = Field(gt=0, description="Short call strike (higher strike)")
    rate: float = Field(description="Continuously-compounded annual risk-free rate (e.g., 0.05)")
    dividend_yield: float = Field(
        default=0.0, description="Continuously-compounded annual dividend yield (e.g., 0.01)"
    )
    vol: float = Field(gt=0, description="Annualized volatility (e.g., 0.20)")
    time_to_expiry: float = Field(gt=0, description="Time to expiry in years (e.g., 0.5)")
    quantity: float = Field(default=1.0, gt=0, description="Number of spread units")

    @model_validator(mode="after")
    def _validate_strikes(self) -> "CallSpreadPricingRequest":
        if self.strike_short <= self.strike_long:
            raise ValueError("strike_short must be > strike_long")
        return self


class CallSpreadPricingResponse(BaseModel):
    run_id: str
    price_per_unit: float
    price_total: float
    greeks: Greeks
