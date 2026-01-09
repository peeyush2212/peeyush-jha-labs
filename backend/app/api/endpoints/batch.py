from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.db.deps import get_db, get_user_id
from app.db.repository import create_run
from app.schemas.batch import BatchRunResponse, BatchSummary
from app.services.black_scholes import call_spread_price_and_greeks, price_and_greeks

router = APIRouter()


def _read_upload_as_text(file: UploadFile) -> str:
    raw = file.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    # Handle BOM if present
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded") from None


def _as_float(row: dict[str, str], key: str) -> float:
    if key not in row:
        raise KeyError(key)
    v = (row.get(key) or "").strip()
    if v == "":
        raise ValueError(f"Missing value for {key}")
    return float(v)


def _as_str(row: dict[str, str], key: str) -> str:
    if key not in row:
        raise KeyError(key)
    return (row.get(key) or "").strip()


def _make_result_csv(headers: list[str], rows: list[list[Any]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return buf.getvalue()


@router.post("/vanilla/csv", response_model=BatchRunResponse)
def batch_vanilla_csv(file: UploadFile = File(...), db: Session = Depends(get_db), user_id: str | None = Depends(get_user_id)) -> BatchRunResponse:
    text = _read_upload_as_text(file)
    reader = csv.DictReader(io.StringIO(text))

    required = ["option_type", "spot", "strike", "rate", "dividend_yield", "vol", "time_to_expiry", "quantity"]
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV must include a header row")
    missing = [c for c in required if c not in reader.fieldnames]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")

    results: list[dict[str, Any]] = []
    csv_rows: list[list[Any]] = []

    total = 0
    ok = 0
    failed = 0

    for idx, row in enumerate(reader, start=1):
        total += 1
        status = "ok"
        err = ""

        try:
            option_type = _as_str(row, "option_type").lower()
            spot = _as_float(row, "spot")
            strike = _as_float(row, "strike")
            rate = _as_float(row, "rate")
            dividend_yield = _as_float(row, "dividend_yield")
            vol = _as_float(row, "vol")
            t = _as_float(row, "time_to_expiry")
            qty = _as_float(row, "quantity")

            res = price_and_greeks(
                option_type=option_type,
                spot=spot,
                strike=strike,
                rate=rate,
                dividend_yield=dividend_yield,
                vol=vol,
                time_to_expiry=t,
            )

            out = {
                "price_per_unit": res.price,
                "price_total": res.price * qty,
                "delta": res.delta,
                "gamma": res.gamma,
                "vega": res.vega,
                "theta": res.theta,
                "rho": res.rho,
            }
            ok += 1
        except Exception as e:  # noqa: BLE001 - we want per-row robustness
            status = "error"
            err = str(e)
            out = {
                "price_per_unit": None,
                "price_total": None,
                "delta": None,
                "gamma": None,
                "vega": None,
                "theta": None,
                "rho": None,
            }
            failed += 1

        results.append(
            {
                "row_index": idx,
                "status": status,
                "error": err,
                "input": {k: row.get(k) for k in required},
                "output": out,
            }
        )

        csv_rows.append(
            [
                idx,
                status,
                err,
                out["price_per_unit"],
                out["price_total"],
                out["delta"],
                out["gamma"],
                out["vega"],
                out["theta"],
                out["rho"],
            ]
        )

    result_csv = _make_result_csv(
        ["row_index", "status", "error", "price_per_unit", "price_total", "delta", "gamma", "vega", "theta", "rho"],
        csv_rows,
    )

    summary = {"total_rows": total, "success_rows": ok, "failed_rows": failed}

    run_id = create_run(
        db,
        run_type="batch_vanilla_csv",
        input_payload={"filename": file.filename, "kind": "vanilla", "required_columns": required},
        output_payload={"summary": summary, "results": results},
        result_csv=result_csv,
        user_id=user_id,
    )

    preview = results[: min(50, len(results))]
    return BatchRunResponse(
        run_id=run_id,
        summary=BatchSummary(**summary),
        preview=preview,
        download_csv_url=f"/api/v1/runs/{run_id}/result.csv",
    )


@router.post("/call-spread/csv", response_model=BatchRunResponse)
def batch_call_spread_csv(file: UploadFile = File(...), db: Session = Depends(get_db), user_id: str | None = Depends(get_user_id)) -> BatchRunResponse:
    text = _read_upload_as_text(file)
    reader = csv.DictReader(io.StringIO(text))

    required = ["spot", "strike_long", "strike_short", "rate", "dividend_yield", "vol", "time_to_expiry", "quantity"]
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV must include a header row")
    missing = [c for c in required if c not in reader.fieldnames]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")

    results: list[dict[str, Any]] = []
    csv_rows: list[list[Any]] = []

    total = 0
    ok = 0
    failed = 0

    for idx, row in enumerate(reader, start=1):
        total += 1
        status = "ok"
        err = ""

        try:
            spot = _as_float(row, "spot")
            strike_long = _as_float(row, "strike_long")
            strike_short = _as_float(row, "strike_short")
            rate = _as_float(row, "rate")
            dividend_yield = _as_float(row, "dividend_yield")
            vol = _as_float(row, "vol")
            t = _as_float(row, "time_to_expiry")
            qty = _as_float(row, "quantity")

            res = call_spread_price_and_greeks(
                spot=spot,
                strike_long=strike_long,
                strike_short=strike_short,
                rate=rate,
                dividend_yield=dividend_yield,
                vol=vol,
                time_to_expiry=t,
            )

            out = {
                "price_per_unit": res.price,
                "price_total": res.price * qty,
                "delta": res.delta,
                "gamma": res.gamma,
                "vega": res.vega,
                "theta": res.theta,
                "rho": res.rho,
            }
            ok += 1
        except Exception as e:  # noqa: BLE001
            status = "error"
            err = str(e)
            out = {
                "price_per_unit": None,
                "price_total": None,
                "delta": None,
                "gamma": None,
                "vega": None,
                "theta": None,
                "rho": None,
            }
            failed += 1

        results.append(
            {
                "row_index": idx,
                "status": status,
                "error": err,
                "input": {k: row.get(k) for k in required},
                "output": out,
            }
        )

        csv_rows.append(
            [
                idx,
                status,
                err,
                out["price_per_unit"],
                out["price_total"],
                out["delta"],
                out["gamma"],
                out["vega"],
                out["theta"],
                out["rho"],
            ]
        )

    result_csv = _make_result_csv(
        ["row_index", "status", "error", "price_per_unit", "price_total", "delta", "gamma", "vega", "theta", "rho"],
        csv_rows,
    )

    summary = {"total_rows": total, "success_rows": ok, "failed_rows": failed}

    run_id = create_run(
        db,
        run_type="batch_call_spread_csv",
        input_payload={"filename": file.filename, "kind": "call_spread", "required_columns": required},
        output_payload={"summary": summary, "results": results},
        result_csv=result_csv,
        user_id=user_id,
    )

    preview = results[: min(50, len(results))]
    return BatchRunResponse(
        run_id=run_id,
        summary=BatchSummary(**summary),
        preview=preview,
        download_csv_url=f"/api/v1/runs/{run_id}/result.csv",
    )
