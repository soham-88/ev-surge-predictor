"""
Re-measure inference latency using standardized protocol without retraining.
Standardized protocol:
  - Single sample (N=1)
  - 10 warm-up passes
  - 100 timed iterations
  - Reports MEDIAN in ms rounded to 2 decimal places.

Updates ONLY latency_ms in:
  - backend/saved_models/training_metrics.joblib
  - backend/saved_models/lstm_metrics.joblib
Prints before/after of every field in both files to verify nothing else changed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import joblib
import numpy as np
import torch

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from train import (
    synthesize_telemetry,
    engineer_features,
    FEATURE_COLUMNS,
    SAVED_MODELS_DIR,
)
from train_lstm import LSTMPredictor
from latency_utils import measure_inference_latency


def main():
    print("=" * 70)
    print("  STANDARDIZED LATENCY RE-MEASUREMENT (NO RETRAINING)")
    print("=" * 70)

    # 1. Load BEFORE states from disk
    xgb_metrics_path = SAVED_MODELS_DIR / "training_metrics.joblib"
    lstm_metrics_path = SAVED_MODELS_DIR / "lstm_metrics.joblib"

    before_xgb = dict(joblib.load(xgb_metrics_path))
    before_lstm = dict(joblib.load(lstm_metrics_path))

    # 2. Load trained models
    print("\n[1/3] Loading saved model artifacts ...")
    model_xgb = joblib.load(SAVED_MODELS_DIR / "xgboost_model.joblib")
    scaler = joblib.load(SAVED_MODELS_DIR / "scaler.joblib")

    device = torch.device("cpu")
    model_lstm = LSTMPredictor(input_size=len(FEATURE_COLUMNS), hidden_size=64, num_layers=2, dropout=0.2)
    model_lstm.load_state_dict(torch.load(SAVED_MODELS_DIR / "lstm_model.pt", map_location=device, weights_only=True))
    model_lstm.eval()

    # 3. Prepare test sample from test split
    print("[2/3] Preparing single-sample test inputs ...")
    df_raw = synthesize_telemetry(n_days=90, seed=42)
    df = engineer_features(df_raw)
    X_all = df[FEATURE_COLUMNS].values
    split_idx = int(len(X_all) * 0.8)
    X_test_raw = X_all[split_idx:]
    X_test_scaled = scaler.transform(X_test_raw)

    sample_xgb = X_test_scaled[:1]  # shape: (1, 15)
    sample_lstm = torch.FloatTensor(X_test_scaled[:8].reshape(1, 8, len(FEATURE_COLUMNS))).to(device)  # shape: (1, 8, 15)

    # 4. Measure latencies with standardized protocol
    print("[3/3] Benchmarking latency (10 warmup, 100 timed iterations, median) ...")
    new_latency_xgb = measure_inference_latency(model_xgb.predict, sample_xgb, n_warmup=10, n_iterations=100)

    with torch.no_grad():
        new_latency_lstm = measure_inference_latency(lambda s: model_lstm(s), sample_lstm, n_warmup=10, n_iterations=100)

    # 5. Update ONLY latency_ms in existing artifacts
    xgb_to_save = dict(before_xgb)
    xgb_to_save["latency_ms"] = new_latency_xgb
    joblib.dump(xgb_to_save, xgb_metrics_path)

    lstm_to_save = dict(before_lstm)
    lstm_to_save["latency_ms"] = new_latency_lstm
    joblib.dump(lstm_to_save, lstm_metrics_path)

    # 6. Reload from disk to verify
    after_xgb = dict(joblib.load(xgb_metrics_path))
    after_lstm = dict(joblib.load(lstm_metrics_path))

    # 7. Print before/after table
    print("\n" + "=" * 70)
    print("  VERIFICATION: FIELD-BY-FIELD BEFORE vs AFTER")
    print("=" * 70)

    print("\n--- XGBoost (training_metrics.joblib) ---")
    all_xgb_keys = sorted(set(before_xgb.keys()) | set(after_xgb.keys()))
    for k in all_xgb_keys:
        b_val = before_xgb.get(k)
        a_val = after_xgb.get(k)
        status = "[CHANGED]" if b_val != a_val else "[UNCHANGED]"
        print(f"  {k:<20s} : before = {b_val!r:<12} -> after = {a_val!r:<12} {status}")

    print("\n--- PyTorch LSTM (lstm_metrics.joblib) ---")
    all_lstm_keys = sorted(set(before_lstm.keys()) | set(after_lstm.keys()))
    for k in all_lstm_keys:
        b_val = before_lstm.get(k)
        a_val = after_lstm.get(k)
        status = "[CHANGED]" if b_val != a_val else "[UNCHANGED]"
        print(f"  {k:<20s} : before = {b_val!r:<12} -> after = {a_val!r:<12} {status}")

    print("=" * 70)
    print("  LATENCY RE-MEASUREMENT COMPLETE")
    print("=" * 70)


if __name__ == "__main__":
    main()
