from fastapi import APIRouter

from app.api.endpoints import (
    batch,
    capbud,
    macro,
    meta,
    portfolio,
    portfolios,
    pricing,
    runs,
    scenario,
    strategy,
    tax,
    users,
)

api_router = APIRouter()

api_router.include_router(pricing.router, prefix="/v1/pricing", tags=["pricing"])
api_router.include_router(scenario.router, prefix="/v1/scenario", tags=["scenario"])
api_router.include_router(portfolio.router, prefix="/v1/portfolio", tags=["portfolio"])
api_router.include_router(portfolios.router, prefix="/v1/portfolios", tags=["portfolios"])
api_router.include_router(meta.router, prefix="/v1/meta", tags=["meta"])
api_router.include_router(batch.router, prefix="/v1/batch", tags=["batch"])
api_router.include_router(runs.router, prefix="/v1/runs", tags=["runs"])
api_router.include_router(strategy.router, prefix="/v1/strategy", tags=["strategy"])
api_router.include_router(macro.router, prefix="/v1/macro", tags=["macro"])
api_router.include_router(tax.router, prefix="/v1/tax", tags=["tax"])
api_router.include_router(capbud.router, prefix="/v1/capbud", tags=["capbud"])
api_router.include_router(users.router, prefix="/v1/users", tags=["users"])
