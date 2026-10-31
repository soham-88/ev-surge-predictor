"""
POST /api/v1/explain
Returns real-time local feature attribution (SHAP) for the current prediction.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from app.core.security import get_current_user
from app.models.user import User

from app.models.ml_engine import engine
from app.schemas.telemetry import (
    Attribution,
    ExplainResponse,
    PredictRequest,
)

router = APIRouter()


@router.post("/explain", response_model=ExplainResponse)
async def explain_prediction(req: PredictRequest, current_user: User = Depends(get_current_user)) -> ExplainResponse:
    """Compute TreeSHAP attributions for the given telemetry snapshot."""

    hour = req.timestamp.hour + req.timestamp.minute / 60.0
    day_of_week = req.timestamp.weekday()

    predicted_load_kw, _, scaled_features = engine.predict(
        ambient_temp_c=req.ambient_temp_c,
        traffic_inflow_index=req.traffic_inflow_index,
        active_plugs=req.active_plugs,
        grid_frequency_hz=req.grid_frequency_hz,
        load_lags_kw=req.load_lags_kw,
        hour=hour,
        day_of_week=day_of_week,
    )

    base_value, attributions = engine.explain(scaled_features)

    return ExplainResponse(
        base_value_kw=round(base_value, 4),
        predicted_value_kw=round(predicted_load_kw, 4),
        attributions=[
            Attribution(
                feature=a["feature"],
                value=a["value"],
                shap_delta_kw=a["shap_delta_kw"],
            )
            for a in attributions
        ],
    )
