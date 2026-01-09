from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.deps import get_db, get_user_id
from app.db.repository import create_run
from app.schemas.tax import TaxComputeRequest, TaxComputeResponse
from app.services.tax import compute_tax


router = APIRouter()


@router.post("/compute", response_model=TaxComputeResponse)
def api_tax_compute(
    req: TaxComputeRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> TaxComputeResponse:
    run_id = str(uuid.uuid4())
    resp = compute_tax(req, run_id=run_id)

    # Persist a JSON-safe payload in Runs (dates -> ISO strings).
    create_run(
        db,
        run_type="tax.compute",
        input_payload=req.model_dump(mode="json"),
        output_payload=resp.model_dump(mode="json"),
        run_id=run_id,
        user_id=user_id,
    )
    return resp
