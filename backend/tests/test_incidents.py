import pytest
from fastapi.testclient import TestClient

SURGE_TELEMETRY = {
    "timestamp": "2026-10-28T14:00:00Z",
    "ambient_temp_c": 42.0,
    "traffic_inflow_index": 95,
    "active_plugs": 8,
    "grid_frequency_hz": 49.88,
    "load_lags_kw": [218.0, 212.5, 204.0, 195.0],
}


def test_incidents_unauthenticated(client: TestClient):
    resp = client.get("/api/v1/incidents")
    assert resp.status_code == 401


def test_incidents_logged_on_surge_prediction(
    client: TestClient, operator_headers: dict[str, str], viewer_headers: dict[str, str]
):
    # Clear existing incidents
    client.delete("/api/v1/incidents", headers=operator_headers)

    # Perform a surge prediction that triggers CRITICAL status
    resp = client.post(
        "/api/v1/predict",
        json=SURGE_TELEMETRY,
        headers=operator_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["surge_status"] in ("WARNING", "CRITICAL")

    # Fetch incidents list
    resp_inc = client.get("/api/v1/incidents", headers=operator_headers)
    assert resp_inc.status_code == 200
    data = resp_inc.json()
    assert data["total"] >= 1
    assert len(data["incidents"]) >= 1

    latest = data["incidents"][0]
    assert latest["surge_status"] in ("WARNING", "CRITICAL")
    assert latest["predicted_load_kw"] > 0
    assert latest["tariff_multiplier"] >= 1.0


def test_viewer_cannot_delete_incidents(
    client: TestClient, viewer_headers: dict[str, str]
):
    resp = client.delete("/api/v1/incidents", headers=viewer_headers)
    assert resp.status_code == 403


def test_operator_can_delete_incidents(
    client: TestClient, operator_headers: dict[str, str]
):
    resp = client.delete("/api/v1/incidents", headers=operator_headers)
    assert resp.status_code == 200
    assert "deleted_count" in resp.json()

    # Verify incidents are empty now
    resp_inc = client.get("/api/v1/incidents", headers=operator_headers)
    assert resp_inc.status_code == 200
    assert resp_inc.json()["total"] == 0
