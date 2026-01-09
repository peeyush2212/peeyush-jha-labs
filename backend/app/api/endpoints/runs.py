from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.db.deps import get_db, get_user_id
from app.db.repository import get_run, list_runs
from app.schemas.runs import RunDetailResponse, RunsListResponse, RunSummary
from app.services.reports import build_run_report_pdf

router = APIRouter()


@router.get("", response_model=RunsListResponse)
def api_list_runs(
    limit: int = 20,
    offset: int = 0,
    run_type: str | None = None,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> RunsListResponse:
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    rows = list_runs(db, limit=limit, offset=offset, run_type=run_type, user_id=user_id)

    items: list[RunSummary] = []
    for r in rows:
        items.append(
            RunSummary(
                run_id=r.run_id,
                run_type=r.run_type,
                created_at=r.created_at,
                has_result_csv=r.result_csv is not None,
            )
        )

    return RunsListResponse(items=items, limit=limit, offset=offset, run_type=run_type)


@router.get("/{run_id}", response_model=RunDetailResponse)
def api_get_run(
    run_id: str,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> RunDetailResponse:
    rec = get_run(db, run_id, user_id=user_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Run not found")

    return RunDetailResponse(
        run_id=rec.run_id,
        run_type=rec.run_type,
        created_at=rec.created_at,
        input=json.loads(rec.input_json),
        output=json.loads(rec.output_json),
        has_result_csv=rec.result_csv is not None,
    )


@router.get("/{run_id}/report.pdf")
def api_get_run_report_pdf(
    run_id: str,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> Response:
    """Generate a compact PDF report for a saved run."""
    rec = get_run(db, run_id, user_id=user_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Run not found")

    input_payload = json.loads(rec.input_json)
    output_payload = json.loads(rec.output_json)

    run_meta = {
        "run_id": rec.run_id,
        "run_type": rec.run_type,
        "created_at": rec.created_at.isoformat() if rec.created_at else "",
        "user_id": rec.user_id or "",
    }

    pdf_bytes = build_run_report_pdf(
        title=f"Run report – {rec.run_type}",
        run_meta=run_meta,
        input_payload=input_payload,
        output_payload=output_payload,
        notes=[
            "This report is generated locally from stored inputs/outputs for reproducibility.",
        ],
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="run_{run_id}.pdf"',
        },
    )


@router.get("/{run_id}/result.csv")
def api_get_run_csv(
    run_id: str,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> Response:
    rec = get_run(db, run_id, user_id=user_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Run not found")
    if rec.result_csv is None:
        raise HTTPException(status_code=404, detail="No CSV is available for this run")

    return Response(
        content=rec.result_csv,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="run_{run_id}.csv"'},
    )
