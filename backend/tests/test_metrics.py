from __future__ import annotations

from fastapi.testclient import TestClient


def test_get_metrics(client: TestClient, operator_headers: dict[str, str]):
    resp = client.get("/api/v1/metrics", headers=operator_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert "models" in data
    models = data["models"]
    assert len(models) == 2

    model_names = [m["name"] for m in models]
    assert "XGBoost Regressor (Primary)" in model_names
    assert "PyTorch LSTM Sequence (Benchmark)" in model_names

    expected_keys = {
        "name", "mae_kw", "rmse_kw", "surge_recall_pct", "latency_ms",
        "rule_a_recall_pct", "early_warning_recall_pct", "rule_a_precision_pct",
        "latency_model_only_ms", "latency_end_to_end_ms", "n_test_samples"
    }
    for m in models:
        assert expected_keys.issubset(m.keys())
        assert isinstance(m["mae_kw"], (int, float))
        assert isinstance(m["rmse_kw"], (int, float))
        assert isinstance(m["surge_recall_pct"], (int, float))
        assert isinstance(m["latency_ms"], (int, float))
        assert isinstance(m["rule_a_recall_pct"], (int, float))
        assert isinstance(m["early_warning_recall_pct"], (int, float))
        assert isinstance(m["rule_a_precision_pct"], (int, float))
        assert isinstance(m["latency_model_only_ms"], (int, float))
        assert isinstance(m["latency_end_to_end_ms"], (int, float))
        assert isinstance(m["n_test_samples"], int)

        assert m["mae_kw"] > 0
        assert m["rmse_kw"] > 0
        assert 0.0 <= m["surge_recall_pct"] <= 100.0
        assert m["surge_recall_pct"] == m["rule_a_recall_pct"]
        assert m["latency_model_only_ms"] <= m["latency_end_to_end_ms"]
        assert m["n_test_samples"] > 0

