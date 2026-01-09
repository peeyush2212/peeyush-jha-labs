from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class BatchSummary(BaseModel):
    total_rows: int
    success_rows: int
    failed_rows: int


class BatchRunResponse(BaseModel):
    run_id: str
    summary: BatchSummary
    preview: list[dict[str, Any]]
    download_csv_url: str
