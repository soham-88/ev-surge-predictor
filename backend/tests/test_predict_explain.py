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
    assert len(data["attributions"]) == 15

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

