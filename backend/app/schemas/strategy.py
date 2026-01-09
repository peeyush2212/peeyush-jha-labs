from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.instruments import InstrumentLeg, LegPricingResult, MarketInputs
from app.schemas.pricing import Greeks


Direction = Literal["bullish", "bearish", "neutral"]
VolView = Literal["up", "down", "flat"]
Confidence = Literal["low", "medium", "high"]

# This page currently uses vanilla pricing methods.
PricingMethod = Literal["black_scholes", "binomial_crr"]


class StrategyView(BaseModel):
    """User view for the underlying + vol over a horizon.

    The UI lets the user specify either:
      - move_pct (e.g. +5 means +5%), OR
      - target_price (absolute price target)
    """

    direction: Direction = Field(default="bullish")

    move_pct: float | None = Field(
        default=None,
        description="Expected % move over horizon (sign will be aligned to direction).",
    )
    target_price: float | None = Field(
        default=None,
        description="Expected target price over horizon.",
    )

    horizon_days: int = Field(default=30, ge=1, le=3650)

    vol_view: VolView = Field(default="flat")
    vol_shift: float = Field(
        default=0.0,
        ge=0.0,
        le=2.0,
        description="Absolute shift in vol (e.g. 0.05 is +5 vol points). Direction comes from vol_view.",
    )

    confidence: Confidence | None = Field(default=None)
    event: bool = Field(default=False)

    @model_validator(mode="after")
    def _check_move(self) -> "StrategyView":
        if self.move_pct is None and self.target_price is None:
            # Default to 0 move if nothing provided.
            self.move_pct = 0.0
        return self


class StrategyConstraints(BaseModel):
    max_loss: float | None = Field(
        default=None,
        ge=0.0,
        description="Optional max tolerated loss (in currency units) used to filter candidates.",
    )
    defined_risk_only: bool = Field(default=True)

    income_vs_convexity: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="0 = prefer income/credit. 1 = prefer convexity (gamma/vega).",
    )

    max_legs: int = Field(default=4, ge=1, le=6)
    allow_multi_expiry: bool = Field(default=True)


class StrategyGeneration(BaseModel):
    strike_step: float = Field(default=1.0, gt=0.0)
    width_pct: float | None = Field(
        default=None,
        ge=0.0,
        le=200.0,
        description="Optional width override used for spreads/strangles/butterflies.",
    )

    expiry_days: int = Field(default=90, ge=1, le=3650)
    long_expiry_days: int = Field(default=120, ge=1, le=3650)

    tree_steps: int = Field(default=200, ge=10, le=2000)

    @model_validator(mode="after")
    def _check_expiries(self) -> "StrategyGeneration":
        # Ensure the long expiry is strictly longer.
        if self.long_expiry_days <= self.expiry_days:
            self.long_expiry_days = self.expiry_days + 30
        return self


class StrategyRecommendRequest(BaseModel):
    market: MarketInputs
    view: StrategyView = Field(default_factory=StrategyView)
    constraints: StrategyConstraints = Field(default_factory=StrategyConstraints)
    generation: StrategyGeneration = Field(default_factory=StrategyGeneration)

    method: PricingMethod = Field(default="black_scholes")


class StrategyCandidate(BaseModel):
    candidate_id: str
    strategy_key: str
    name: str

    fit_score: int = Field(ge=0, le=100)
    rationale: str

    legs: list[InstrumentLeg]

    net_premium: float
    max_profit: float | None
    max_loss: float | None
    breakevens: list[float]

    total_greeks: Greeks

    strategy_note: str
    method_note: str


class StrategyRecommendResponse(BaseModel):
    run_id: str

    normalized_move_pct: float
    expected_spot: float
    signed_vol_shift: float

    candidates: list[StrategyCandidate]


class StrategyAnalysisSettings(BaseModel):
    spot_range_pct: float = Field(default=35.0, ge=5.0, le=200.0)
    spot_steps: int = Field(default=101, ge=21, le=401)

    grid_spot_shifts_pct: list[float] = Field(default_factory=lambda: [-20, -10, -5, 0, 5, 10, 20], min_length=1, max_length=25)
    grid_vol_shifts: list[float] = Field(default_factory=lambda: [-0.10, -0.05, 0.0, 0.05, 0.10], min_length=1, max_length=25)
    grid_rate_shift_bps: float = Field(default=0.0)


class StrategyAnalyzeRequest(BaseModel):
    market: MarketInputs
    view: StrategyView

    strategy_key: str
    name: str
    legs: list[InstrumentLeg]

    settings: StrategyAnalysisSettings = Field(default_factory=StrategyAnalysisSettings)


class StrategyCurve(BaseModel):
    spots: list[float]
    values: list[float]


class StrategyHeatmap(BaseModel):
    spot_shifts_pct: list[float]
    vol_shifts: list[float]
    base_total: float
    grid_totals: list[list[float]]
    grid_pnl: list[list[float]]

    focus_spot_shift_pct: float
    focus_vol_shift: float
    focus_ij: tuple[int, int] | None


class StrategyScenarioRow(BaseModel):
    label: str
    spot_shift_pct: float
    vol_shift: float
    rate_shift_bps: float
    total_value: float
    pnl_vs_initial: float


class StrategyAnalyzeResponse(BaseModel):
    run_id: str

    base_total: float
    total_greeks: Greeks
    per_leg: list[LegPricingResult]

    payoff: StrategyCurve
    horizon: StrategyCurve

    breakevens: list[float]
    max_profit: float | None
    max_loss: float | None

    heatmap: StrategyHeatmap
    scenario_pack: list[StrategyScenarioRow]
