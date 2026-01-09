from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.deps import get_db, get_user_id
from app.db.repository import (
    create_run,
    create_stress_pack,
    delete_stress_pack,
    get_stress_pack,
    list_stress_packs,
    update_stress_pack,
)
from app.schemas.macro import (
    MacroCompareRequest,
    MacroCompareResponse,
    MacroGridRequest,
    MacroGridResponse,
    MacroScenarioRequest,
    MacroScenarioResult,
    MacroSeriesMeta,
    MacroSeriesResponse,
    MacroTimelineResponse,
    StressPack,
    StressPackCreateRequest,
    StressPackUpdateRequest,
)
from app.services import macro_data
from app.services.macro_scenario import analyze_compare, analyze_scenario, build_grid
from app.services.stress_packs import builtin_stress_packs

router = APIRouter()


@router.get("/series", response_model=list[MacroSeriesMeta])
def list_series() -> list[MacroSeriesMeta]:
    """List available macro series (bundled snapshot + optional cache)."""
    return [MacroSeriesMeta(**meta) for meta in macro_data.list_series()]

@router.get("/series/{series_id}", response_model=MacroSeriesResponse)
def get_series(series_id: str) -> MacroSeriesResponse:
    meta = macro_data.get_series_meta(series_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Unknown series")
    points = macro_data.get_series_points(series_id)
    return MacroSeriesResponse(series=MacroSeriesMeta(**meta), points=points)


@router.get("/timeline", response_model=MacroTimelineResponse)
def get_timeline(months: int = 60) -> MacroTimelineResponse:
    months = max(6, min(months, 240))
    pts = macro_data.build_combined_timeline(months)
    return MacroTimelineResponse(points=pts)


@router.post("/refresh")
def refresh_cache(series_id: str | None = None) -> dict[str, str]:
    """UI hook: refresh macro data (no-op unless you implement caching)."""
    # In this build, series are fetched on-demand via FRED graph endpoints.
    # No persistent cache is needed.
    return {"status": "ok"}


@router.post("/scenario", response_model=MacroScenarioResult)
def run_macro_scenario(
    req: MacroScenarioRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> MacroScenarioResult:
    result, csv_text = analyze_scenario(req)

    if req.save_run:
        run_id = create_run(
            db,
            run_type="macro.scenario",
            input_payload=req.model_dump(),
            output_payload=result.model_dump(),
            result_csv=csv_text,
            user_id=user_id,
        )
        result.run_id = run_id

    return result


@router.post("/grid", response_model=MacroGridResponse)
def run_macro_grid(
    req: MacroGridRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> MacroGridResponse:
    result, csv_text = build_grid(req)

    if req.save_run:
        run_id = create_run(
            db,
            run_type="macro.grid",
            input_payload=req.model_dump(),
            output_payload=result.model_dump(),
            result_csv=csv_text,
            user_id=user_id,
        )
        result.run_id = run_id

    return result


@router.post("/compare", response_model=MacroCompareResponse)
def compare_scenarios(
    req: MacroCompareRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> MacroCompareResponse:
    result, csv_text = analyze_compare(req)

    if req.save_run:
        run_id = create_run(
            db,
            run_type="macro.compare",
            input_payload=req.model_dump(),
            output_payload=result.model_dump(),
            result_csv=csv_text,
            user_id=user_id,
        )
        result.run_id = run_id

    return result


# -----------------
# Scenario library (stress packs)
# -----------------


def _pack_row_to_schema(rec, *, is_builtin: bool = False) -> StressPack:
    try:
        tags = json.loads(rec.tags_json) if getattr(rec, "tags_json", None) else []
    except Exception:  # noqa: BLE001
        tags = []

    scenario = {
        "short_rate_shock_bps": float(getattr(rec, "short_rate_shock_bps", 0.0)),
        "long_rate_shock_bps": float(getattr(rec, "long_rate_shock_bps", 0.0)),
        "fx_spot_shock_pct": float(getattr(rec, "fx_spot_shock_pct", 0.0)),
        "inflation_shock_pp": float(getattr(rec, "inflation_shock_pp", 0.0)),
    }

    return StressPack(
        pack_id=rec.pack_id,
        name=rec.name,
        description=rec.description,
        tags=tags,
        scenario=scenario,
        is_builtin=is_builtin,
        owner_user_id=getattr(rec, "user_id", None),
    )


@router.get("/stress-packs", response_model=list[StressPack])
def list_stress_packs_endpoint(
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> list[StressPack]:
    packs: list[StressPack] = []

    # Built-ins (code)
    packs.extend(builtin_stress_packs())

    # User-saved packs (DB)
    rows = list_stress_packs(db, user_id=user_id, include_shared=True)
    for r in rows:
        packs.append(
            StressPack(
                pack_id=r.pack_id,
                name=r.name,
                description=r.description,
                tags=json.loads(r.tags_json or "[]"),
                scenario={
                    "short_rate_shock_bps": r.short_rate_shock_bps,
                    "long_rate_shock_bps": r.long_rate_shock_bps,
                    "fx_spot_shock_pct": r.fx_spot_shock_pct,
                    "inflation_shock_pp": r.inflation_shock_pp,
                },
                is_builtin=False,
                owner_user_id=r.user_id,
            )
        )

    return packs


@router.post("/stress-packs", response_model=StressPack)
def create_stress_pack_endpoint(
    req: StressPackCreateRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> StressPack:
    pid = create_stress_pack(
        db,
        name=req.name.strip(),
        description=req.description or "",
        scenario=req.scenario.model_dump(),
        tags=req.tags,
        user_id=user_id,
    )
    rec = get_stress_pack(db, pid, user_id=user_id, include_shared=True)
    if not rec:
        raise HTTPException(status_code=500, detail="Failed to create stress pack")

    return StressPack(
        pack_id=rec.pack_id,
        name=rec.name,
        description=rec.description,
        tags=json.loads(rec.tags_json or "[]"),
        scenario={
            "short_rate_shock_bps": rec.short_rate_shock_bps,
            "long_rate_shock_bps": rec.long_rate_shock_bps,
            "fx_spot_shock_pct": rec.fx_spot_shock_pct,
            "inflation_shock_pp": rec.inflation_shock_pp,
        },
        is_builtin=False,
        owner_user_id=rec.user_id,
    )


@router.put("/stress-packs/{pack_id}", response_model=StressPack)
def update_stress_pack_endpoint(
    pack_id: str,
    req: StressPackUpdateRequest,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> StressPack:
    if pack_id.startswith("builtin:"):
        raise HTTPException(status_code=400, detail="Built-in packs cannot be modified")

    ok = update_stress_pack(
        db,
        pack_id=pack_id,
        name=req.name.strip(),
        description=req.description or "",
        scenario=req.scenario.model_dump(),
        tags=req.tags,
        user_id=user_id,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Stress pack not found")

    rec = get_stress_pack(db, pack_id, user_id=user_id, include_shared=False)
    if rec is None:
        raise HTTPException(status_code=500, detail="Failed to load stress pack after update")
    return StressPack(
        pack_id=rec.pack_id,
        name=rec.name,
        description=rec.description,
        tags=json.loads(rec.tags_json or "[]"),
        scenario={
            "short_rate_shock_bps": rec.short_rate_shock_bps,
            "long_rate_shock_bps": rec.long_rate_shock_bps,
            "fx_spot_shock_pct": rec.fx_spot_shock_pct,
            "inflation_shock_pp": rec.inflation_shock_pp,
        },
        is_builtin=False,
        owner_user_id=rec.user_id,
    )


@router.delete("/stress-packs/{pack_id}")
def delete_stress_pack_endpoint(
    pack_id: str,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(get_user_id),
) -> dict[str, str]:
    if pack_id.startswith("builtin:"):
        raise HTTPException(status_code=400, detail="Built-in packs cannot be deleted")

    ok = delete_stress_pack(db, pack_id=pack_id, user_id=user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Stress pack not found")

    return {"status": "deleted"}
