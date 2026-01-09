from __future__ import annotations

import json
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db.models import PortfolioRecord, RunRecord, StressPackRecord, UserRecord


def _dumps(payload: Any) -> str:
    """Serialize payloads for DB storage.

    Why this exists: several parts of the app store Pydantic model_dump() output
    into SQLite (runs, portfolios, etc.). model_dump() can include objects like
    datetime/date (e.g. macro as-of dates / timeline months). The standard
    json.dumps can't serialize those by default.

    We defensively coerce common non-JSON types into JSON-friendly primitives so
    "save_run" never crashes at runtime.
    """

    def to_jsonable(x: Any) -> Any:  # noqa: ANN401
        if x is None or isinstance(x, (str, int, float, bool)):
            return x

        if isinstance(x, (date, datetime)):
            return x.isoformat()

        if isinstance(x, Decimal):
            return float(x)

        # Pydantic models (or similar) – prefer their model_dump() representation.
        md = getattr(x, "model_dump", None)
        if callable(md):
            try:
                return to_jsonable(md())
            except Exception:  # noqa: BLE001
                pass

        if isinstance(x, dict):
            return {str(k): to_jsonable(v) for k, v in x.items()}
        if isinstance(x, (list, tuple, set)):
            return [to_jsonable(v) for v in x]

        # Numpy scalars / arrays (optional dependency)
        try:  # pragma: no cover
            import numpy as np

            if isinstance(x, (np.integer, np.floating)):
                return x.item()
            if isinstance(x, np.ndarray):
                return x.tolist()
        except Exception:
            pass

        # Fallback: stringify
        return str(x)

    safe = to_jsonable(payload)
    return json.dumps(safe, ensure_ascii=False, separators=(",", ":"))


# -----------------
# Runs
# -----------------


def create_run(
    db: Session,
    *,
    run_type: str,
    input_payload: dict[str, Any],
    output_payload: dict[str, Any],
    result_csv: str | None = None,
    run_id: str | None = None,
    user_id: str | None = None,
) -> str:
    rid = run_id or str(uuid.uuid4())
    rec = RunRecord(
        run_id=rid,
        run_type=run_type,
        user_id=user_id,
        input_json=_dumps(input_payload),
        output_json=_dumps(output_payload),
        result_csv=result_csv,
    )
    db.add(rec)
    db.commit()
    return rid


def list_runs(
    db: Session,
    *,
    limit: int = 20,
    offset: int = 0,
    run_type: str | None = None,
    user_id: str | None = None,
) -> list[RunRecord]:
    q = db.query(RunRecord)
    if run_type:
        q = q.filter(RunRecord.run_type == run_type)
    if user_id is not None:
        # Backward compatibility: older records may have NULL user_id.
        q = q.filter(or_(RunRecord.user_id == user_id, RunRecord.user_id.is_(None)))
    q = q.order_by(RunRecord.created_at.desc(), RunRecord.id.desc())
    return q.offset(offset).limit(limit).all()


def get_run(db: Session, run_id: str, *, user_id: str | None = None) -> RunRecord | None:
    q = db.query(RunRecord).filter(RunRecord.run_id == run_id)
    if user_id is not None:
        # Backward compatibility: older records may have NULL user_id.
        q = q.filter(or_(RunRecord.user_id == user_id, RunRecord.user_id.is_(None)))
    return q.first()


# -----------------
# Portfolio storage
# -----------------


def create_portfolio(
    db: Session,
    *,
    name: str,
    definition: dict[str, Any],
    portfolio_id: str | None = None,
    user_id: str | None = None,
) -> str:
    pid = portfolio_id or str(uuid.uuid4())
    rec = PortfolioRecord(portfolio_id=pid, name=name, user_id=user_id, definition_json=_dumps(definition))
    db.add(rec)
    db.commit()
    return pid


def list_portfolios(
    db: Session,
    *,
    limit: int = 100,
    offset: int = 0,
    user_id: str | None = None,
) -> list[PortfolioRecord]:
    q = db.query(PortfolioRecord)
    if user_id is not None:
        q = q.filter(or_(PortfolioRecord.user_id == user_id, PortfolioRecord.user_id.is_(None)))
    q = q.order_by(PortfolioRecord.updated_at.desc(), PortfolioRecord.id.desc())
    return q.offset(offset).limit(limit).all()


def get_portfolio(db: Session, portfolio_id: str, *, user_id: str | None = None) -> PortfolioRecord | None:
    q = db.query(PortfolioRecord).filter(PortfolioRecord.portfolio_id == portfolio_id)
    if user_id is not None:
        q = q.filter(or_(PortfolioRecord.user_id == user_id, PortfolioRecord.user_id.is_(None)))
    return q.first()


def update_portfolio(db: Session, *, portfolio_id: str, name: str, definition: dict[str, Any], user_id: str | None = None) -> bool:
    rec = get_portfolio(db, portfolio_id, user_id=user_id)
    if not rec:
        return False
    # If this portfolio was created before profiles existed, it may have a NULL
    # user_id. On first update from a profile, "claim" it.
    if user_id is not None and rec.user_id is None:
        rec.user_id = user_id
    rec.name = name
    rec.definition_json = _dumps(definition)
    db.add(rec)
    db.commit()
    return True


