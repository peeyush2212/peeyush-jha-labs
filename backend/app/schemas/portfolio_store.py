from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.instruments import PortfolioDefinition


class PortfolioCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class PortfolioUpsertRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    portfolio: PortfolioDefinition


class PortfolioSummary(BaseModel):
    portfolio_id: str
    name: str
    updated_at: datetime


class PortfolioDetail(BaseModel):
    portfolio_id: str
    name: str
    created_at: datetime
    updated_at: datetime
    portfolio: PortfolioDefinition
