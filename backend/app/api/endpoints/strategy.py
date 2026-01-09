from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.deps import get_db, get_user_id
from app.db.repository import create_run
from app.schemas.strategy import (
    StrategyAnalyzeRequest,
    StrategyAnalyzeResponse,
    StrategyRecommendRequest,
    StrategyRecommendResponse,
)
from app.services.strategy_builder import analyze_strategy, recommend_strategies


router = APIRouter()


@router.post("/recommend", response_model=StrategyRecommendResponse)
def api_strategy_recommend(
    req: StrategyRecommendRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> StrategyRecommendResponse:
    resp, meta = recommend_strategies(req)
    run_id = str(uuid.uuid4())
    resp.run_id = run_id

    create_run(
        db,
        run_type="strategy.recommend",
        input_payload=req.model_dump(),
        output_payload={
            "normalized_move_pct": resp.normalized_move_pct,
            "expected_spot": resp.expected_spot,
            "signed_vol_shift": resp.signed_vol_shift,
            "meta": meta,
            "candidates": [c.model_dump() for c in resp.candidates],
        },
        run_id=run_id,
        user_id=user_id,
    )
    return resp


@router.post("/analyze", response_model=StrategyAnalyzeResponse)
def api_strategy_analyze(
    req: StrategyAnalyzeRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> StrategyAnalyzeResponse:
    resp = analyze_strategy(req)
    run_id = str(uuid.uuid4())
    resp.run_id = run_id
    create_run(
        db,
        run_type="strategy.analyze",
        input_payload=req.model_dump(),
        output_payload=resp.model_dump(),
        run_id=run_id,
        user_id=user_id,
    )
    return resp
