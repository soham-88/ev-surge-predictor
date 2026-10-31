"""
EV Charging Surge Predictor — Artifact Verification Script
==========================================================
Loads trained models (XGBoost, LSTM) and their corresponding scalers
from disk, re-evaluates them on the standard test split, compares the
recalculated metrics against stored .joblib metrics files, prints a
detailed PASS/FAIL table, and exits non-zero if any metric mismatches.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import joblib
import numpy as np
import torch
from sklearn.metrics import mean_absolute_error, mean_squared_error

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent

if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from train import (
    synthesize_telemetry,
    engineer_features,
    FEATURE_COLUMNS,
    TARGET_COLUMN,
)
from train_lstm import LSTMPredictor, create_sequences, evaluate_lstm

env_models_dir = os.getenv("SAVED_MODELS_DIR")
SAVED_MODELS_DIR = Path(env_models_dir).resolve() if env_models_dir else BACKEND_DIR / "saved_models"


def verify_artifacts() -> bool:
    print("=" * 80)
    print("  EV SURGE PREDICTOR — MODEL ARTIFACT REPRODUCIBILITY VERIFICATION")
    print(f"  Artifact Directory: {SAVED_MODELS_DIR}")
    print("=" * 80)

    # 1. Load XGBoost artifacts
    print("\n[1/4] Loading XGBoost artifacts ...")
    xgb_model_path = SAVED_MODELS_DIR / "xgboost_model.joblib"
    xgb_scaler_path = SAVED_MODELS_DIR / "scaler.joblib"
    xgb_metrics_path = SAVED_MODELS_DIR / "training_metrics.joblib"

    for p in [xgb_model_path, xgb_scaler_path, xgb_metrics_path]:
        if not p.exists():
            print(f"[FAIL] Missing required artifact: {p.name}")
            return False

    model_xgb = joblib.load(xgb_model_path)
    scaler_xgb = joblib.load(xgb_scaler_path)
    stored_xgb = joblib.load(xgb_metrics_path)

    # 2. Load LSTM artifacts
    print("[2/4] Loading LSTM artifacts ...")
    lstm_model_path = SAVED_MODELS_DIR / "lstm_model.pt"
    lstm_scaler_path = SAVED_MODELS_DIR / "lstm_scaler.joblib"
    lstm_metrics_path = SAVED_MODELS_DIR / "lstm_metrics.joblib"

    for p in [lstm_model_path, lstm_scaler_path, lstm_metrics_path]:
        if not p.exists():
            print(f"[FAIL] Missing required artifact: {p.name}")
            return False

    device = torch.device("cpu")
    model_lstm = LSTMPredictor(input_size=len(FEATURE_COLUMNS), hidden_size=64, num_layers=2, dropout=0.2).to(device)
    model_lstm.load_state_dict(torch.load(lstm_model_path, map_location=device, weights_only=True))
    model_lstm.eval()
    scaler_lstm = joblib.load(lstm_scaler_path)
    stored_lstm = joblib.load(lstm_metrics_path)

    # 3. Re-generate test split
    print("[3/4] Re-generating standard test split (seed=42, 90 days) ...")
    df_raw = synthesize_telemetry(n_days=90, seed=42)
    df = engineer_features(df_raw)

    X_all = df[FEATURE_COLUMNS].values
    y_all = df[TARGET_COLUMN].values
    split_idx = int(len(X_all) * 0.8)
    X_test_raw = X_all[split_idx:]
    y_test_raw = y_all[split_idx:]

    # 4. Re-evaluate XGBoost
    X_test_xgb_scaled = scaler_xgb.transform(X_test_raw)
    y_pred_xgb = model_xgb.predict(X_test_xgb_scaled)
    mae_xgb = float(mean_absolute_error(y_test_raw, y_pred_xgb))
    rmse_xgb = float(np.sqrt(mean_squared_error(y_test_raw, y_pred_xgb)))
    TRANSFORMER_CAPACITY = 250.0
    SURGE_THRESHOLD = 0.80 * TRANSFORMER_CAPACITY  # 200.0 kW
    actual_surge = y_test_raw >= SURGE_THRESHOLD
    predicted_surge_xgb = y_pred_xgb >= SURGE_THRESHOLD
    recall_xgb = float((predicted_surge_xgb & actual_surge).sum() / actual_surge.sum() * 100.0)

    # 5. Re-evaluate LSTM
    X_test_lstm_scaled = scaler_lstm.transform(X_test_raw)
    seq_len = int(stored_lstm.get("seq_len", 8))
    X_test_seq, y_test_seq = create_sequences(X_test_lstm_scaled, y_test_raw, seq_len=seq_len)
    mae_lstm, rmse_lstm, recall_lstm, _ = evaluate_lstm(model_lstm, X_test_seq, y_test_seq, device)

    # 6. Verification Table
    print("\n[4/4] Comparing re-evaluated metrics with stored metrics ...\n")
    checks = [
        # Model, Metric, Stored, Recalculated, Tolerance
        ("XGBoost", "MAE (kW)", float(stored_xgb["mae_kw"]), round(mae_xgb, 2), 0.01),
        ("XGBoost", "RMSE (kW)", float(stored_xgb["rmse_kw"]), round(rmse_xgb, 2), 0.01),
        ("XGBoost", "Surge Recall (%)", float(stored_xgb["surge_recall_pct"]), round(recall_xgb, 1), 0.1),
        ("LSTM", "MAE (kW)", float(stored_lstm["mae_kw"]), round(mae_lstm, 2), 0.01),
        ("LSTM", "RMSE (kW)", float(stored_lstm["rmse_kw"]), round(rmse_lstm, 2), 0.01),
        ("LSTM", "Surge Recall (%)", float(stored_lstm["surge_recall_pct"]), round(recall_lstm, 1), 0.1),
    ]

    all_passed = True
    print(f"{'Model':<10s} | {'Metric':<18s} | {'Stored':>10s} | {'Re-evaluated':>14s} | {'Diff':>10s} | {'Status':<6s}")
    print("-" * 80)

    for model_name, metric_name, stored_val, recalc_val, tol in checks:
        diff = abs(stored_val - recalc_val)
        passed = diff <= tol
        status = "PASS" if passed else "FAIL"
        if not passed:
            all_passed = False
        print(f"{model_name:<10s} | {metric_name:<18s} | {stored_val:>10.2f} | {recalc_val:>14.2f} | {diff:>10.4f} | {status:<6s}")

    print("-" * 80)
    if all_passed:
        print("\n>>> ALL SAVED ARTIFACTS ARE 100% HONEST AND REPRODUCIBLE. [PASS]\n")
    else:
        print("\n>>> VERIFICATION FAILED: One or more stored metrics do not match re-evaluated results. [FAIL]\n")

    return all_passed


if __name__ == "__main__":
    success = verify_artifacts()
    sys.exit(0 if success else 1)
