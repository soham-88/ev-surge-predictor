"""
GET /api/v1/metrics
Returns comparative benchmark metrics for XGBoost (primary) and LSTM (benchmark).

Both sets of metrics are REAL — loaded from .joblib artifacts produced by
actual training runs (train.py for XGBoost, train_lstm.py for LSTM).
"""

from __future__ import annotations

import joblib
from pathlib import Path

from fastapi import APIRouter, Depends
from app.core.security import get_current_user
from app.models.user import User
from app.core.config import SAVED_MODELS_DIR

from app.models.ml_engine import engine
from app.schemas.telemetry import MetricsResponse, ModelMetrics

router = APIRouter()


def _load_xgb_metrics() -> dict:
    """Load XGBoost training metrics from disk."""
    path = SAVED_MODELS_DIR / "training_metrics.joblib"
    if path.exists():
        return joblib.load(path)
    # Fallback to engine singleton if file not found
    return engine.training_metrics


def _load_lstm_metrics() -> dict | None:
    """Load LSTM benchmark metrics from disk, if available."""
    path = SAVED_MODELS_DIR / "lstm_metrics.joblib"
    if path.exists():
        return joblib.load(path)
    return None


@router.get("/metrics", response_model=MetricsResponse)
async def get_metrics(current_user: User = Depends(get_current_user)) -> MetricsResponse:
    """Return comparative model evaluation metrics.

    Both XGBoost and LSTM metrics come from actual training evaluations
    stored in .joblib artifacts under saved_models/.
    """
    xgb_metrics = _load_xgb_metrics()
    lstm_metrics = _load_lstm_metrics()

    models = [
        ModelMetrics(
            name="XGBoost Regressor (Primary)",
            mae_kw=xgb_metrics.get("mae_kw", 0.0),
            rmse_kw=xgb_metrics.get("rmse_kw", 0.0),
            surge_recall_pct=xgb_metrics.get("surge_recall_pct", 0.0),
            latency_ms=xgb_metrics.get("latency_ms", 0.0),
        ),
    ]

    if lstm_metrics:
        models.append(
            ModelMetrics(
                name="PyTorch LSTM Sequence (Benchmark)",
                mae_kw=lstm_metrics.get("mae_kw", 0.0),
                rmse_kw=lstm_metrics.get("rmse_kw", 0.0),
                surge_recall_pct=lstm_metrics.get("surge_recall_pct", 0.0),
                latency_ms=lstm_metrics.get("latency_ms", 0.0),
            )
        )

    return MetricsResponse(models=models)
