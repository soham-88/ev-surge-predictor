"""
API v1 router — aggregates all endpoint routers.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import explain, metrics, predict, simulate, weather, batch, auth

router = APIRouter(prefix="/api/v1")

router.include_router(predict.router, tags=["Prediction"])
router.include_router(explain.router, tags=["Explainability"])
router.include_router(simulate.router, tags=["Simulation"])
router.include_router(metrics.router, tags=["Metrics"])
router.include_router(weather.router, tags=["Weather"])
router.include_router(batch.router, tags=["Batch"])
router.include_router(auth.router, prefix="/auth", tags=["Auth"])
