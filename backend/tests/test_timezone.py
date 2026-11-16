from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.core.timezone import to_station_local, get_station_timezone
from app.core.config import DEFAULT_STATION_TIMEZONE

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SAMPLE_DATA_DIR = REPO_ROOT / "docs" / "sample-data"

BASE_TELEMETRY = {
    "ambient_temp_c": 32.5,
    "traffic_inflow_index": 65,
    "active_plugs": 6,
    "grid_frequency_hz": 49.92,
    "load_lags_kw": [145.2, 140.0, 138.5, 130.0],
}


def test_station_local_conversion_helper():
    """Test to_station_local helper with aware, naive, string, and pandas objects."""
    # Aware UTC
    dt_utc = datetime(2026, 11, 16, 12, 14, tzinfo=timezone.utc)
    dt_local = to_station_local(dt_utc)
    assert dt_local.tzinfo is not None
    assert dt_local.hour == 17
    assert dt_local.minute == 44

    # Aware with offset +05:30
    dt_ist = datetime.fromisoformat("2026-11-16T17:44:00+05:30")
    dt_ist_conv = to_station_local(dt_ist)
    assert dt_ist_conv.hour == 17
    assert dt_ist_conv.minute == 44

    # Naive datetime remains unchanged
    dt_naive = datetime(2026, 11, 16, 17, 44)
    dt_naive_conv = to_station_local(dt_naive)
    assert dt_naive_conv.tzinfo is None
    assert dt_naive_conv == dt_naive

    # Pandas Series - Naive
    s_naive = pd.Series(["2026-11-16 17:44:00", "2026-11-16 18:00:00"])
    res_s_naive = to_station_local(s_naive)
    assert res_s_naive.dt.tz is None
    assert (res_s_naive.dt.hour == pd.Series([17, 18])).all()

    # Pandas Series - Aware UTC
    s_aware = pd.Series(["2026-11-16T12:14:00Z", "2026-11-16T12:30:00Z"])
    res_s_aware = to_station_local(s_aware)
    assert res_s_aware.dt.tz is not None
    assert (res_s_aware.dt.hour == pd.Series([17, 18])).all()


def test_station_timezone_fallback(monkeypatch):
    """Verify fallback to DEFAULT_STATION_TIMEZONE when station query fails."""
    assert get_station_timezone("NON_EXISTENT_STATION") == DEFAULT_STATION_TIMEZONE


def test_predict_and_explain_timezone_equivalence(client: TestClient, operator_headers: dict[str, str]):
    """Test 4(a): 12:14Z, 17:44+05:30, and naive 17:44 produce identical predictions and SHAP values."""
    ts_utc = "2026-11-16T12:14:00Z"
    ts_offset = "2026-11-16T17:44:00+05:30"
    ts_naive = "2026-11-16T17:44:00"

    p_utc = client.post("/api/v1/predict", json={**BASE_TELEMETRY, "timestamp": ts_utc}, headers=operator_headers).json()
    p_offset = client.post("/api/v1/predict", json={**BASE_TELEMETRY, "timestamp": ts_offset}, headers=operator_headers).json()
    p_naive = client.post("/api/v1/predict", json={**BASE_TELEMETRY, "timestamp": ts_naive}, headers=operator_headers).json()

    assert p_utc["predicted_load_kw"] == p_offset["predicted_load_kw"]
    assert p_utc["predicted_load_kw"] == p_naive["predicted_load_kw"]
    assert p_utc["surge_status"] == p_offset["surge_status"] == p_naive["surge_status"]

    # Verify station_local_time optional field
    assert "station_local_time" in p_utc
    assert "17:44:00" in p_utc["station_local_time"]

    # Explain parity
    e_utc = client.post("/api/v1/explain", json={**BASE_TELEMETRY, "timestamp": ts_utc}, headers=operator_headers).json()
    e_offset = client.post("/api/v1/explain", json={**BASE_TELEMETRY, "timestamp": ts_offset}, headers=operator_headers).json()
    e_naive = client.post("/api/v1/explain", json={**BASE_TELEMETRY, "timestamp": ts_naive}, headers=operator_headers).json()

    assert e_utc["predicted_value_kw"] == e_offset["predicted_value_kw"] == e_naive["predicted_value_kw"]
    assert e_utc["base_value_kw"] == e_offset["base_value_kw"] == e_naive["base_value_kw"]

    # Compare all 15 attributions exactly
    att_utc = {a["feature"]: a["shap_delta_kw"] for a in e_utc["attributions"]}
    att_offset = {a["feature"]: a["shap_delta_kw"] for a in e_offset["attributions"]}
    att_naive = {a["feature"]: a["shap_delta_kw"] for a in e_naive["attributions"]}

    for feat in att_utc:
        assert att_utc[feat] == att_offset[feat]
        assert att_utc[feat] == att_naive[feat]


