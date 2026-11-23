from __future__ import annotations

import sys
import time
import subprocess
from pathlib import Path
import requests
import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parent.parent
FIXTURE_PATH = BACKEND_DIR / "tests" / "fixtures" / "v2_test_sample.csv"
PORT = 8008
BASE_URL = f"http://127.0.0.1:{PORT}"

SAMPLE_PAYLOAD = {
    "timestamp": "2026-10-31T14:30:00Z",
    "ambient_temp_c": 32.5,
    "traffic_inflow_index": 65,
    "active_plugs": 6,
    "grid_frequency_hz": 49.92,
    "load_lags_kw": [145.2, 140.0, 138.5, 130.0],
}


def run_smoke():
    print(f"Starting uvicorn server on port {PORT}...")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=str(BACKEND_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        # Wait for server to start
        ready = False
        for _ in range(30):
            try:
                r = requests.get(f"{BASE_URL}/health", timeout=1)
                if r.status_code == 200:
                    ready = True
                    break
            except Exception:
                pass
            time.sleep(0.5)

        if not ready:
            print("ERROR: Server failed to start within 15 seconds.")
            return False

        print("Server is UP and ready. Running smoke tests...\n")

        # Login
        auth_resp = requests.post(
            f"{BASE_URL}/api/v1/auth/login",
            data={"username": "operator", "password": "operatorpassword123"},
            timeout=5,
        )
        assert auth_resp.status_code == 200, f"Auth failed: {auth_resp.text}"
        token = auth_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 1. GET /health
        r1 = requests.get(f"{BASE_URL}/health", timeout=5)
        print(f"[1/7] GET /health -> Status: {r1.status_code}")
        print(f"      Response: {r1.json()}\n")
        assert r1.status_code == 200

        # 2. POST /api/v1/predict (without prev_active_plugs)
        r2 = requests.post(f"{BASE_URL}/api/v1/predict", json=SAMPLE_PAYLOAD, headers=headers, timeout=5)
        print(f"[2/7] POST /api/v1/predict (no prev_active_plugs) -> Status: {r2.status_code}")
        d2 = r2.json()
        print(f"      predicted_load_kw: {d2.get('predicted_load_kw')} kW")
        print(f"      lower_bound_kw: {d2.get('lower_bound_kw')} kW | upper_bound_kw: {d2.get('upper_bound_kw')} kW")
        print(f"      surge_status: {d2.get('surge_status')} | capacity_utilization_pct: {d2.get('capacity_utilization_pct')}%\n")
        assert r2.status_code == 200

        # 3. POST /api/v1/predict (with prev_active_plugs=4)
        payload_with_prev = dict(SAMPLE_PAYLOAD)
        payload_with_prev["prev_active_plugs"] = 4
        r3 = requests.post(f"{BASE_URL}/api/v1/predict", json=payload_with_prev, headers=headers, timeout=5)
        print(f"[3/7] POST /api/v1/predict (with prev_active_plugs=4) -> Status: {r3.status_code}")
        d3 = r3.json()
        print(f"      predicted_load_kw: {d3.get('predicted_load_kw')} kW")
        print(f"      lower_bound_kw: {d3.get('lower_bound_kw')} kW | upper_bound_kw: {d3.get('upper_bound_kw')} kW")
        print(f"      surge_status: {d3.get('surge_status')}\n")
        assert r3.status_code == 200

        # 4. POST /api/v1/explain
        r4 = requests.post(f"{BASE_URL}/api/v1/explain", json=SAMPLE_PAYLOAD, headers=headers, timeout=5)
        print(f"[4/7] POST /api/v1/explain -> Status: {r4.status_code}")
        d4 = r4.json()
        print(f"      base_value_kw: {d4.get('base_value_kw')} kW | predicted_value_kw: {d4.get('predicted_value_kw')} kW")
        print(f"      attributions count: {len(d4.get('attributions', []))}")
        top3 = sorted(d4.get("attributions", []), key=lambda a: abs(a["shap_delta_kw"]), reverse=True)[:3]
        for a in top3:
            print(f"        • {a['feature']}: {a['shap_delta_kw']:+.3f} kW (val={a['value']})")
        print()
        assert r4.status_code == 200

        # 5. GET /api/v1/explain/global
        r5 = requests.get(f"{BASE_URL}/api/v1/explain/global", headers=headers, timeout=5)
        print(f"[5/7] GET /api/v1/explain/global -> Status: {r5.status_code}")
        d5 = r5.json()
        print(f"      total_features: {d5.get('total_features')} | n_samples: {d5.get('n_samples')}")
        print(f"      top 3 features: {[f['feature'] for f in d5.get('feature_importances', [])[:3]]}\n")
        assert r5.status_code == 200

        # 6. GET /api/v1/metrics
        r6 = requests.get(f"{BASE_URL}/api/v1/metrics", headers=headers, timeout=5)
        print(f"[6/7] GET /api/v1/metrics -> Status: {r6.status_code}")
        d6 = r6.json()
        for m in d6.get("models", []):
            print(f"      Model: {m.get('name')}")
            print(f"        MAE: {m.get('mae_kw')} kW | RMSE: {m.get('rmse_kw')} kW | Surge Recall: {m.get('surge_recall_pct')}%")
            print(f"        Rule A Recall: {m.get('rule_a_recall_pct')}% | Model Latency: {m.get('latency_model_only_ms')} ms | E2E Latency: {m.get('latency_end_to_end_ms')} ms")
        print()
        assert r6.status_code == 200

        # 7. POST /api/v1/predict/batch with 10-row CSV from v2_test_sample.csv
        df_10 = pd.read_csv(FIXTURE_PATH).head(10)
        csv_bytes = df_10.to_csv(index=False).encode("utf-8")
        r7 = requests.post(
            f"{BASE_URL}/api/v1/predict/batch",
            files={"file": ("fixture_10_rows.csv", csv_bytes, "text/csv")},
            headers=headers,
            timeout=10,
        )
        print(f"[7/7] POST /api/v1/predict/batch (10 rows) -> Status: {r7.status_code}")
        d7 = r7.json()
        print(f"      predictions returned: {len(d7.get('predictions', []))}")
        print(f"      summary: {d7.get('summary')}\n")
        assert r7.status_code == 200

        print("ALL 7 ENDPOINTS RETURNED HTTP 200 OK!")
        return True

    finally:
        print("Shutting down uvicorn server...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        print("Server shutdown cleanly.")


if __name__ == "__main__":
    success = run_smoke()
    sys.exit(0 if success else 1)
