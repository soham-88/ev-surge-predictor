"""
Independent latency & accuracy verification benchmark.

Runs XGBoost and LSTM benchmarks in isolation to produce honest,
reproducible numbers. Each model gets:
  - 100 single-sample inference calls (median, not mean)
  - Surge recall computed from its OWN predictions
  - No shared state between models

Usage: python pipeline/benchmark_models.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import joblib
import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import mean_absolute_error, mean_squared_error

# Add pipeline to path for imports
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from train import (
    synthesize_telemetry,
    engineer_features,
    FEATURE_COLUMNS,
    TARGET_COLUMN,
    SAVED_MODELS_DIR,
)
from train_lstm import LSTMPredictor, create_sequences

TRANSFORMER_CAPACITY = 250.0
SURGE_THRESHOLD = 0.80 * TRANSFORMER_CAPACITY  # 200.0 kW


def benchmark_xgboost(X_test_scaled, y_test):
    """Benchmark XGBoost in complete isolation."""
    print("\n" + "=" * 60)
    print("  XGBOOST INDEPENDENT BENCHMARK")
    print("=" * 60)

    model = joblib.load(SAVED_MODELS_DIR / "xgboost_model.joblib")

    # --- Accuracy ---
    y_pred = model.predict(X_test_scaled)
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))

    # --- Surge Recall (from XGBoost's OWN predictions) ---
    actual_surge = y_test >= SURGE_THRESHOLD
    predicted_surge = y_pred >= SURGE_THRESHOLD
    if actual_surge.sum() > 0:
        surge_recall = (predicted_surge & actual_surge).sum() / actual_surge.sum()
    else:
        surge_recall = 1.0

    # --- Latency: 100 SINGLE-SAMPLE calls, timed individually ---
    single_sample = X_test_scaled[:1]  # shape: (1, 15)

    # Warmup (10 calls to stabilize JIT/cache)
    for _ in range(10):
        model.predict(single_sample)

    latencies_ms = []
    for _ in range(100):
        t0 = time.perf_counter()
        model.predict(single_sample)
        t1 = time.perf_counter()
        latencies_ms.append((t1 - t0) * 1000)

    median_latency = float(np.median(latencies_ms))
    mean_latency = float(np.mean(latencies_ms))
    p95_latency = float(np.percentile(latencies_ms, 95))

    print(f"  MAE           : {mae:.2f} kW")
    print(f"  RMSE          : {rmse:.2f} kW")
    print(f"  Surge Recall  : {surge_recall * 100:.1f}%")
    print(f"  Surge events  : {actual_surge.sum()} actual, {predicted_surge.sum()} predicted")
    print(f"  Latency (100 single-sample calls):")
    print(f"    Median      : {median_latency:.3f} ms")
    print(f"    Mean        : {mean_latency:.3f} ms")
    print(f"    P95         : {p95_latency:.3f} ms")
    print("=" * 60)

    return {
        "mae_kw": round(mae, 2),
        "rmse_kw": round(rmse, 2),
        "surge_recall_pct": round(surge_recall * 100, 1),
        "latency_ms": round(median_latency, 1),
    }


def benchmark_lstm(X_test_scaled_seq, y_test_seq):
    """Benchmark LSTM in complete isolation."""
    print("\n" + "=" * 60)
    print("  LSTM INDEPENDENT BENCHMARK")
    print("=" * 60)

    device = torch.device("cpu")  # Force CPU, same as production

    # Load model fresh from disk
    n_features = X_test_scaled_seq.shape[2]
    model = LSTMPredictor(
        input_size=n_features, hidden_size=64, num_layers=2, dropout=0.2
    )
    model.load_state_dict(
        torch.load(SAVED_MODELS_DIR / "lstm_model.pt", map_location=device, weights_only=True)
    )
    model.eval()

    # --- Accuracy: run full test set ---
    X_tensor = torch.FloatTensor(X_test_scaled_seq).to(device)
    y_true = y_test_seq

    with torch.no_grad():
        y_pred_tensor = model(X_tensor)
    y_pred = y_pred_tensor.cpu().numpy()

    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))

    # --- Surge Recall (from LSTM's OWN predictions) ---
    actual_surge = y_true >= SURGE_THRESHOLD
    predicted_surge = y_pred >= SURGE_THRESHOLD
    if actual_surge.sum() > 0:
        surge_recall = (predicted_surge & actual_surge).sum() / actual_surge.sum()
    else:
        surge_recall = 1.0

    # --- Latency: 100 SINGLE-SAMPLE calls, timed individually ---
    # Shape: (1, seq_len, n_features) — exactly one sample
    single_sample = torch.FloatTensor(X_test_scaled_seq[:1]).to(device)

    # Warmup (10 calls)
    with torch.no_grad():
        for _ in range(10):
            model(single_sample)

    latencies_ms = []
    with torch.no_grad():
        for _ in range(100):
            t0 = time.perf_counter()
            _ = model(single_sample)
            t1 = time.perf_counter()
            latencies_ms.append((t1 - t0) * 1000)

    median_latency = float(np.median(latencies_ms))
    mean_latency = float(np.mean(latencies_ms))
    p95_latency = float(np.percentile(latencies_ms, 95))

    print(f"  MAE           : {mae:.2f} kW")
    print(f"  RMSE          : {rmse:.2f} kW")
    print(f"  Surge Recall  : {surge_recall * 100:.1f}%")
    print(f"  Surge events  : {actual_surge.sum()} actual, {predicted_surge.sum()} predicted")
    print(f"  Latency (100 single-sample calls):")
    print(f"    Median      : {median_latency:.3f} ms")
    print(f"    Mean        : {mean_latency:.3f} ms")
    print(f"    P95         : {p95_latency:.3f} ms")
    print("=" * 60)

    return {
        "mae_kw": round(mae, 2),
        "rmse_kw": round(rmse, 2),
        "surge_recall_pct": round(surge_recall * 100, 1),
        "latency_ms": round(median_latency, 1),
    }


def main():
    print("=" * 60)
    print("  INDEPENDENT MODEL BENCHMARK")
    print("  (fresh artifact loads, no shared state)")
    print("=" * 60)

    # --- Shared data pipeline (identical to training) ---
    print("\n[1/3] Regenerating test data from identical pipeline ...")
    df_raw = synthesize_telemetry(n_days=90, seed=42)
    df = engineer_features(df_raw)

    X_all = df[FEATURE_COLUMNS].values
    y_all = df[TARGET_COLUMN].values

    # Same temporal split as training (80/20, no shuffle)
    split_idx = int(len(X_all) * 0.8)
    X_test_raw = X_all[split_idx:]
    y_test = y_all[split_idx:]

    # Scale with a FRESH scaler fitted on train only (same as training)
    from sklearn.preprocessing import StandardScaler
    scaler = StandardScaler()
    scaler.fit(X_all[:split_idx])
    X_test_scaled = scaler.transform(X_test_raw)

    # Also create LSTM sequences from the test split
    seq_len = 8
    X_test_seq, y_test_seq = create_sequences(X_test_scaled, y_test, seq_len)

    print(f"  XGBoost test samples: {len(y_test)}")
    print(f"  LSTM test sequences:  {len(y_test_seq)}")

    # --- Run benchmarks ---
    print("\n[2/3] Benchmarking XGBoost ...")
    xgb_results = benchmark_xgboost(X_test_scaled, y_test)

    print("\n[3/3] Benchmarking LSTM ...")
    lstm_results = benchmark_lstm(X_test_seq, y_test_seq)

    # --- Summary comparison ---
    print("\n" + "=" * 60)
    print("  SIDE-BY-SIDE COMPARISON")
    print("=" * 60)
    print(f"  {'Metric':<20s} {'XGBoost':>10s} {'LSTM':>10s}")
    print(f"  {'-'*20} {'-'*10} {'-'*10}")
    print(f"  {'MAE (kW)':<20s} {xgb_results['mae_kw']:>10.2f} {lstm_results['mae_kw']:>10.2f}")
    print(f"  {'RMSE (kW)':<20s} {xgb_results['rmse_kw']:>10.2f} {lstm_results['rmse_kw']:>10.2f}")
    print(f"  {'Surge Recall (%)':<20s} {xgb_results['surge_recall_pct']:>10.1f} {lstm_results['surge_recall_pct']:>10.1f}")
    print(f"  {'Latency (ms)':<20s} {xgb_results['latency_ms']:>10.1f} {lstm_results['latency_ms']:>10.1f}")
    print("=" * 60)

    # --- Save corrected metrics ---
    print("\nSaving corrected metrics artifacts ...")
    
    # Update XGBoost metrics
    xgb_existing = joblib.load(SAVED_MODELS_DIR / "training_metrics.joblib")
    xgb_existing["latency_ms"] = xgb_results["latency_ms"]
    joblib.dump(xgb_existing, SAVED_MODELS_DIR / "training_metrics.joblib")
    print(f"  Updated training_metrics.joblib: latency_ms = {xgb_results['latency_ms']}")

    # Update LSTM metrics
    joblib.dump(lstm_results, SAVED_MODELS_DIR / "lstm_metrics.joblib")
    print(f"  Updated lstm_metrics.joblib: {lstm_results}")

    print("\n[OK] Benchmark complete. Artifacts updated with verified numbers.")


if __name__ == "__main__":
    main()
