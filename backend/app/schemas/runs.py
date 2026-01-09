from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class RunSummary(BaseModel):
    run_id: str
    run_type: str
    created_at: datetime
    has_result_csv: bool


class RunsListResponse(BaseModel):
    items: list[RunSummary]
    limit: int
    offset: int
    run_type: str | None = None


class RunDetailResponse(BaseModel):
    run_id: str
    run_type: str
    created_at: datetime
    input: dict[str, Any]
    output: dict[str, Any]
    has_result_csv: bool
