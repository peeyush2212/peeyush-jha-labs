from __future__ import annotations

from collections.abc import Generator

from fastapi import Header, Request
from sqlalchemy.orm import Session


def get_db(request: Request) -> Generator[Session, None, None]:
    """FastAPI dependency to get a database session."""
    db = request.app.state.db.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_user_id(x_user_id: str | None = Header(default=None, alias="X-User-Id")) -> str | None:
    """Optional per-profile scoping.

    The UI stores the active profile ID in the browser and sends it on every request.
    """

    if not x_user_id:
        return None
    x_user_id = x_user_id.strip()
    if not x_user_id:
        return None
    # Keep it defensive; we don't enforce UUID strictly in the local build.
    if len(x_user_id) > 64:
        return None
    return x_user_id
