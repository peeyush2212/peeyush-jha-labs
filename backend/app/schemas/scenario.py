from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.pricing import Greeks, VanillaPricingRequest, VanillaPricingResponse


class ScenarioShocks(BaseModel):
    spot_shift_pct: float = Field(
        default=0.0, description="Spot shift in percent. Example: 5 means +5%, -3 means -3%."
    )
    vol_shift: float = Field(
        default=0.0,
        description="Absolute volatility shift. Example: 0.02 means +2 vol points.",
    )
    rate_shift_bps: float = Field(
        default=0.0,
        description="Rate shift in basis points. Example: 50 means +0.50%, -25 means -0.25%.",
    )


class ScenarioVanillaRequest(BaseModel):
    base: VanillaPricingRequest
    shocks: ScenarioShocks


class ScenarioDiff(BaseModel):
    price_per_unit: float
    price_total: float
    greeks: Greeks


class ScenarioVanillaResponse(BaseModel):
    run_id: str
    base: VanillaPricingResponse
    shocked: VanillaPricingResponse
    diff: ScenarioDiff
