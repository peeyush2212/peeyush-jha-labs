from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.deps import get_db, get_user_id
from app.db.repository import create_run
from app.schemas.capbud import CapBudComputeRequest, CapBudComputeResponse
from app.services.capbud import compute_capbud


router = APIRouter()


@router.post("/compute", response_model=CapBudComputeResponse)
def api_capbud_compute(
    req: CapBudComputeRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> CapBudComputeResponse:
    run_id = str(uuid.uuid4())
    resp = compute_capbud(req, run_id=run_id)

    create_run(
        db,
        run_type="capbud.compute",
        input_payload=req.model_dump(mode="json"),
        output_payload=resp.model_dump(mode="json"),
        run_id=run_id,
        user_id=user_id,
    )
    return resp
