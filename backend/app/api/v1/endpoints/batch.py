"""
POST /api/v1/predict/batch
Accepts multipart/form-data CSV, runs vectorized inference, and serves results.
"""

import io
import uuid
import pandas as pd
import numpy as np
from typing import Dict, Any

from fastapi import APIRouter, File, UploadFile, HTTPException, Depends
from app.core.security import get_current_user
from app.models.user import User
from fastapi.responses import StreamingResponse

from app.core.config import TRANSFORMER_CAPACITY_KW
from app.models.ml_engine import engine
from app.models.optimizer import classify_surge
from app.schemas.telemetry import (
    BatchPredictResponse,
    BatchPrediction,
    BatchSummary
)

router = APIRouter()

# In-memory cache for CSV downloads. In production, this would be S3/Redis.
_batch_results_cache: Dict[str, pd.DataFrame] = {}


@router.post("/predict/batch", response_model=BatchPredictResponse)
async def predict_batch(file: UploadFile = File(...), current_user: User = Depends(get_current_user)) -> BatchPredictResponse:
    """Run vectorized batch prediction on uploaded CSV."""
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only .csv files are supported.")

    contents = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {e}")

    expected_columns = [
        "timestamp",
        "ambient_temp_c",
        "traffic_inflow_index",
        "active_plugs",
        "grid_frequency_hz",
        "load_lag_15m",
        "load_lag_30m",
        "load_lag_45m",
        "load_lag_60m"
    ]

    missing = [col for col in expected_columns if col not in df.columns]
    if missing:
        raise HTTPException(
            status_code=422,
            detail={"message": "Missing required columns", "expected_columns": missing}
        )

    # Validate grid frequency range (nominal 50 Hz, allowed: 45.0 to 55.0 Hz)
    freq_series = pd.to_numeric(df['grid_frequency_hz'], errors='coerce')
    out_of_range_mask = (freq_series < 45.0) | (freq_series > 55.0) | freq_series.isna()
    out_of_range_count = int(out_of_range_mask.sum())
    if out_of_range_count > 0:
        min_freq = float(freq_series.min())
        max_freq = float(freq_series.max())
        raise HTTPException(
            status_code=422,
            detail=(
                f"Grid frequency out of range: {out_of_range_count} row{'s' if out_of_range_count != 1 else ''} "
                f"with frequency between {min_freq:.2f} Hz and {max_freq:.2f} Hz "
                f"(allowed range: 45.0 to 55.0 Hz)."
            )
        )

    # Process vectorized inference
    try:
        preds, latency_ms = engine.predict_batch(df)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference failed: {e}")

    df['predicted_kw'] = np.round(preds, 1)

    # Vectorized surge status classification
    capacity_pct = (df['predicted_kw'] / TRANSFORMER_CAPACITY_KW) * 100
    conditions = [
        capacity_pct >= 80.0,
        capacity_pct >= 65.0
    ]
    choices = ['CRITICAL', 'WARNING']
    df['surge_status'] = np.select(conditions, choices, default='NORMAL')

    # Summary Stats
    peak_idx = df['predicted_kw'].idxmax()
    peak_predicted_kw = df.loc[peak_idx, 'predicted_kw']
    peak_timestamp = df.loc[peak_idx, 'timestamp']
    critical_events_count = (df['surge_status'] == 'CRITICAL').sum()

    avg_mae = None
    if 'actual_kw' in df.columns:
        mae = (df['actual_kw'] - df['predicted_kw']).abs().mean()
        avg_mae = round(float(mae), 2)

    # Prepare predictions list
    predictions = []
    for _, row in df.iterrows():
        # Handle nan in actual_kw if it's there
        actual = None
        if 'actual_kw' in row and pd.notna(row['actual_kw']):
            actual = float(row['actual_kw'])
            
        predictions.append(
            BatchPrediction(
                timestamp=str(row['timestamp']),
                actual_kw=actual,
                predicted_kw=float(row['predicted_kw']),
                surge_status=str(row['surge_status'])
            )
        )

    batch_id = uuid.uuid4().hex
    _batch_results_cache[batch_id] = df

    return BatchPredictResponse(
        batch_id=batch_id,
        rows_processed=len(df),
        rows_failed=0,
        summary=BatchSummary(
            peak_predicted_kw=round(float(peak_predicted_kw), 1),
            peak_timestamp=str(peak_timestamp),
            critical_events_count=int(critical_events_count),
            avg_mae_vs_actual_kw=avg_mae
        ),
        predictions=predictions,
        download_url=f"/api/v1/predict/batch/download/{batch_id}"
    )


@router.get("/predict/batch/download/{batch_id}")
async def download_batch_csv(batch_id: str, current_user: User = Depends(get_current_user)):
    """Download the annotated CSV results."""
    if batch_id not in _batch_results_cache:
        raise HTTPException(status_code=404, detail="Batch ID not found or expired.")

    df = _batch_results_cache[batch_id]
    
    stream = io.StringIO()
    df.to_csv(stream, index=False)
    response = StreamingResponse(iter([stream.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = f"attachment; filename=batch_results_{batch_id}.csv"
    return response
