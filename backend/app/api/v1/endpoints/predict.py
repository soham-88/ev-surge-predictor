"""
POST /api/v1/predict
Calculates predicted load and recommended grid mitigation policies.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from app.core.security import get_current_user
from app.models.user import User

from app.core.config import TRANSFORMER_CAPACITY_KW
from app.models.ml_engine import engine
from app.models.optimizer import compute_mitigations
from app.schemas.telemetry import (
    PredictRequest,
    PredictResponse,
    RecommendedActions,
)
from app.core.weather_service import get_current_temperature
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/predict", response_model=PredictResponse)
async def predict_surge(req: PredictRequest, current_user: User = Depends(get_current_user)) -> PredictResponse:
    """Run XGBoost inference and return load forecast + mitigation policy."""

    hour = req.timestamp.hour + req.timestamp.minute / 60.0
    day_of_week = req.timestamp.weekday()

    try:
        actual_temp = get_current_temperature()
    except Exception as e:
        logger.warning(f"Using mock temperature fallback. Live fetch failed: {e}")
        actual_temp = req.ambient_temp_c

    predicted_load_kw, latency_ms, scaled_features = engine.predict(
        ambient_temp_c=actual_temp,
        traffic_inflow_index=req.traffic_inflow_index,
        active_plugs=req.active_plugs,
        grid_frequency_hz=req.grid_frequency_hz,
        load_lags_kw=req.load_lags_kw,
        hour=hour,
        day_of_week=day_of_week,
    )

    mitigations = compute_mitigations(predicted_load_kw, req.active_plugs)

    return PredictResponse(
        predicted_load_kw=round(predicted_load_kw, 1),
        transformer_capacity_kw=TRANSFORMER_CAPACITY_KW,
        capacity_utilization_pct=mitigations["capacity_utilization_pct"],
        surge_status=mitigations["surge_status"],
        recommended_actions=RecommendedActions(
            dynamic_tariff_multiplier=mitigations["dynamic_tariff_multiplier"],
            throttle_active=mitigations["throttle_active"],
            per_stall_cap_kw=mitigations["per_stall_cap_kw"],
            shed_stalls=mitigations["shed_stalls"],
        ),
        inference_latency_ms=round(latency_ms, 1),
    )
