from __future__ import annotations

from pathlib import Path
import joblib
import numpy as np
from fastapi.testclient import TestClient

from backend.pipeline.train import (
    FEATURE_COLUMNS,
    TARGET_COLUMN,
    engineer_features,
    synthesize_telemetry,
)


def test_interval_calibration_artifact_and_coverage():
    artifact_path = Path(__file__).resolve().parent.parent / "saved_models" / "interval_calibration.joblib"
    assert artifact_path.exists(), f"Missing calibration artifact at {artifact_path}"

    data = joblib.load(artifact_path)
    assert "q10_kw" in data
    assert "q90_kw" in data
    assert "coverage" in data
    assert "n_test" in data

    coverage = float(data["coverage"])
    assert 0.78 <= coverage <= 0.82, f"Expected coverage between 0.78 and 0.82, got {coverage}"
    assert data["q10_kw"] < 0, f"Expected negative q10 residual, got {data['q10_kw']}"
    assert data["q90_kw"] > 0, f"Expected positive q90 residual, got {data['q90_kw']}"
    assert data["n_test"] > 1000


def test_interval_calibration_live_resimulation():
    saved_models_dir = Path(__file__).resolve().parent.parent / "saved_models"
    model = joblib.load(saved_models_dir / "xgboost_model.joblib")
    scaler = joblib.load(saved_models_dir / "scaler.joblib")
    cal = joblib.load(saved_models_dir / "interval_calibration.joblib")

    df = synthesize_telemetry(n_days=90, seed=42)
    df = engineer_features(df)
    split_idx = int(len(df) * 0.8)
    test_df = df.iloc[split_idx:].copy()

    X_test = scaler.transform(test_df[FEATURE_COLUMNS])
    y_test = test_df[TARGET_COLUMN].values
    y_pred = model.predict(X_test)

    residuals = y_test - y_pred
    empirical_coverage = float(((residuals >= cal["q10_kw"]) & (residuals <= cal["q90_kw"])).mean())
    assert 0.78 <= empirical_coverage <= 0.82, f"Recomputed empirical coverage {empirical_coverage} outside [0.78, 0.82]"


def test_predict_endpoint_returns_dynamic_uncertainty_bounds(client: TestClient, operator_headers: dict[str, str]):
    payload = {
        "timestamp": "2026-10-31T14:30:00Z",
        "ambient_temp_c": 32.5,
        "traffic_inflow_index": 65,
        "active_plugs": 6,
        "grid_frequency_hz": 49.92,
        "load_lags_kw": [145.2, 140.0, 138.5, 130.0],
    }

    resp = client.post("/api/v1/predict", json=payload, headers=operator_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert "lower_bound_kw" in data
    assert "upper_bound_kw" in data
    assert "predicted_load_kw" in data

    predicted = data["predicted_load_kw"]
    lower = data["lower_bound_kw"]
    upper = data["upper_bound_kw"]

    assert lower >= 0.0, f"Lower bound {lower} must not be negative"
    assert lower <= predicted <= upper, f"Expected {lower} <= {predicted} <= {upper}"

