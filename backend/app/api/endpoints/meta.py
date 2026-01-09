from __future__ import annotations

from fastapi import APIRouter

from app.meta.instrument_catalog import CATALOG


router = APIRouter()


@router.get("/instruments")
def get_instrument_catalog() -> dict[str, object]:
    """Return instrument/method metadata used by the frontend.

    This is static metadata: labels, supported methods, and input-field definitions.
    """
    return CATALOG
