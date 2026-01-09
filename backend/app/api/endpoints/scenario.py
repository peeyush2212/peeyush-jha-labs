from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.deps import get_db, get_user_id
from app.db.repository import create_run
from app.schemas.pricing import Greeks, VanillaPricingResponse
from app.schemas.scenario import ScenarioDiff, ScenarioVanillaRequest, ScenarioVanillaResponse
from app.services.black_scholes import price_and_greeks

router = APIRouter()


@router.post("/vanilla-reprice", response_model=ScenarioVanillaResponse)
def scenario_vanilla_reprice(
    req: ScenarioVanillaRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> ScenarioVanillaResponse:
    base_req = req.base
    shocks = req.shocks

    try:
        base_res = price_and_greeks(
            option_type=base_req.option_type,
            spot=base_req.spot,
            strike=base_req.strike,
            rate=base_req.rate,
            dividend_yield=base_req.dividend_yield,
            vol=base_req.vol,
            time_to_expiry=base_req.time_to_expiry,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    shocked_spot = base_req.spot * (1.0 + shocks.spot_shift_pct / 100.0)
    shocked_vol = base_req.vol + shocks.vol_shift
    shocked_rate = base_req.rate + shocks.rate_shift_bps / 10000.0

    try:
        shocked_res = price_and_greeks(
            option_type=base_req.option_type,
            spot=shocked_spot,
            strike=base_req.strike,
            rate=shocked_rate,
            dividend_yield=base_req.dividend_yield,
            vol=shocked_vol,
            time_to_expiry=base_req.time_to_expiry,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    base_out = VanillaPricingResponse(
        run_id="base",
        price_per_unit=base_res.price,
        price_total=base_res.price * base_req.quantity,
        greeks=Greeks(
            delta=base_res.delta,
            gamma=base_res.gamma,
            vega=base_res.vega,
            theta=base_res.theta,
            rho=base_res.rho,
        ),
    )

    shocked_out = VanillaPricingResponse(
        run_id="shocked",
        price_per_unit=shocked_res.price,
        price_total=shocked_res.price * base_req.quantity,
        greeks=Greeks(
            delta=shocked_res.delta,
            gamma=shocked_res.gamma,
            vega=shocked_res.vega,
            theta=shocked_res.theta,
            rho=shocked_res.rho,
        ),
    )

    diff = ScenarioDiff(
        price_per_unit=shocked_out.price_per_unit - base_out.price_per_unit,
        price_total=shocked_out.price_total - base_out.price_total,
        greeks=Greeks(
            delta=shocked_out.greeks.delta - base_out.greeks.delta,
            gamma=shocked_out.greeks.gamma - base_out.greeks.gamma,
            vega=shocked_out.greeks.vega - base_out.greeks.vega,
            theta=shocked_out.greeks.theta - base_out.greeks.theta,
            rho=shocked_out.greeks.rho - base_out.greeks.rho,
        ),
    )

    # Persist run
    run_id = create_run(
        db,
        run_type="scenario_vanilla",
        input_payload=req.model_dump(),
        output_payload={
            "base": base_out.model_dump(),
            "shocked": shocked_out.model_dump(),
            "diff": diff.model_dump(),
        },
        user_id=user_id,
    )

    # Return with persisted run_id
    base_out.run_id = run_id
    shocked_out.run_id = run_id

    return ScenarioVanillaResponse(run_id=run_id, base=base_out, shocked=shocked_out, diff=diff)
