from __future__ import annotations

from fastapi.testclient import TestClient


SAMPLE_TELEMETRY = {
    "timestamp": "2026-10-31T14:30:00Z",
    "ambient_temp_c": 32.5,
    "traffic_inflow_index": 65,
    "active_plugs": 6,
    "grid_frequency_hz": 49.92,
    "load_lags_kw": [145.2, 140.0, 138.5, 130.0],
}


def test_predict_nominal_50hz(client: TestClient, operator_headers: dict[str, str]):
    resp = client.post(
        "/api/v1/predict",
        json=SAMPLE_TELEMETRY,
        headers=operator_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # Schema & risk band validation
    assert "predicted_load_kw" in data
    assert "transformer_capacity_kw" in data
    assert "capacity_utilization_pct" in data
    assert "surge_status" in data
    assert data["surge_status"] in ["NORMAL", "WARNING", "CRITICAL"]
    assert "recommended_actions" in data
    assert "inference_latency_ms" in data

    actions = data["recommended_actions"]
    assert "dynamic_tariff_multiplier" in actions
    assert "throttle_active" in actions
    assert "per_stall_cap_kw" in actions
    assert "shed_stalls" in actions


def test_predict_frequency_out_of_range_rejected(
    client: TestClient, operator_headers: dict[str, str]
):
    # 59.92 Hz (legacy 60 Hz system) must be rejected with 422
    legacy_payload = dict(SAMPLE_TELEMETRY)
    legacy_payload["grid_frequency_hz"] = 59.92

    resp = client.post(
        "/api/v1/predict",
        json=legacy_payload,
        headers=operator_headers,
    )
    assert resp.status_code == 422, f"Expected 422 for 59.92 Hz, got {resp.status_code}"


def test_explain_shap_additivity(
    client: TestClient, operator_headers: dict[str, str]
):
    resp = client.post(
        "/api/v1/explain",
        json=SAMPLE_TELEMETRY,
        headers=operator_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert "base_value_kw" in data
    assert "predicted_value_kw" in data
    assert "attributions" in data
    assert len(data["attributions"]) == 17

    base = data["base_value_kw"]
    pred = data["predicted_value_kw"]
    sum_shap = sum(a["shap_delta_kw"] for a in data["attributions"])

    # TreeSHAP exact additivity: base + sum(shap_delta) == predicted_value within 0.01 kW
    discrepancy = abs((base + sum_shap) - pred)
    assert discrepancy <= 0.01, f"SHAP additivity violated: base={base}, sum_shap={sum_shap}, pred={pred}, diff={discrepancy}"


def test_explain_frequency_out_of_range_rejected(
    client: TestClient, operator_headers: dict[str, str]
):
    legacy_payload = dict(SAMPLE_TELEMETRY)
    legacy_payload["grid_frequency_hz"] = 59.92

    resp = client.post(
        "/api/v1/explain",
        json=legacy_payload,
        headers=operator_headers,
    )
    assert resp.status_code == 422


def test_predict_explain_parity(
    client: TestClient, operator_headers: dict[str, str]
):
    """Verify /predict and /explain yield identical forecasts for identical telemetry."""
    resp_pred = client.post(
        "/api/v1/predict",
        json=SAMPLE_TELEMETRY,
        headers=operator_headers,
    )
    assert resp_pred.status_code == 200
    pred_val = resp_pred.json()["predicted_load_kw"]

    resp_expl = client.post(
        "/api/v1/explain",
        json=SAMPLE_TELEMETRY,
        headers=operator_headers,
    )
    assert resp_expl.status_code == 200
    expl_val = resp_expl.json()["predicted_value_kw"]

    # Round both to 1 decimal place and assert exact match
    assert round(pred_val, 1) == round(expl_val, 1), (
        f"Parity mismatch: /predict got {pred_val} kW, but /explain got {expl_val} kW"
    )


def test_explain_global_endpoint(
    client: TestClient, operator_headers: dict[str, str]
):
    """Verify GET /api/v1/explain/global returns 15 ranked features and valid percentages."""
    resp = client.get("/api/v1/explain/global", headers=operator_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["total_features"] == 17
    assert len(data["feature_importances"]) == 17

    # Verify against real engine source
    from app.models.ml_engine import engine, assemble_features_df
    engine_data = engine.get_global_shap_importance()

    assert data["sample_size"] == engine_data["sample_size"]
    assert data["n_samples"] == engine_data["n_samples"]
    assert data["n_samples"] == 200
    assert data["split_name"] == engine_data["split_name"]
    assert data["split_name"] == "test"
    if "total_test_rows" in engine_data and engine_data["total_test_rows"] is not None:
        assert data["total_test_rows"] == engine_data["total_test_rows"]

    importances = data["feature_importances"]
    # Check ranks 1 to 17 strictly ascending
    ranks = [item["rank"] for item in importances]
    assert ranks == list(range(1, 18))

    # Check non-negative importance and percentage sum ~ 100%
    pct_sum = sum(item["importance_pct"] for item in importances)
    assert 98.0 <= pct_sum <= 102.0, f"Expected pct sum ~100%, got {pct_sum}"
    assert all(item["mean_abs_shap_kw"] >= 0 for item in importances)


def test_live_vs_batch_parity_on_fixture():
    """Verify live single-row predict and predict_batch yield identical predictions (< 1e-6 kW diff)."""
    from pathlib import Path
    import pandas as pd
    from app.models.ml_engine import engine

    fixture_path = Path(__file__).resolve().parent / "fixtures" / "v2_test_sample.csv"
    assert fixture_path.exists()
    df = pd.read_csv(fixture_path)
    df["timestamp"] = pd.to_datetime(df["timestamp"])

    # Pick 5 consecutive rows (indices 10 to 14) so active_plugs diff is known
    sample_sub = df.iloc[10:15].copy().reset_index(drop=True)
    batch_preds, _ = engine.predict_batch(sample_sub)

    for i in range(len(sample_sub)):
        row = sample_sub.iloc[i]
        prev_plugs = int(sample_sub.iloc[i - 1]["active_plugs"]) if i > 0 else int(df.iloc[9]["active_plugs"])
        lags = [float(row["load_lag_15m"]), float(row["load_lag_30m"]), float(row["load_lag_45m"]), float(row["load_lag_60m"])]
        ts = row["timestamp"]
        live_pred, _, _ = engine.predict(
            ambient_temp_c=float(row["ambient_temp_c"]),
            traffic_inflow_index=int(row["traffic_inflow_index"]),
            active_plugs=int(row["active_plugs"]),
            grid_frequency_hz=float(row["grid_frequency_hz"]),
            load_lags_kw=lags,
            hour=float(ts.hour + ts.minute / 60.0),
            day_of_week=int(ts.weekday()),
            timestamp=ts,
            prev_active_plugs=prev_plugs,
        )
        assert abs(live_pred - batch_preds[i]) < 1e-6, (
            f"Parity mismatch at index {i}: live={live_pred}, batch={batch_preds[i]}"
        )


def test_monotone_property_through_engine():
    """Verify monotone increase in prediction when sweeping all 4 lags 0..+100 kW through engine.predict()."""
    from pathlib import Path
    import pandas as pd
    from app.models.ml_engine import engine

    fixture_path = Path(__file__).resolve().parent / "fixtures" / "v2_test_sample.csv"
    df = pd.read_csv(fixture_path)
    df["timestamp"] = pd.to_datetime(df["timestamp"])

    # Find row with max lag <= 190 kW
    eligible = df[
        (df["load_lag_15m"] <= 190.0)
        & (df["load_lag_30m"] <= 190.0)
        & (df["load_lag_45m"] <= 190.0)
        & (df["load_lag_60m"] <= 190.0)
    ]
    assert len(eligible) > 0
    row = eligible.iloc[0]
    ts = row["timestamp"]

    base_lags = [float(row["load_lag_15m"]), float(row["load_lag_30m"]), float(row["load_lag_45m"]), float(row["load_lag_60m"])]
    preds = []
    for step in range(0, 101, 10):
        pert_lags = [l + step for l in base_lags]
        p, _, _ = engine.predict(
            ambient_temp_c=float(row["ambient_temp_c"]),
            traffic_inflow_index=int(row["traffic_inflow_index"]),
            active_plugs=int(row["active_plugs"]),
            grid_frequency_hz=float(row["grid_frequency_hz"]),
            load_lags_kw=pert_lags,
            hour=float(ts.hour + ts.minute / 60.0),
            day_of_week=int(ts.weekday()),
            timestamp=ts,
        )
        preds.append(p)

    diffs = [preds[i + 1] - preds[i] for i in range(len(preds) - 1)]
    assert all(d >= -1e-5 for d in diffs), f"Monotonicity violation in engine.predict: diffs={diffs}"


def test_predict_prev_active_plugs_impact():
    """Verify engine.predict with explicit prev_active_plugs alters plug_delta in the expected manner and remains finite."""
    from datetime import datetime
    from app.models.ml_engine import engine

    ts = datetime(2026, 10, 31, 14, 30)
    lags = [140.0, 135.0, 130.0, 125.0]

    # Case 1: active=6, prev=4 -> delta=+2
    p_ramp, _, _ = engine.predict(
        ambient_temp_c=30.0,
        traffic_inflow_index=50,
        active_plugs=6,
        grid_frequency_hz=50.0,
        load_lags_kw=lags,
        hour=14.5,
        day_of_week=5,
        timestamp=ts,
        prev_active_plugs=4,
    )

    # Case 2: active=6, prev=None -> delta=0 (v2 behavior when prev is missing)
    p_zero, _, _ = engine.predict(
        ambient_temp_c=30.0,
        traffic_inflow_index=50,
        active_plugs=6,
        grid_frequency_hz=50.0,
        load_lags_kw=lags,
        hour=14.5,
        day_of_week=5,
        timestamp=ts,
        prev_active_plugs=None,
    )

    assert p_ramp is not None and p_zero is not None
    assert p_ramp > 0 and p_zero > 0
    # Positive plug surge generally increases or equals load expectation
    assert p_ramp >= p_zero - 5.0, f"Expected ramp load {p_ramp} to be comparable or higher than zero delta {p_zero}"


def test_assemble_features_df_how_none_returns_15_cols():
    """Verify that when how_table=None, assemble_features_df returns exactly 15 columns (legacy dev contract)."""
    import pandas as pd
    from datetime import datetime
    from app.models.ml_engine import assemble_features_df

    df = pd.DataFrame([{
        "timestamp": datetime(2026, 10, 31, 14, 30),
        "ambient_temp_c": 30.0,
        "traffic_inflow_index": 50.0,
        "active_plugs": 6,
        "grid_frequency_hz": 50.0,
        "load_lag_15m": 140.0,
        "load_lag_30m": 135.0,
        "load_lag_45m": 130.0,
        "load_lag_60m": 125.0,
    }])
    feats = assemble_features_df(df, how_table=None)
    assert len(feats.columns) == 15, f"Expected 15 columns for how_table=None, got {len(feats.columns)}"


def test_explain_without_shap_explainer_artifact(monkeypatch, tmp_path):
    """Verify that MLEngine falls back to building in-memory TreeExplainer when shap_explainer.joblib is absent."""
    import shutil
    from pathlib import Path
    import pandas as pd
    from app.core import config as app_config
    from app.models import ml_engine as ml_engine_module
    from app.models.ml_engine import MLEngine

    saved_models_dir = Path(__file__).resolve().parent.parent / "saved_models"
    for item in saved_models_dir.iterdir():
        if item.is_file() and item.name != "shap_explainer.joblib":
            shutil.copy2(item, tmp_path / item.name)

    assert not (tmp_path / "shap_explainer.joblib").exists()
    assert (tmp_path / "xgboost_model.joblib").exists()

    monkeypatch.setattr(app_config, "SAVED_MODELS_DIR", tmp_path)
    monkeypatch.setattr(ml_engine_module, "SAVED_MODELS_DIR", tmp_path)

    test_engine = MLEngine()
    test_engine.load()

    fixture_path = Path(__file__).resolve().parent / "fixtures" / "v2_test_sample.csv"
    df = pd.read_csv(fixture_path)
    row = df.iloc[0]
    ts = pd.to_datetime(row["timestamp"])
    lags = [float(row["load_lag_15m"]), float(row["load_lag_30m"]), float(row["load_lag_45m"]), float(row["load_lag_60m"])]

    pred, _, raw_features = test_engine.predict(
        ambient_temp_c=float(row["ambient_temp_c"]),
        traffic_inflow_index=int(row["traffic_inflow_index"]),
        active_plugs=int(row["active_plugs"]),
        grid_frequency_hz=float(row["grid_frequency_hz"]),
        load_lags_kw=lags,
        hour=float(ts.hour + ts.minute / 60.0),
        day_of_week=int(ts.weekday()),
        timestamp=ts,
    )

    base, attributions = test_engine.explain(raw_features)

    assert len(attributions) == 17
    sum_shap = sum(a["shap_delta_kw"] for a in attributions)
    err = abs((base + sum_shap) - pred)
    assert err < 1e-3, f"SHAP additivity violated without joblib file: base={base}, sum={sum_shap}, pred={pred}, err={err}"





