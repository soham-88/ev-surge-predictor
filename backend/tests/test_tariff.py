from fastapi.testclient import TestClient
from app.models.optimizer import classify_surge, compute_tariff
from app.services.vehicle_tariff import (
    VEHICLE_TARIFF_TABLE,
    calculate_vehicle_adjusted_tariff,
    get_tariff_curve_data,
)


def test_tariff_curve_unauthenticated(client: TestClient):
    resp = client.get("/api/v1/tariff/curve")
    assert resp.status_code == 401


def test_tariff_curve_authenticated_viewer(client: TestClient, viewer_headers: dict[str, str]):
    resp = client.get("/api/v1/tariff/curve", headers=viewer_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "bands" in data
    assert "points" in data
    assert "categories" in data
    assert len(data["bands"]) == 4
    assert len(data["points"]) == 101


def test_tariff_curve_authenticated_operator(client: TestClient, operator_headers: dict[str, str]):
    resp = client.get("/api/v1/tariff/curve", headers=operator_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "bands" in data
    assert "points" in data
    assert "categories" in data


def test_tariff_curve_matches_service_functions(client: TestClient, viewer_headers: dict[str, str]):
    resp = client.get("/api/v1/tariff/curve", headers=viewer_headers)
    assert resp.status_code == 200
    data = resp.json()

    # Compare directly with backend service data
    service_data = get_tariff_curve_data()
    assert data["bands"] == service_data["bands"]
    assert data["points"] == service_data["points"]
    assert data["categories"] == service_data["categories"]

    # Verify specific policy values at utilization keypoints
    points_by_pct = {p["utilization_pct"]: p for p in data["points"]}

    for pct in [0, 50, 64, 65, 75, 79, 80, 90, 94, 95, 100]:
        point = points_by_pct[pct]
        expected_surge = classify_surge(float(pct))
        expected_base = compute_tariff(expected_surge, float(pct))
        assert point["surge_status"] == expected_surge
        assert point["base_multiplier"] == expected_base
        for cat in ["two_wheeler", "standard_4w", "fast_charging"]:
            expected_adj = calculate_vehicle_adjusted_tariff(expected_base, cat)["final_tariff_multiplier"]
            assert point[cat] == expected_adj


def test_vehicle_options_and_adjusted_endpoints(client: TestClient):
    resp_options = client.get("/api/v1/tariff/vehicle-options")
    assert resp_options.status_code == 200
    assert "standard_4w" in resp_options.json()

    resp_adj = client.post(
        "/api/v1/tariff/vehicle-adjusted",
        json={"base_surge_multiplier": 1.2, "vehicle_type": "fast_charging"},
    )
    assert resp_adj.status_code == 200
    data = resp_adj.json()
    assert data["base_surge_multiplier"] == 1.2
    assert data["vehicle_type"] == "fast_charging"
    assert data["final_tariff_multiplier"] == 1.62
