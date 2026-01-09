from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.deps import get_db, get_user_id
from app.db.repository import create_run
from app.schemas.instruments import (
    PortfolioPayoffRequest,
    PortfolioPayoffResponse,
    PortfolioPriceRequest,
    PortfolioPriceResponse,
    PortfolioScenarioGridRequest,
    PortfolioScenarioGridResponse,
)
from app.services.portfolio import payoff_curve, price_portfolio_with_greeks, scenario_grid_totals


router = APIRouter()


@router.post("/price", response_model=PortfolioPriceResponse)
def api_portfolio_price(
    req: PortfolioPriceRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> PortfolioPriceResponse:
    market = req.market.model_dump()
    legs = [l.model_dump() for l in req.portfolio.legs]

    total_price, total_greeks, leg_results = price_portfolio_with_greeks(market=market, legs=legs, strict=req.strict)
    out = {
        "total_price": total_price,
        "total_greeks": total_greeks.model_dump(),
        "legs": leg_results,
        "summary": {
            "total": len(legs),
            "ok": sum(1 for r in leg_results if r.get("status") == "ok"),
            "error": sum(1 for r in leg_results if r.get("status") == "error"),
        },
    }

    run_id = create_run(
        db,
        run_type="portfolio_price",
        input_payload=req.model_dump(),
        output_payload=out,
        user_id=user_id,
    )

    return PortfolioPriceResponse(
        run_id=run_id,
        total_price=total_price,
        total_greeks=total_greeks,
        legs=[
            *leg_results
        ],
        summary=out["summary"],
    )


@router.post("/scenario-grid", response_model=PortfolioScenarioGridResponse)
def api_portfolio_scenario_grid(
    req: PortfolioScenarioGridRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> PortfolioScenarioGridResponse:
    market = req.market.model_dump()
    legs = [l.model_dump() for l in req.portfolio.legs]

    # Base (price-only for speed)
    base_total, _, _ = price_portfolio_with_greeks(market=market, legs=legs, strict=False)

    grid = scenario_grid_totals(
        market=market,
        legs=legs,
        spot_shifts_pct=req.spot_shifts_pct,
        vol_shifts=req.vol_shifts,
        rate_shift_bps=req.rate_shift_bps,
    )

    out = {
        "spot_shifts_pct": req.spot_shifts_pct,
        "vol_shifts": req.vol_shifts,
        "rate_shift_bps": req.rate_shift_bps,
        "base_total": base_total,
        "grid_totals": grid,
    }

    run_id = create_run(
        db,
        run_type="portfolio_scenario_grid",
        input_payload=req.model_dump(),
        output_payload=out,
        user_id=user_id,
    )

    return PortfolioScenarioGridResponse(
        run_id=run_id,
        spot_shifts_pct=req.spot_shifts_pct,
        vol_shifts=req.vol_shifts,
        base_total=base_total,
        grid_totals=grid,
    )


@router.post("/payoff", response_model=PortfolioPayoffResponse)
def api_portfolio_payoff(
    req: PortfolioPayoffRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> PortfolioPayoffResponse:
    legs = [l.model_dump() for l in req.portfolio.legs]
    # Build spot grid
    n = req.steps
    spots = [req.spot_min + (req.spot_max - req.spot_min) * i / (n - 1) for i in range(n)]
    payoffs, included, excluded = payoff_curve(legs=legs, spots=spots)

    out = {
        "spots": spots,
        "payoff": payoffs,
        "included_leg_ids": included,
        "excluded": excluded,
    }
    run_id = create_run(
        db,
        run_type="portfolio_payoff",
        input_payload=req.model_dump(),
        output_payload=out,
        user_id=user_id,
    )

    return PortfolioPayoffResponse(
        run_id=run_id,
        spots=spots,
        payoff=payoffs,
        included_leg_ids=included,
        excluded=excluded,
    )
