from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.deps import get_db, get_user_id
from app.db.repository import create_run
from app.schemas.instruments import InstrumentPricingRequest, InstrumentPricingResponse
from app.schemas.pricing import (
    CallSpreadPricingRequest,
    CallSpreadPricingResponse,
    Greeks,
    VanillaPricingRequest,
    VanillaPricingResponse,
)
from app.services.black_scholes import call_spread_price_and_greeks, price_and_greeks
from app.services.instrument_pricer import price_leg_with_greeks

router = APIRouter()


@router.post("/vanilla", response_model=VanillaPricingResponse)
def price_vanilla(req: VanillaPricingRequest, db: Session = Depends(get_db), user_id: str | None = Depends(get_user_id)) -> VanillaPricingResponse:
    try:
        res = price_and_greeks(
            option_type=req.option_type,
            spot=req.spot,
            strike=req.strike,
            rate=req.rate,
            dividend_yield=req.dividend_yield,
            vol=req.vol,
            time_to_expiry=req.time_to_expiry,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    run_id = str(uuid.uuid4())

    response = VanillaPricingResponse(
        run_id=run_id,
        price_per_unit=res.price,
        price_total=res.price * req.quantity,
        greeks=Greeks(delta=res.delta, gamma=res.gamma, vega=res.vega, theta=res.theta, rho=res.rho),
    )

    # Persist run (inputs + outputs)
    create_run(
        db,
        run_type="vanilla",
        input_payload=req.model_dump(),
        output_payload=response.model_dump(),
        run_id=run_id,
        user_id=user_id,
    )

    return response


@router.post("/call-spread", response_model=CallSpreadPricingResponse)
def price_call_spread(req: CallSpreadPricingRequest, db: Session = Depends(get_db), user_id: str | None = Depends(get_user_id)) -> CallSpreadPricingResponse:
    try:
        res = call_spread_price_and_greeks(
            spot=req.spot,
            strike_long=req.strike_long,
            strike_short=req.strike_short,
            rate=req.rate,
            dividend_yield=req.dividend_yield,
            vol=req.vol,
            time_to_expiry=req.time_to_expiry,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    run_id = str(uuid.uuid4())

    response = CallSpreadPricingResponse(
        run_id=run_id,
        price_per_unit=res.price,
        price_total=res.price * req.quantity,
        greeks=Greeks(delta=res.delta, gamma=res.gamma, vega=res.vega, theta=res.theta, rho=res.rho),
    )

    create_run(
        db,
        run_type="call_spread",
        input_payload=req.model_dump(),
        output_payload=response.model_dump(),
        run_id=run_id,
        user_id=user_id,
    )

    return response


@router.post("/instrument", response_model=InstrumentPricingResponse)
def price_instrument(
    req: InstrumentPricingRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> InstrumentPricingResponse:
    """Generic single-instrument pricer.

    This powers the "Pricer" UI and is also used by the multi-leg portfolio tool.
    """
    run_id = str(uuid.uuid4())

    market = req.market.model_dump()
    leg = req.leg.model_dump()
    try:
        priced = price_leg_with_greeks(
            instrument_type=req.leg.instrument_type,
            method=req.leg.method,
            market=market,
            params=req.leg.params,
        )
        result = {
            "leg_id": req.leg.leg_id,
            "instrument_type": req.leg.instrument_type,
            "method": req.leg.method,
            "quantity": req.leg.quantity,
            "status": "ok",
            "price_per_unit": priced.price_per_unit,
            "price_total": priced.price_per_unit * req.leg.quantity,
            "greeks": priced.greeks.model_dump(),
        }
    except Exception as e:  # noqa: BLE001
        result = {
            "leg_id": req.leg.leg_id,
            "instrument_type": req.leg.instrument_type,
            "method": req.leg.method,
            "quantity": req.leg.quantity,
            "status": "error",
            "error": str(e),
        }

    response = {"run_id": run_id, "result": result}

    create_run(
        db,
        run_type="instrument",
        input_payload={"market": market, "leg": leg},
        output_payload=response,
        run_id=run_id,
        user_id=user_id,
    )

    return InstrumentPricingResponse(**response)