def delete_portfolio(db: Session, *, portfolio_id: str, user_id: str | None = None) -> bool:
    rec = get_portfolio(db, portfolio_id, user_id=user_id)
    if not rec:
        return False
    # Allow deleting legacy (NULL user_id) records from any profile.
    db.delete(rec)
    db.commit()
    return True


# -----------------
# Users
# -----------------


def create_user(
    db: Session,
    *,
    display_name: str,
    email: str | None = None,
    user_id: str | None = None,
) -> str:
    uid = user_id or str(uuid.uuid4())
    rec = UserRecord(user_id=uid, display_name=display_name, email=email)
    db.add(rec)
    db.commit()
    return uid


def list_users(db: Session, *, limit: int = 100, offset: int = 0) -> list[UserRecord]:
    q = db.query(UserRecord).order_by(UserRecord.updated_at.desc(), UserRecord.id.desc())
    return q.offset(offset).limit(limit).all()


def get_user(db: Session, user_id: str) -> UserRecord | None:
    return db.query(UserRecord).filter(UserRecord.user_id == user_id).first()


def update_user(db: Session, *, user_id: str, display_name: str, email: str | None) -> bool:
    rec = get_user(db, user_id)
    if not rec:
        return False
    rec.display_name = display_name
    rec.email = email
    db.add(rec)
    db.commit()
    return True


def delete_user(db: Session, *, user_id: str) -> bool:
    rec = get_user(db, user_id)
    if not rec:
        return False
    # Allow deleting legacy (NULL user_id) portfolios from any profile.
    # For profile-owned portfolios, the query filter already enforces ownership.
    db.delete(rec)
    db.commit()
    return True


# -----------------
# Macro stress packs (scenario library)
# -----------------


def create_stress_pack(
    db: Session,
    *,
    name: str,
    description: str,
    scenario: dict[str, float],
    tags: list[str] | None = None,
    pack_id: str | None = None,
    user_id: str | None = None,
) -> str:
    pid = pack_id or str(uuid.uuid4())
    tags = tags or []
    rec = StressPackRecord(
        pack_id=pid,
        user_id=user_id,
        name=name,
        description=description or "",
        short_rate_shock_bps=float(scenario.get("short_rate_shock_bps", 0.0)),
        long_rate_shock_bps=float(scenario.get("long_rate_shock_bps", 0.0)),
        fx_spot_shock_pct=float(scenario.get("fx_spot_shock_pct", 0.0)),
        inflation_shock_pp=float(scenario.get("inflation_shock_pp", 0.0)),
        tags_json=_dumps(tags),
    )
    db.add(rec)
    db.commit()
    return pid


def list_stress_packs(
    db: Session,
    *,
    limit: int = 200,
    offset: int = 0,
    user_id: str | None = None,
    include_shared: bool = True,
) -> list[StressPackRecord]:
    q = db.query(StressPackRecord)
    if user_id is not None:
        if include_shared:
            q = q.filter(or_(StressPackRecord.user_id == user_id, StressPackRecord.user_id.is_(None)))
        else:
            q = q.filter(StressPackRecord.user_id == user_id)
    q = q.order_by(StressPackRecord.updated_at.desc(), StressPackRecord.id.desc())
    return q.offset(offset).limit(limit).all()


def get_stress_pack(db: Session, pack_id: str, *, user_id: str | None = None, include_shared: bool = True) -> StressPackRecord | None:
    q = db.query(StressPackRecord).filter(StressPackRecord.pack_id == pack_id)
    if user_id is not None:
        if include_shared:
            q = q.filter(or_(StressPackRecord.user_id == user_id, StressPackRecord.user_id.is_(None)))
        else:
            q = q.filter(StressPackRecord.user_id == user_id)
    return q.first()


def update_stress_pack(
    db: Session,
    *,
    pack_id: str,
    name: str,
    description: str,
    scenario: dict[str, float],
    tags: list[str] | None,
    user_id: str | None = None,
) -> bool:
    rec = get_stress_pack(db, pack_id, user_id=user_id, include_shared=False)
    if not rec:
        return False
    # If this portfolio was created before profiles existed, it may have a NULL
    # user_id. On first update from a profile, "claim" it.
    if user_id is not None and rec.user_id is None:
        rec.user_id = user_id
    rec.name = name
    rec.description = description or ""
    rec.short_rate_shock_bps = float(scenario.get("short_rate_shock_bps", 0.0))
    rec.long_rate_shock_bps = float(scenario.get("long_rate_shock_bps", 0.0))
    rec.fx_spot_shock_pct = float(scenario.get("fx_spot_shock_pct", 0.0))
    rec.inflation_shock_pp = float(scenario.get("inflation_shock_pp", 0.0))
    rec.tags_json = _dumps(tags or [])
    db.add(rec)
    db.commit()
    return True


def delete_stress_pack(db: Session, *, pack_id: str, user_id: str | None = None) -> bool:
    rec = get_stress_pack(db, pack_id, user_id=user_id, include_shared=False)
    if not rec:
        return False
    # Allow deleting legacy (NULL user_id) portfolios from any profile.
    # For profile-owned portfolios, the query filter already enforces ownership.
    db.delete(rec)
    db.commit()
    return True
