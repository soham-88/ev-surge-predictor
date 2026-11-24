"""
Unit and integration tests for security hardening, DoS protections, and logical guards.
"""

from __future__ import annotations

import io
import pytest
from fastapi.testclient import TestClient

from app.core.timezone import get_station_timezone
from app.services.vehicle_tariff import (
    calculate_vehicle_adjusted_tariff,
    get_tariff_curve_data,
)


def test_cors_configuration_does_not_contain_wildcard():
    from app.core.config import CORS_ORIGINS
    assert "*" not in CORS_ORIGINS, "CORS_ORIGINS should not contain wildcard '*' when allow_credentials=True"


def test_station_timezone_lru_caching():
    get_station_timezone.cache_clear()
    info_before = get_station_timezone.cache_info()
    assert info_before.hits == 0

    tz1 = get_station_timezone("MUM-01")
    tz2 = get_station_timezone("MUM-01")
    info_after = get_station_timezone.cache_info()
    assert tz1 == tz2
    assert info_after.hits >= 1


def test_tariff_multiplier_clamping_logic():
    # Negative multiplier should be clamped to 0.5
    neg_res = calculate_vehicle_adjusted_tariff(-10.0, "standard_4w")
    assert neg_res["base_surge_multiplier"] == 0.5
    assert neg_res["final_tariff_multiplier"] >= 0.5

    # Zero multiplier should be clamped to 0.5
    zero_res = calculate_vehicle_adjusted_tariff(0.0, "standard_4w")
    assert zero_res["base_surge_multiplier"] == 0.5

    # Excessive multiplier should be clamped to 5.0
    high_res = calculate_vehicle_adjusted_tariff(99.0, "standard_4w")
    assert high_res["base_surge_multiplier"] == 5.0
    assert high_res["final_tariff_multiplier"] <= 5.0 * 1.35


def test_tariff_curve_is_cached():
    curve1 = get_tariff_curve_data()
    curve2 = get_tariff_curve_data()
    assert curve1 is curve2, "get_tariff_curve_data() should return precomputed cached dictionary"
    assert "bands" in curve1
    assert len(curve1["points"]) == 101


def test_tariff_endpoint_validates_range(client: TestClient, viewer_headers: dict[str, str]):
    # Multiplier below 0.5 should return 422
    resp_low = client.post(
        "/api/v1/tariff/vehicle-adjusted",
        json={"base_surge_multiplier": 0.1, "vehicle_type": "standard_4w"},
        headers=viewer_headers,
    )
    assert resp_low.status_code == 422

    # Multiplier above 5.0 should return 422
    resp_high = client.post(
        "/api/v1/tariff/vehicle-adjusted",
        json={"base_surge_multiplier": 10.0, "vehicle_type": "standard_4w"},
        headers=viewer_headers,
    )
    assert resp_high.status_code == 422

    # Valid multiplier in range [0.5, 5.0]
    resp_valid = client.post(
        "/api/v1/tariff/vehicle-adjusted",
        json={"base_surge_multiplier": 1.25, "vehicle_type": "standard_4w"},
        headers=viewer_headers,
    )
    assert resp_valid.status_code == 200
    assert resp_valid.json()["final_tariff_multiplier"] == 1.25


def test_simulate_validates_stalls_and_temperature(client: TestClient, operator_headers: dict[str, str]):
    # Invalid stall index (e.g. 9 or negative)
    resp_invalid_stall = client.post(
        "/api/v1/simulate",
        json={"forced_outage_stalls": [9, -1], "temp_delta_c": 0.0, "traffic_surge_pct": 10},
        headers=operator_headers,
    )
    assert resp_invalid_stall.status_code == 422

    # Valid stall indices [1..8] should succeed
    resp_valid = client.post(
        "/api/v1/simulate",
        json={"forced_outage_stalls": [3, 4], "temp_delta_c": 5.0, "traffic_surge_pct": 20},
        headers=operator_headers,
    )
    assert resp_valid.status_code == 200


def test_batch_file_size_limit(client: TestClient, operator_headers: dict[str, str]):
    # Construct a dummy CSV larger than 15MB
    large_payload = b"dummy" * (16 * 1024 * 1024 // 5)
    files = {"file": ("large_file.csv", large_payload, "text/csv")}
    resp = client.post("/api/v1/predict/batch", files=files, headers=operator_headers)
    assert resp.status_code == 413
    assert "exceeds maximum limit" in resp.json().get("detail", "")