def test_predict_naive_1214_differs_from_1744(client: TestClient, operator_headers: dict[str, str]):
    """Test 4(b): Naive 12:14:00 gives a clearly different prediction from 17:44:00."""
    p_1744 = client.post(
        "/api/v1/predict",
        json={**BASE_TELEMETRY, "timestamp": "2026-11-16T17:44:00"},
        headers=operator_headers,
    ).json()

    p_1214 = client.post(
        "/api/v1/predict",
        json={**BASE_TELEMETRY, "timestamp": "2026-11-16T12:14:00"},
        headers=operator_headers,
    ).json()

    # Hour 17.73 (evening peak ramp) vs Hour 12.23 (midday off-peak)
    diff = abs(p_1744["predicted_load_kw"] - p_1214["predicted_load_kw"])
    assert diff > 40.0, f"Expected substantial difference between hour 17.73 and hour 12.23, got diff={diff:.2f} kW"


def test_day_boundary_conversion(client: TestClient, operator_headers: dict[str, str]):
    """Test 4(c): 2026-11-14T20:00:00Z (Saturday in UTC) is Sunday 01:30 local (day_of_week=6)."""
    ts_utc = "2026-11-14T20:00:00Z"

    # In UTC, 2026-11-14 is Saturday (weekday 5).
    # In Asia/Kolkata (+5:30), 2026-11-14 20:00:00Z is 2026-11-15 01:30:00+05:30, Sunday (weekday 6).
    converted = to_station_local(datetime.fromisoformat("2026-11-14T20:00:00+00:00"))
    assert converted.weekday() == 6
    assert converted.hour == 1
    assert converted.minute == 30

    # API predict response station_local_time reflects Sunday 01:30
    p = client.post(
        "/api/v1/predict",
        json={**BASE_TELEMETRY, "timestamp": ts_utc},
        headers=operator_headers,
    ).json()
    assert "2026-11-15T01:30:00" in p["station_local_time"]

    # Explain attributions show cyclical Sunday encoding
    e = client.post(
        "/api/v1/explain",
        json={**BASE_TELEMETRY, "timestamp": ts_utc},
        headers=operator_headers,
    ).json()
    # At Sunday 01:30, day_sin is sin(2*pi*6/7) == -0.7818, distinct from Saturday sin(2*pi*5/7) == -0.9749
    att_dict = {a["feature"]: a["value"] for a in e["attributions"]}
    assert "day_sin" in att_dict


def test_batch_naive_timestamps_unchanged_results(client: TestClient, operator_headers: dict[str, str]):
    """Test 4(d): Batch endpoint with naive CSV timestamps returns identical results as baseline."""
    csv_path = SAMPLE_DATA_DIR / "sample_batch_valid.csv"
    assert csv_path.exists()

    with open(csv_path, "rb") as f:
        resp = client.post(
            "/api/v1/predict/batch",
            files={"file": ("sample_batch_valid.csv", f, "text/csv")},
            headers=operator_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    summary = data["summary"]
    # Baseline avg_mae_vs_actual_kw was 7.34 kW
    assert summary["avg_mae_vs_actual_kw"] == 7.34
    assert summary["peak_predicted_kw"] == 253.2
    assert len(data["predictions"]) == 288


def test_predict_explain_parity_with_timezone(client: TestClient, operator_headers: dict[str, str]):
    """Test 4(e): Predict and explain stay in exact parity for UTC timestamp."""
    ts = "2026-11-16T12:14:00Z"
    p_resp = client.post("/api/v1/predict", json={**BASE_TELEMETRY, "timestamp": ts}, headers=operator_headers).json()
    e_resp = client.post("/api/v1/explain", json={**BASE_TELEMETRY, "timestamp": ts}, headers=operator_headers).json()

    assert round(e_resp["predicted_value_kw"], 1) == p_resp["predicted_load_kw"]
