from __future__ import annotations

import logging
import pytest
from fastapi.testclient import TestClient

from app.core import config


def test_health(client: TestClient):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "ev-surge-predictor"


def test_login_success(client: TestClient):
    resp = client.post(
        "/api/v1/auth/login",
        data={"username": "operator", "password": "operatorpassword123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["role"] == "operator"
    assert data["username"] == "operator"


def test_login_failure(client: TestClient):
    resp = client.post(
        "/api/v1/auth/login",
        data={"username": "operator", "password": "wrongpassword"},
    )
    assert resp.status_code == 401
    assert "detail" in resp.json()


def test_auth_me_authenticated(client: TestClient, operator_headers: dict[str, str]):
    resp = client.get("/api/v1/auth/me", headers=operator_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "operator"
    assert data["role"] == "operator"


def test_auth_me_unauthenticated(client: TestClient):
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401


def test_simulate_role_access(
    client: TestClient,
    viewer_headers: dict[str, str],
    operator_headers: dict[str, str],
):
    sim_payload = {
        "temp_delta_c": 2.5,
        "traffic_surge_pct": 20.0,
        "forced_outage_stalls": [1, 2],
    }

    # Viewer should be forbidden (403)
    resp_viewer = client.post(
        "/api/v1/simulate",
        json=sim_payload,
        headers=viewer_headers,
    )
    assert resp_viewer.status_code == 403

    # Operator should be allowed (200)
    resp_operator = client.post(
        "/api/v1/simulate",
        json=sim_payload,
        headers=operator_headers,
    )
    assert resp_operator.status_code == 200
    data = resp_operator.json()
    assert "timeline" in data
    assert "simulated_peak_kw" in data
    assert "baseline_peak_kw" in data
    assert "surge_risk" in data
    assert "dispatched_mitigations" in data


def test_jwt_secret_default_warning_emitted(caplog: pytest.LogCaptureFixture):
    # Test new default warning
    with caplog.at_level(logging.WARNING):
        warned = config.check_jwt_secret_warning("dev-only-insecure-change-me")
        assert warned is True
        assert any("JWT_SECRET is set to a development default" in r.message for r in caplog.records)

    # Test old default string warning
    caplog.clear()
    with caplog.at_level(logging.WARNING):
        warned_old = config.check_jwt_secret_warning("ev_surge_production_jwt_secret_grid_pulse_2026")
        assert warned_old is True
        assert any("JWT_SECRET is set to a development default" in r.message for r in caplog.records)

    # Test non-default secure secret produces no warning
    caplog.clear()
    with caplog.at_level(logging.WARNING):
        safe = config.check_jwt_secret_warning("custom_production_secret_32_characters_long")
        assert safe is False
        assert not any("development default" in r.message for r in caplog.records)
