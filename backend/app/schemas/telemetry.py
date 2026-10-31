"""
Pydantic schemas for all API request/response contracts.
Matches Section 4 of the spec exactly.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  4.1  POST /api/v1/predict
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class PredictRequest(BaseModel):
    """Telemetry snapshot for a single prediction cycle."""
    timestamp: datetime
    ambient_temp_c: float = Field(..., description="Ambient temperature in Celsius")
    traffic_inflow_index: int = Field(..., ge=0, le=100, description="Local traffic density 0-100")
    active_plugs: int = Field(..., ge=0, le=8, description="Number of active charging bays")
    grid_frequency_hz: float = Field(
        ..., ge=45.0, le=55.0, description="Baseline grid frequency in Hz (allowed: 45.0 to 55.0 Hz)"
    )
    load_lags_kw: List[float] = Field(
        ..., min_length=4, max_length=4,
        description="Historical load lags [t-15m, t-30m, t-45m, t-60m] in kW"
    )


class RecommendedActions(BaseModel):
    """Autonomous grid mitigation policy."""
    dynamic_tariff_multiplier: float
    throttle_active: bool
    per_stall_cap_kw: float
    shed_stalls: List[int] = Field(default_factory=list)


class PredictResponse(BaseModel):
    """Prediction result with surge status and recommended actions."""
    predicted_load_kw: float
    transformer_capacity_kw: float
    capacity_utilization_pct: float
    surge_status: str = Field(..., description="NORMAL | WARNING | CRITICAL")
    recommended_actions: RecommendedActions
    inference_latency_ms: float


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  4.2  POST /api/v1/explain
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class Attribution(BaseModel):
    """Single SHAP feature attribution."""
    feature: str
    value: float
    shap_delta_kw: float


class ExplainResponse(BaseModel):
    """Local feature attribution for the current prediction."""
    base_value_kw: float
    predicted_value_kw: float
    attributions: List[Attribution]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  4.3  POST /api/v1/simulate
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class SimulateRequest(BaseModel):
    """What-if stress test perturbation parameters."""
    temp_delta_c: float = Field(0.0, description="Temperature perturbation in Celsius")
    traffic_surge_pct: float = Field(0.0, ge=0, le=100, description="Traffic surge percentage")
    forced_outage_stalls: List[int] = Field(
        default_factory=list, description="Bay indices forced offline"
    )


class TimelinePoint(BaseModel):
    """A single point on the simulation timeline."""
    timestamp: str
    baseline_kw: float
    simulated_kw: float


class DispatchedMitigations(BaseModel):
    """Mitigations dispatched during simulation."""
    dynamic_tariff_multiplier: float
    throttled_stalls: List[int] = Field(default_factory=list)


class SimulateResponse(BaseModel):
    """Full simulation result with timeline and mitigations."""
    simulation_id: str
    baseline_peak_kw: float
    simulated_peak_kw: float
    peak_time_delta_min: int
    surge_risk: str
    timeline: List[TimelinePoint]
    dispatched_mitigations: DispatchedMitigations


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  4.4  GET /api/v1/metrics
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class ModelMetrics(BaseModel):
    """Evaluation metrics for a single model."""
    name: str
    mae_kw: float
    rmse_kw: float
    surge_recall_pct: float
    latency_ms: float


class MetricsResponse(BaseModel):
    """Comparative benchmark metrics for all models."""
    models: List[ModelMetrics]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  4.5  POST /api/v1/predict/batch
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class BatchSummary(BaseModel):
    """Summary statistics for the batch prediction."""
    peak_predicted_kw: float
    peak_timestamp: str
    critical_events_count: int
    avg_mae_vs_actual_kw: Optional[float] = Field(None, description="MAE against actual_kw (which represents the actual load 2 hours ahead)")


class BatchPrediction(BaseModel):
    """A single prediction result row from the batch."""
    timestamp: str
    actual_kw: Optional[float] = Field(None, description="Actual load at t+2h (target horizon)")
    predicted_kw: float
    surge_status: str


class BatchPredictResponse(BaseModel):
    """Result of a vectorized batch prediction run."""
    batch_id: str
    rows_processed: int
    rows_failed: int
    summary: BatchSummary
    predictions: List[BatchPrediction]
    download_url: str

