from __future__ import annotations

from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from app.models.ml_engine import assemble_features_df


def test_interval_calibration_artifact_and_coverage():
    artifact_path = Path(__file__).resolve().parent.parent / "saved_models" / "interval_calibration.joblib"
    assert artifact_path.exists(), f"Missing calibration artifact at {artifact_path}"

    data = joblib.load(artifact_path)
    assert "q10_kw" in data
    assert "q90_kw" in data
    assert "coverage" in data
    assert "n_test" in data
    assert "bins" in data

    bins = data["bins"]
    assert len(bins) == 3, f"Expected 3 calibration bins, got {len(bins)}"
    assert bins[0].get("pred_min_kw") is None and bins[0].get("pred_max_kw") == 100.0
    assert bins[1].get("pred_min_kw") == 100.0 and bins[1].get("pred_max_kw") == 160.0
    assert bins[2].get("pred_min_kw") == 160.0 and bins[2].get("pred_max_kw") is None

    coverage = float(data["coverage"])
    assert 0.78 <= coverage <= 0.82, f"Expected coverage between 0.78 and 0.82, got {coverage}"
    assert data["q10_kw"] < 0, f"Expected negative q10 residual, got {data['q10_kw']}"
    assert data["q90_kw"] > 0, f"Expected positive q90 residual, got {data['q90_kw']}"
    assert data["n_test"] > 1000


def test_interval_calibration_live_resimulation():
    saved_models_dir = Path(__file__).resolve().parent.parent / "saved_models"
    model = joblib.load(saved_models_dir / "xgboost_model.joblib")
    cal = joblib.load(saved_models_dir / "interval_calibration.joblib")
    how_table = joblib.load(saved_models_dir / "hour_of_week_mean.joblib")

    fixture_path = Path(__file__).resolve().parent / "fixtures" / "v2_test_sample.csv"
    assert fixture_path.exists(), f"Missing test fixture at {fixture_path}"
    df = pd.read_csv(fixture_path)
    df["timestamp"] = pd.to_datetime(df["timestamp"])

    feats_df = assemble_features_df(df, how_table=how_table)
    y_pred = model.predict(feats_df.values.astype(float))
    y_test = (df["target_load_2h"] if "target_load_2h" in df.columns else df["target_load_t2h"]).values

    bins = cal["bins"]
    lower_bounds = []
    upper_bounds = []
    for p in y_pred:
        chosen_bin = None
        for b in bins:
            p_min = b.get("pred_min_kw")
            p_max = b.get("pred_max_kw")
            if p_min is None and p_max is not None and p < p_max:
                chosen_bin = b
                break
            elif p_min is not None and p_max is not None and p_min <= p < p_max:
                chosen_bin = b
                break
            elif p_min is not None and p_max is None and p >= p_min:
                chosen_bin = b
                break
        if chosen_bin is None:
            chosen_bin = bins[-1]

        lower = max(0.0, float(p + chosen_bin["q10_kw"]))
        upper = max(float(p), float(p + chosen_bin["q90_kw"]))
        lower_bounds.append(lower)
        upper_bounds.append(upper)

    lower_arr = np.array(lower_bounds)
    upper_arr = np.array(upper_bounds)
    assert np.all(lower_arr >= 0.0), "All lower bounds must be non-negative"

    empirical_coverage = float(((y_test >= lower_arr) & (y_test <= upper_arr)).mean())
    assert 0.70 <= empirical_coverage <= 0.90, (
        f"Recomputed empirical coverage {empirical_coverage:.4f} outside [0.70, 0.90]"
    )


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
