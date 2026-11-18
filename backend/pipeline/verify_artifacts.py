"""
EV Charging Surge Predictor — Model Artifact Reproducibility & Integrity Verification
======================================================================================
Comprehensive v2 production verification suite:
  1. Artifacts existence & dimension agreement (17 features everywhere).
  2. Inference sanity & finite predictions on v2 CI test fixture (MAE in [8, 18] kW).
  3. TreeSHAP local additivity (< 1e-3 kW error on 50 fixture rows).
  4. Monotonicity property (0 drops on 50 fixture rows swept 0..+100 kW across lags).
  5. Binned interval calibration (sorted bins & fixture coverage in [0.72, 0.88]).
  6. Production metrics joblib parity (v1 keys + v2 keys, surge_recall == rule_a_recall).
  7. PyTorch LSTM benchmark model loading and forward pass execution.

Does NOT regenerate the dataset; executes deterministically on backend/tests/fixtures/v2_test_sample.csv.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
import torch
from sklearn.metrics import mean_absolute_error, mean_squared_error

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from app.core.timezone import to_station_local
from app.models.ml_engine import assemble_features_df
from pipeline.train_lstm import LSTMPredictor

env_models_dir = os.getenv("SAVED_MODELS_DIR")
SAVED_MODELS_DIR = Path(env_models_dir).resolve() if env_models_dir else BACKEND_DIR / "saved_models"
FIXTURE_PATH = BACKEND_DIR / "tests" / "fixtures" / "v2_test_sample.csv"


def verify_artifacts() -> bool:
    print("=" * 80)
    print("  EV SURGE PREDICTOR — MODEL v2 ARTIFACT VERIFICATION SUITE")
    print(f"  Artifact Directory : {SAVED_MODELS_DIR}")
    print(f"  Test Fixture Path  : {FIXTURE_PATH.relative_to(BACKEND_DIR)}")
    print("=" * 80)

    all_pass = True

    # ──────────────────────────────────────────────────────────
    # Check 1: Artifact Existence & Dimension Agreement
    # ──────────────────────────────────────────────────────────
    print("\n[1/7] Checking Artifact Existence & Dimension Agreement ...")
    required_files = [
        "xgboost_model.joblib",
        "global_shap_importance.joblib",
        "training_metrics.joblib",
        "lstm_metrics.joblib",
        "lstm_model.pt",
        "lstm_scaler.joblib",
        "feature_names.joblib",
        "interval_calibration.joblib",
        "hour_of_week_mean.joblib",
        "lstm_v2_config.json",
    ]

    for fname in required_files:
        fpath = SAVED_MODELS_DIR / fname
        if not fpath.exists():
            print(f"  [FAIL] Missing required artifact: {fname}")
            return False

    model_xgb = joblib.load(SAVED_MODELS_DIR / "xgboost_model.joblib")

    shap_path = SAVED_MODELS_DIR / "shap_explainer.joblib"
    if shap_path.exists():
        try:
            explainer = joblib.load(shap_path)
            print("  • SHAP explainer       : present on disk (loaded from file)")
        except Exception as e:
            import shap
            explainer = shap.TreeExplainer(model_xgb)
            print(f"  • SHAP explainer       : unreadable ({e}), built in-memory via TreeExplainer")
    else:
        import shap
        explainer = shap.TreeExplainer(model_xgb)
        print("  • SHAP explainer       : missing (will be built at startup)")

    global_shap = joblib.load(SAVED_MODELS_DIR / "global_shap_importance.joblib")
    training_metrics = joblib.load(SAVED_MODELS_DIR / "training_metrics.joblib")
    lstm_metrics = joblib.load(SAVED_MODELS_DIR / "lstm_metrics.joblib")
    scaler_lstm = joblib.load(SAVED_MODELS_DIR / "lstm_scaler.joblib")
    feature_names = joblib.load(SAVED_MODELS_DIR / "feature_names.joblib")
    interval_cal = joblib.load(SAVED_MODELS_DIR / "interval_calibration.joblib")
    how_table = joblib.load(SAVED_MODELS_DIR / "hour_of_week_mean.joblib")
    with open(SAVED_MODELS_DIR / "lstm_v2_config.json", "r") as f:
        lstm_config = json.load(f)

    # Confirm 15-feature scaler is NOT present
    if (SAVED_MODELS_DIR / "scaler.joblib").exists():
        print("  [FAIL] Legacy 15-feature scaler.joblib still exists in saved_models/!")
        all_pass = False

    dim_xgb = model_xgb.n_features_in_ == 17
    dim_fnames = len(feature_names) == 17
    dim_scaler_lstm = scaler_lstm.n_features_in_ == 17
    dim_config = lstm_config["input_size"] == 17
    dim_global_shap = global_shap["total_features"] == 17 and len(global_shap["feature_importances"]) == 17
    dim_how = len(how_table) == 168

    test_dummy = explainer.shap_values(np.zeros((1, 17)))
    dim_explainer = test_dummy.shape[1] == 17

    c1_pass = dim_xgb and dim_fnames and dim_scaler_lstm and dim_config and dim_global_shap and dim_how and dim_explainer
    print(f"  • XGBoost features     : {model_xgb.n_features_in_} (expected 17)")
    print(f"  • Feature names count  : {len(feature_names)} (expected 17)")
    print(f"  • LSTM input size      : {lstm_config['input_size']} (expected 17)")
    print(f"  • Global SHAP features : {global_shap['total_features']} (expected 17)")
    print(f"  • Hour-of-week cells   : {len(how_table)} (expected 168)")
    print(f"  • Dimensions Check     : [{'PASS' if c1_pass else 'FAIL'}]")
    all_pass = all_pass and c1_pass

    # ──────────────────────────────────────────────────────────
    # Check 2: Inference & Fixture MAE
    # ──────────────────────────────────────────────────────────
    print("\n[2/7] Running Inference & Fixture MAE Evaluation ...")
    if not FIXTURE_PATH.exists():
        print(f"  [FAIL] Fixture not found at {FIXTURE_PATH}")
        return False

    df_fixture = pd.read_csv(FIXTURE_PATH)
    if "timestamp" in df_fixture.columns:
        df_fixture["timestamp"] = pd.to_datetime(df_fixture["timestamp"])

    feats_df = assemble_features_df(
        df_fixture,
        is_batch=True,
        how_table=how_table,
        feature_names=feature_names,
    )

    preds = model_xgb.predict(feats_df).astype(np.float64)
    preds_finite = bool(np.all(np.isfinite(preds)))

    y_true = df_fixture["target_load_2h"].values.astype(np.float64)
    mae_fixture = float(mean_absolute_error(y_true, preds))
    rmse_fixture = float(np.sqrt(mean_squared_error(y_true, preds)))

    c2_pass = preds_finite and (8.0 <= mae_fixture <= 18.0)
    print(f"  • Rows evaluated   : {len(preds):,} rows")
    print(f"  • Predictions finite : {preds_finite}")
    print(f"  • Fixture MAE      : {mae_fixture:.2f} kW (expected in [8.0, 18.0] kW)")
    print(f"  • Fixture RMSE     : {rmse_fixture:.2f} kW")
    print(f"  • Inference Check  : [{'PASS' if c2_pass else 'FAIL'}]")
    all_pass = all_pass and c2_pass

    # ──────────────────────────────────────────────────────────
    # Check 3: TreeSHAP Local Additivity
    # ──────────────────────────────────────────────────────────
    print("\n[3/7] Verifying TreeSHAP Local Additivity on 50 Fixture Rows ...")
    sample_50 = feats_df.iloc[:50]
    shap_vals_50 = explainer.shap_values(sample_50)
    base_val = float(explainer.expected_value)
    preds_50 = model_xgb.predict(sample_50)

    shap_reconstructed = base_val + np.sum(shap_vals_50, axis=1)
    max_shap_err = float(np.max(np.abs(shap_reconstructed - preds_50)))

    c3_pass = max_shap_err < 1e-3
    print(f"  • Base value (expected load) : {base_val:.4f} kW")
    print(f"  • Max |base + sum(shap) - pred| : {max_shap_err:.6e} kW (Required: < 1.0e-3)")
    print(f"  • SHAP Additivity Check      : [{'PASS' if c3_pass else 'FAIL'}]")
    all_pass = all_pass and c3_pass

    # ──────────────────────────────────────────────────────────
    # Check 4: Monotone Property Test
    # ──────────────────────────────────────────────────────────
    print("\n[4/7] Testing End-to-End Monotonicity on 50 Random Rows (Lags Sweep 0..+100 kW) ...")
    lag_cols = ["load_lag_15m", "load_lag_30m", "load_lag_45m", "load_lag_60m"]
    max_lag_series = df_fixture[lag_cols].max(axis=1)
    eligible_indices = df_fixture.index[max_lag_series <= 190.0]

    rng = np.random.RandomState(42)
    test_sample_indices = rng.choice(eligible_indices, size=min(50, len(eligible_indices)), replace=False)

    violations = 0
    max_drop = 0.0

    for idx in test_sample_indices:
        base_row = df_fixture.loc[idx]
        prev_plugs = float(base_row["active_plugs"])
        h = base_row["timestamp"].hour + base_row["timestamp"].minute / 60.0
        d = base_row["timestamp"].weekday()

        deltas = np.arange(0, 101, 10)
        pert_preds = []

        for delta in deltas:
            row_dict = {
                "ambient_temp_c": base_row["ambient_temp_c"],
                "traffic_inflow_index": base_row["traffic_inflow_index"],
                "active_plugs": base_row["active_plugs"],
                "grid_frequency_hz": base_row["grid_frequency_hz"],
                "load_lag_15m": base_row["load_lag_15m"] + delta,
                "load_lag_30m": base_row["load_lag_30m"] + delta,
                "load_lag_45m": base_row["load_lag_45m"] + delta,
                "load_lag_60m": base_row["load_lag_60m"] + delta,
                "hour": h,
                "day_of_week": d,
                "timestamp": base_row["timestamp"],
            }
            pert_df = pd.DataFrame([row_dict])
            pert_feats = assemble_features_df(
                pert_df,
                is_batch=False,
                how_table=how_table,
                feature_names=feature_names,
                prev_active_plugs=prev_plugs,
            )
            p = float(model_xgb.predict(pert_feats.astype(float))[0])
            pert_preds.append(p)

        pert_preds = np.array(pert_preds)
        diffs = np.diff(pert_preds)
        neg_diffs = diffs[diffs < -1e-5]
        if len(neg_diffs) > 0:
            violations += len(neg_diffs)
            max_drop = max(max_drop, float(np.abs(np.min(neg_diffs))))

    c4_pass = violations == 0
    print(f"  • Rows swept         : {len(test_sample_indices)} rows across 11 perturbation levels [0..100 kW]")
    print(f"  • Monotone drops     : {violations} violations")
    print(f"  • Max drop magnitude : {max_drop:.6f} kW")
    print(f"  • Monotonicity Check : [{'PASS' if c4_pass else 'FAIL'}]")
    all_pass = all_pass and c4_pass

    # ──────────────────────────────────────────────────────────
    # Check 5: Binned Interval Calibration
    # ──────────────────────────────────────────────────────────
    print("\n[5/7] Verifying Interval Calibration & Fixture Coverage ...")
    bins = interval_cal.get("bins", [])
    has_bins = len(bins) == 3

    # Check bins are sorted by pred_min_kw
    bins_sorted = (
        bins[0].get("pred_min_kw") is None
        and bins[1].get("pred_min_kw") == 100.0
        and bins[2].get("pred_min_kw") == 160.0
    )

    # Compute coverage across fixture
    lower_bounds = []
    upper_bounds = []
    for p in preds:
        q10, q90 = None, None
        for b in bins:
            p_min = b.get("pred_min_kw")
            p_max = b.get("pred_max_kw")
            if p_min is None and p_max is not None and p < p_max:
                q10, q90 = float(b["q10_kw"]), float(b["q90_kw"])
                break
            elif p_min is not None and p_max is not None and (p_min <= p < p_max):
                q10, q90 = float(b["q10_kw"]), float(b["q90_kw"])
                break
            elif p_min is not None and p_max is None and p >= p_min:
                q10, q90 = float(b["q10_kw"]), float(b["q90_kw"])
                break
        if q10 is None:
            q10, q90 = float(interval_cal["q10_kw"]), float(interval_cal["q90_kw"])
        lower_bounds.append(max(0.0, p + q10))
        upper_bounds.append(max(p, p + q90))

    lower_bounds = np.array(lower_bounds)
    upper_bounds = np.array(upper_bounds)
    in_interval = (y_true >= lower_bounds) & (y_true <= upper_bounds)
    fixture_coverage = float(in_interval.mean())

    c5_pass = has_bins and bins_sorted and (0.72 <= fixture_coverage <= 0.88)
    print(f"  • Binned interval structure : {len(bins)} bins (sorted: {bins_sorted})")
    print(f"  • Fixture 80% coverage      : {fixture_coverage*100:.2f}% (expected in [72%, 88%])")
    print(f"  • Interval Calibration Check: [{'PASS' if c5_pass else 'FAIL'}]")
    all_pass = all_pass and c5_pass

    # ──────────────────────────────────────────────────────────
    # Check 6: Metrics Artifacts Parity
    # ──────────────────────────────────────────────────────────
    print("\n[6/7] Verifying Training & LSTM Metrics Parity ...")
    v1_xgb_keys = {"mae_kw", "rmse_kw", "surge_recall_pct", "latency_ms", "n_train", "n_test", "n_features"}
    v2_xgb_keys = {"rule_a_recall_pct", "early_warning_recall_pct", "rule_a_precision_pct", "latency_model_only_ms", "latency_end_to_end_ms", "n_test_samples", "latency_notes"}
    v1_lstm_keys = {"mae_kw", "rmse_kw", "surge_recall_pct", "latency_ms", "n_test_sequences", "seq_len", "trained_at"}
    v2_lstm_keys = {"rule_a_recall_pct", "early_warning_recall_pct", "rule_a_precision_pct", "latency_model_only_ms", "latency_end_to_end_ms", "n_test_samples", "latency_notes"}

    k_xgb = v1_xgb_keys.issubset(training_metrics.keys()) and v2_xgb_keys.issubset(training_metrics.keys())
    k_lstm = v1_lstm_keys.issubset(lstm_metrics.keys()) and v2_lstm_keys.issubset(lstm_metrics.keys())

    recall_parity_xgb = training_metrics["surge_recall_pct"] == training_metrics["rule_a_recall_pct"]
    recall_parity_lstm = lstm_metrics["surge_recall_pct"] == lstm_metrics["rule_a_recall_pct"]

    c6_pass = k_xgb and k_lstm and recall_parity_xgb and recall_parity_lstm
    print(f"  • XGBoost metrics keys : all {len(v1_xgb_keys | v2_xgb_keys)} present")
    print(f"  • LSTM metrics keys    : all {len(v1_lstm_keys | v2_lstm_keys)} present")
    print(f"  • XGBoost surge recall == rule A recall : {recall_parity_xgb} ({training_metrics['surge_recall_pct']}%)")
    print(f"  • LSTM surge recall == rule A recall    : {recall_parity_lstm} ({lstm_metrics['surge_recall_pct']}%)")
    print(f"  • Metrics Parity Check : [{'PASS' if c6_pass else 'FAIL'}]")
    all_pass = all_pass and c6_pass

    # ──────────────────────────────────────────────────────────
    # Check 7: PyTorch LSTM Benchmark Model
    # ──────────────────────────────────────────────────────────
    print("\n[7/7] Loading PyTorch LSTM Model & Executing Forward Pass ...")
    device = torch.device("cpu")
    model_lstm = LSTMPredictor(
        input_size=lstm_config["input_size"],
        hidden_size=lstm_config["hidden_size"],
        num_layers=lstm_config["num_layers"],
        dropout=lstm_config["dropout"],
    ).to(device)

    model_lstm.load_state_dict(torch.load(SAVED_MODELS_DIR / "lstm_model.pt", map_location=device, weights_only=True))
    model_lstm.eval()

    dummy_seq = torch.zeros((1, 8, 17), dtype=torch.float32)
    with torch.no_grad():
        lstm_out = model_lstm(dummy_seq)
    lstm_val = float(lstm_out.squeeze().numpy())
    c7_pass = np.isfinite(lstm_val)

    print(f"  • LSTM State Dict loaded : input_size=17, seq_len=8")
    print(f"  • Sample forward pass    : output={lstm_val:.2f} kW (finite: {c7_pass})")
    print(f"  • LSTM Verification Check: [{'PASS' if c7_pass else 'FAIL'}]")
    all_pass = all_pass and c7_pass

    # ──────────────────────────────────────────────────────────
    # Overall Summary
    # ──────────────────────────────────────────────────────────
    print("\n" + "=" * 80)
    print(f"  OVERALL ARTIFACT VERIFICATION STATUS: [{'PASS' if all_pass else 'FAIL'}]")
    print("=" * 80)

    return all_pass


if __name__ == "__main__":
    success = verify_artifacts()
    sys.exit(0 if success else 1)
