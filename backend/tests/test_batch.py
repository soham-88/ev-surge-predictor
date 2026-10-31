from __future__ import annotations

from pathlib import Path
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SAMPLE_DATA_DIR = REPO_ROOT / "docs" / "sample-data"


def test_batch_valid_csv(client: TestClient, operator_headers: dict[str, str]):
    csv_path = SAMPLE_DATA_DIR / "sample_batch_valid.csv"
    assert csv_path.exists(), f"Missing sample CSV: {csv_path}"

    with open(csv_path, "rb") as f:
        files = {"file": ("sample_batch_valid.csv", f, "text/csv")}
        resp = client.post(
            "/api/v1/predict/batch",
            files=files,
            headers=operator_headers,
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert "summary" in data
    assert "predictions" in data
    assert len(data["predictions"]) == 288

    summary = data["summary"]
    assert "avg_mae_vs_actual_kw" in summary
    assert summary["avg_mae_vs_actual_kw"] is not None
    assert summary["avg_mae_vs_actual_kw"] > 0
    assert summary["peak_predicted_kw"] > 0
    assert "critical_events_count" in summary


def test_batch_wrong_columns_rejected(
    client: TestClient, operator_headers: dict[str, str]
):
    csv_path = SAMPLE_DATA_DIR / "sample_batch_wrong_columns.csv"
    assert csv_path.exists(), f"Missing sample CSV: {csv_path}"

    with open(csv_path, "rb") as f:
        files = {"file": ("sample_batch_wrong_columns.csv", f, "text/csv")}
        resp = client.post(
            "/api/v1/predict/batch",
            files=files,
            headers=operator_headers,
        )

    assert resp.status_code == 422, f"Expected 422, got {resp.status_code}"
    detail = resp.json().get("detail", {})
    assert "Missing required columns" in str(detail)
    expected_missing = detail.get("expected_columns", [])
    assert "load_lag_45m" in expected_missing
    assert "load_lag_60m" in expected_missing


def test_batch_legacy_60hz_rejected(
    client: TestClient, operator_headers: dict[str, str]
):
    csv_path = SAMPLE_DATA_DIR / "sample_batch_legacy_60hz.csv"
    assert csv_path.exists(), f"Missing sample CSV: {csv_path}"

    with open(csv_path, "rb") as f:
        files = {"file": ("sample_batch_legacy_60hz.csv", f, "text/csv")}
        resp = client.post(
            "/api/v1/predict/batch",
            files=files,
            headers=operator_headers,
        )

    assert resp.status_code == 422, f"Expected 422, got {resp.status_code}"
    detail = resp.json().get("detail", "")
    assert "Grid frequency out of range" in str(detail)
    assert "allowed range: 45.0 to 55.0 Hz" in str(detail)

