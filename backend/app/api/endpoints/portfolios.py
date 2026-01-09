from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.deps import get_db, get_user_id
from app.db.repository import create_portfolio, delete_portfolio, get_portfolio, list_portfolios, update_portfolio
from app.schemas.instruments import PortfolioDefinition
from app.schemas.portfolio_store import PortfolioCreateRequest, PortfolioDetail, PortfolioSummary, PortfolioUpsertRequest


router = APIRouter()


@router.get("", response_model=list[PortfolioSummary])
def api_list_portfolios(
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> list[PortfolioSummary]:
    limit = max(1, min(limit, 500))
    offset = max(0, offset)

    rows = list_portfolios(db, limit=limit, offset=offset, user_id=user_id)
    return [PortfolioSummary(portfolio_id=r.portfolio_id, name=r.name, updated_at=r.updated_at) for r in rows]


@router.post("", response_model=PortfolioDetail)
def api_create_portfolio(
    req: PortfolioCreateRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> PortfolioDetail:
    definition = PortfolioDefinition(name=req.name, legs=[]).model_dump()
    pid = create_portfolio(db, name=req.name, definition=definition, user_id=user_id)
    rec = get_portfolio(db, pid, user_id=user_id)
    if rec is None:
        raise HTTPException(status_code=500, detail="Failed to load portfolio after write")
    return PortfolioDetail(
        portfolio_id=rec.portfolio_id,
        name=rec.name,
        created_at=rec.created_at,
        updated_at=rec.updated_at,
        portfolio=PortfolioDefinition(**json.loads(rec.definition_json)),
    )


@router.post("/import", response_model=PortfolioDetail)
def api_import_portfolio(
    req: PortfolioUpsertRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> PortfolioDetail:
    """Create a portfolio from a full definition in one call.

    This is useful for feature modules (e.g., strategy builder) that want to save a multi-leg structure
    without requiring a create + update sequence on the client.
    """

    pid = create_portfolio(db, name=req.name, definition=req.portfolio.model_dump(), user_id=user_id)
    rec = get_portfolio(db, pid, user_id=user_id)
    if rec is None:
        raise HTTPException(status_code=500, detail="Failed to load portfolio after write")
    return PortfolioDetail(
        portfolio_id=rec.portfolio_id,
        name=rec.name,
        created_at=rec.created_at,
        updated_at=rec.updated_at,
        portfolio=PortfolioDefinition(**json.loads(rec.definition_json)),
    )


@router.get("/{portfolio_id}", response_model=PortfolioDetail)
def api_get_portfolio(
    portfolio_id: str,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> PortfolioDetail:
    rec = get_portfolio(db, portfolio_id, user_id=user_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return PortfolioDetail(
        portfolio_id=rec.portfolio_id,
        name=rec.name,
        created_at=rec.created_at,
        updated_at=rec.updated_at,
        portfolio=PortfolioDefinition(**json.loads(rec.definition_json)),
    )


@router.put("/{portfolio_id}", response_model=PortfolioDetail)
def api_update_portfolio(
    portfolio_id: str,
    req: PortfolioUpsertRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> PortfolioDetail:
    ok = update_portfolio(
        db,
        portfolio_id=portfolio_id,
        name=req.name,
        definition=req.portfolio.model_dump(),
        user_id=user_id,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    rec = get_portfolio(db, portfolio_id, user_id=user_id)
    if rec is None:
        raise HTTPException(status_code=500, detail="Failed to load portfolio after write")
    return PortfolioDetail(
        portfolio_id=rec.portfolio_id,
        name=rec.name,
        created_at=rec.created_at,
        updated_at=rec.updated_at,
        portfolio=PortfolioDefinition(**json.loads(rec.definition_json)),
    )


@router.delete("/{portfolio_id}")
def api_delete_portfolio(
    portfolio_id: str,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> dict[str, str]:
    ok = delete_portfolio(db, portfolio_id=portfolio_id, user_id=user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return {"status": "deleted"}
