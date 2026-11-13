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
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

router = APIRouter()


def _log_incident_if_needed(
    surge_status: str,
    predicted_load_kw: float,
    capacity_utilization_pct: float,
    tariff_multiplier: float,
    throttled_count: int,
    shed_count: int,
    operator_username: str | None,
) -> None:
    if surge_status not in ("WARNING", "CRITICAL"):
        return
    try:
        from app.core.database import SessionLocal
        from app.models.incident import Incident

        db = SessionLocal()
        try:
            ten_secs_ago = datetime.now(timezone.utc) - timedelta(seconds=10)
            recent = (
                db.query(Incident)
                .filter(Incident.surge_status == surge_status, Incident.timestamp >= ten_secs_ago)
                .first()
            )
            if not recent:
                incident = Incident(
                    surge_status=surge_status,
                    predicted_load_kw=round(predicted_load_kw, 1),
                    capacity_utilization_pct=round(capacity_utilization_pct, 1),
                    tariff_multiplier=round(tariff_multiplier, 2),
                    throttled_bays_count=throttled_count,
                    shed_bays_count=shed_count,
                    operator_username=operator_username,
                )
                db.add(incident)
                db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"Failed to record incident to SQLite: {e}")


@router.post("/predict", response_model=PredictResponse)
async def predict_surge(req: PredictRequest, current_user: User = Depends(get_current_user)) -> PredictResponse:
    """Run XGBoost inference and return load forecast + mitigation policy."""

    hour = req.timestamp.hour + req.timestamp.minute / 60.0
    day_of_week = req.timestamp.weekday()

    # Use the client-provided ambient temperature directly to guarantee consistency
    # with the TreeSHAP /explain endpoint and historical evaluations.
    ambient_temp = req.ambient_temp_c

    predicted_load_kw, latency_ms, scaled_features = engine.predict(
        ambient_temp_c=ambient_temp,
        traffic_inflow_index=req.traffic_inflow_index,
        active_plugs=req.active_plugs,
        grid_frequency_hz=req.grid_frequency_hz,
        load_lags_kw=req.load_lags_kw,
        hour=hour,
        day_of_week=day_of_week,
    )

    mitigations = compute_mitigations(predicted_load_kw, req.active_plugs)
    lower_bound_kw, upper_bound_kw = engine.get_prediction_interval(predicted_load_kw)

    _log_incident_if_needed(
        surge_status=mitigations["surge_status"],
        predicted_load_kw=predicted_load_kw,
        capacity_utilization_pct=mitigations["capacity_utilization_pct"],
        tariff_multiplier=mitigations["dynamic_tariff_multiplier"],
        throttled_count=4 if mitigations.get("throttle_active") else 0,
        shed_count=len(mitigations["shed_stalls"]),
        operator_username=current_user.username if current_user else None,
    )

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
        lower_bound_kw=lower_bound_kw,
        upper_bound_kw=upper_bound_kw,
    )
