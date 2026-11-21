"""
End-to-End Monotonicity & Derived Feature Verification Script
=============================================================
Phase C Verification Script:
  1. End-to-End Monotonicity on 300 random test rows from test_purged.parquet:
     - Perturbs raw lag columns (load_lag_15m..load_lag_60m)
     - Recomputes full shared feature assembler (assemble_features_df with how_table):
       recomputing rolling_mean_60m, rolling_std_60m, load_anomaly, lag_trend
     - Sweeps delta from -50 to +100 kW in 10 kW steps (clipped to [10, 300] kW) for:
       (i)  all four lags together
       (ii) lag_15 alone
     - Reports rows with violation, total violations, and largest single drop in kW.
  2. If violations occur in candidate xgb_v2:
     - Trains variant xgb_v2b with monotone constraint +1 on rolling_mean_60m added
     - Saves xgb_v2b.joblib, feature_names_v2b.json, metrics_v2b.json
     - Re-evaluates monotonicity and complete performance table for both models.
  3. Derived-Feature Consistency Check:
     - Recomputes features with zero perturbation
     - Compares against stored test_purged.parquet columns (max abs diff < 1e-6).

Usage:
    python backend/pipeline/verify_e2e_monotone_v2.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error

# Directory resolution
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
CANDIDATE_V2_DIR = SCRIPT_DIR / "candidate_v2"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from app.models.ml_engine import assemble_features_df
from pipeline.generator_v2 import (
    TRANSFORMER_CAPACITY_KW,
    WARNING_THRESHOLD_KW,
    CRITICAL_THRESHOLD_KW,
)


def verify_derived_features_consistency(
    test_df: pd.DataFrame,
    how_table: Any,
    feature_names: List[str],
) -> Tuple[bool, float, float]:
    """Verify that with zero perturbation, recomputed features equal stored columns."""
    print("=" * 80)
    print("  STEP 1: DERIVED-FEATURE ZERO-PERTURBATION CONSISTENCY CHECK")
    print("=" * 80)

    recomputed = assemble_features_df(test_df, is_batch=True, how_table=how_table, feature_names=feature_names)

    diff_anomaly = float(np.max(np.abs(recomputed["load_anomaly"] - test_df["load_anomaly"])))
    diff_trend = float(np.max(np.abs(recomputed["lag_trend"] - test_df["lag_trend"])))

    pass_anomaly = diff_anomaly < 1e-6
    pass_trend = diff_trend < 1e-6
    all_pass = pass_anomaly and pass_trend

    print(f"  • Stored vs Recomputed load_anomaly max abs diff : {diff_anomaly:.8e}  (Threshold: < 1e-6) -> [{'PASS' if pass_anomaly else 'FAIL'}]")
    print(f"  • Stored vs Recomputed lag_trend max abs diff    : {diff_trend:.8e}  (Threshold: < 1e-6) -> [{'PASS' if pass_trend else 'FAIL'}]")
    print(f"  • Derived Features Consistency Status           : [{'PASS' if all_pass else 'FAIL'}]")
    print("=" * 80 + "\n")

    return all_pass, diff_anomaly, diff_trend


def run_e2e_monotonicity_test(
    model: xgb.XGBRegressor,
    sampled_rows: pd.DataFrame,
    how_table: Any,
    feature_names: List[str],
    model_name: str = "xgb_v2",
) -> Dict[str, Any]:
    """Test monotonicity across 300 rows by fully re-running assemble_features_df."""
    sweep_deltas = np.arange(-50, 101, 10)  # -50, -40, ..., +100 (16 levels)
    n_samples = len(sampled_rows)

    # -------------------------------------------------------------
    # (i) All four lags together
    # -------------------------------------------------------------
    rows_viol_i = 0
    tot_viol_i = 0
    max_drop_i = 0.0

    # Build entire grid of (n_samples * 16) rows for fast vectorized feature assembly & inference
    records_i = []
    for row_idx, row in sampled_rows.iterrows():
        for d in sweep_deltas:
            r = row.to_dict()
            for col in ["load_lag_15m", "load_lag_30m", "load_lag_45m", "load_lag_60m"]:
                r[col] = np.clip(float(r[col]) + d, 10.0, 300.0)
            records_i.append(r)

    df_grid_i = pd.DataFrame(records_i)
    feats_grid_i = assemble_features_df(df_grid_i, is_batch=True, how_table=how_table, feature_names=feature_names)
    preds_grid_i = model.predict(feats_grid_i.astype(float)).reshape(n_samples, len(sweep_deltas))

    for i in range(n_samples):
        diffs = np.diff(preds_grid_i[i])
        viols = diffs < -1e-5
        if np.any(viols):
            rows_viol_i += 1
            tot_viol_i += int(viols.sum())
            max_d = float(np.max(-diffs[viols]))
            if max_d > max_drop_i:
                max_drop_i = max_d

    # -------------------------------------------------------------
    # (ii) lag_15 alone
    # -------------------------------------------------------------
    rows_viol_ii = 0
    tot_viol_ii = 0
    max_drop_ii = 0.0

    records_ii = []
    for row_idx, row in sampled_rows.iterrows():
        for d in sweep_deltas:
            r = row.to_dict()
            r["load_lag_15m"] = np.clip(float(r["load_lag_15m"]) + d, 10.0, 300.0)
            records_ii.append(r)

    df_grid_ii = pd.DataFrame(records_ii)
    feats_grid_ii = assemble_features_df(df_grid_ii, is_batch=True, how_table=how_table, feature_names=feature_names)
    preds_grid_ii = model.predict(feats_grid_ii.astype(float)).reshape(n_samples, len(sweep_deltas))

    for i in range(n_samples):
        diffs = np.diff(preds_grid_ii[i])
        viols = diffs < -1e-5
        if np.any(viols):
            rows_viol_ii += 1
            tot_viol_ii += int(viols.sum())
            max_d = float(np.max(-diffs[viols]))
            if max_d > max_drop_ii:
                max_drop_ii = max_d

    return {
        "model_name": model_name,
        "n_samples": n_samples,
        "all_four_lags": {
            "rows_with_violation": rows_viol_i,
            "total_violations": tot_viol_i,
            "max_drop_kw": max_drop_i,
        },
        "lag_15_alone": {
            "rows_with_violation": rows_viol_ii,
            "total_violations": tot_viol_ii,
            "max_drop_kw": max_drop_ii,
        },
    }


def train_xgb_v2b_variant(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    feature_names: List[str],
    seed: int = 42,
) -> xgb.XGBRegressor:
    """Train variant xgb_v2b with monotone constraint +1 on rolling_mean_60m added."""
    print("=" * 80)
    print("  TRAINING VARIANT: XGBOOST V2B (+1 ON ROLLING_MEAN_60M)")
    print("=" * 80)

    monotone_constraints_v2b = {
        "load_lag_15m": 1,
        "load_lag_30m": 1,
        "load_lag_45m": 1,
        "load_lag_60m": 1,
        "rolling_mean_60m": 1,  # Added monotone constraint
        "load_anomaly": 1,
        "lag_trend": 1,
    }

    X_train = train_df[feature_names]
    y_train = train_df["target_load_2h"]
    X_val = val_df[feature_names]
    y_val = val_df["target_load_2h"]

    print(f"  Monotone constraints for v2b: {monotone_constraints_v2b}")
    model_v2b = xgb.XGBRegressor(
        n_estimators=1000,
        learning_rate=0.05,
        max_depth=5,
        subsample=0.8,
        colsample_bytree=0.8,
        monotone_constraints=monotone_constraints_v2b,
        early_stopping_rounds=30,
        random_state=seed,
        eval_metric="mae",
        n_jobs=-1,
    )

    model_v2b.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)
    print(f"  Training complete for xgb_v2b. Best iteration: {model_v2b.best_iteration}")

    # Save artifacts
    model_path = CANDIDATE_V2_DIR / "xgb_v2b.joblib"
    feat_path = CANDIDATE_V2_DIR / "feature_names_v2b.json"
    metrics_path = CANDIDATE_V2_DIR / "metrics_v2b.json"

    joblib.dump(model_v2b, model_path)
    with open(feat_path, "w") as f:
        json.dump(feature_names, f, indent=2)

    pred_tr = model_v2b.predict(X_train)
    pred_va = model_v2b.predict(X_val)
    metrics_v2b = {
        "model": "XGBRegressor_v2b_monotone_rolling_mean",
        "random_seed": seed,
        "best_iteration": int(model_v2b.best_iteration),
        "monotone_constraints": monotone_constraints_v2b,
        "train_mae": round(float(mean_absolute_error(y_train, pred_tr)), 3),
        "val_mae": round(float(mean_absolute_error(y_val, pred_va)), 3),
    }
    with open(metrics_path, "w") as f:
        json.dump(metrics_v2b, f, indent=2)

    print(f"  Saved candidate_v2/xgb_v2b.joblib, feature_names_v2b.json, metrics_v2b.json")
    print("=" * 80 + "\n")
    return model_v2b


def compute_eval_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
) -> Dict[str, float]:
    """Helper to compute MAE, RMSE, Rule A Recall, and Rule B Recall."""
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))

    actual_surge = y_true >= CRITICAL_THRESHOLD_KW
    pred_rule_a = y_pred >= CRITICAL_THRESHOLD_KW
    pred_rule_b = y_pred >= WARNING_THRESHOLD_KW

    rec_a = float((actual_surge & pred_rule_a).sum() / actual_surge.sum()) if actual_surge.sum() > 0 else 1.0
    rec_b = float((actual_surge & pred_rule_b).sum() / actual_surge.sum()) if actual_surge.sum() > 0 else 1.0

    prec_a = float((actual_surge & pred_rule_a).sum() / pred_rule_a.sum()) if pred_rule_a.sum() > 0 else 0.0
    prec_b = float((actual_surge & pred_rule_b).sum() / pred_rule_b.sum()) if pred_rule_b.sum() > 0 else 0.0

    return {
        "mae": mae,
        "rmse": rmse,
        "rec_a": rec_a,
        "prec_a": prec_a,
        "rec_b": rec_b,
        "prec_b": prec_b,
    }


def main(seed: int = 42) -> None:
    print("=" * 80)
    print("  EV SURGE PREDICTOR — END-TO-END MONOTONICITY VERIFICATION (PHASE C.1)")
    print(f"  Candidate Directory: {CANDIDATE_V2_DIR}")
    print("=" * 80)

    # 1. Load data and models
    test_df = pd.read_parquet(CANDIDATE_V2_DIR / "test_purged.parquet")
    train_df = pd.read_parquet(CANDIDATE_V2_DIR / "train_purged.parquet")
    val_df = pd.read_parquet(CANDIDATE_V2_DIR / "val_purged.parquet")
    how_table = joblib.load(CANDIDATE_V2_DIR / "hour_of_week_mean.joblib")
    model_v2 = joblib.load(CANDIDATE_V2_DIR / "xgb_v2.joblib")

    with open(CANDIDATE_V2_DIR / "feature_names_v2.json") as f:
        feature_names = json.load(f)

    # 2. Derived-feature consistency
    verify_derived_features_consistency(test_df, how_table, feature_names)

    # 3. End-to-end monotonicity test on xgb_v2
    print("=" * 80)
    print("  STEP 2: RUNNING END-TO-END MONOTONICITY ON CANDIDATE (XGB_V2)")
    print("=" * 80)
    sampled_300 = test_df.sample(n=300, random_state=seed).copy()
    res_v2 = run_e2e_monotonicity_test(model_v2, sampled_300, how_table, feature_names, model_name="xgb_v2")

    print(f"  [XGBoost v2 (Baseline Candidate)]")
    print(f"    (i)  All four lags together sweep:")
    print(f"         • Rows with any violation : {res_v2['all_four_lags']['rows_with_violation']} / 300 ({res_v2['all_four_lags']['rows_with_violation']/3:.1f}%)")
    print(f"         • Total violation steps   : {res_v2['all_four_lags']['total_violations']}")
    print(f"         • Largest single drop     : {res_v2['all_four_lags']['max_drop_kw']:.4f} kW")
    print(f"    (ii) lag_15 alone sweep:")
    print(f"         • Rows with any violation : {res_v2['lag_15_alone']['rows_with_violation']} / 300 ({res_v2['lag_15_alone']['rows_with_violation']/3:.1f}%)")
    print(f"         • Total violation steps   : {res_v2['lag_15_alone']['total_violations']}")
    print(f"         • Largest single drop     : {res_v2['lag_15_alone']['max_drop_kw']:.4f} kW")

    has_violations = (
        res_v2["all_four_lags"]["total_violations"] > 0
        or res_v2["lag_15_alone"]["total_violations"] > 0
    )

    # 4. Train variant xgb_v2b if violations detected
    if has_violations:
        print("\n  >> Violations detected in xgb_v2 due to unconstrained rolling_mean_60m / rolling_std_60m.")
        print("  >> Training variant xgb_v2b with monotone constraint +1 on rolling_mean_60m added...")
        model_v2b = train_xgb_v2b_variant(train_df, val_df, feature_names, seed=seed)
        res_v2b = run_e2e_monotonicity_test(model_v2b, sampled_300, how_table, feature_names, model_name="xgb_v2b")

        print("=" * 80)
        print("  STEP 3: MONOTONICITY COMPARISON (XGB_V2 vs XGB_V2B)")
        print("=" * 80)
        print(f"{'Metric':<35} | {'xgb_v2 (Original)':>20} | {'xgb_v2b (+1 rolling_mean)':>25}")
        print("-" * 86)
        print(f"{'(i)  All Lags Violations (rows)':<35} | {res_v2['all_four_lags']['rows_with_violation']:14d} / 300 | {res_v2b['all_four_lags']['rows_with_violation']:19d} / 300")
        print(f"{'(i)  All Lags Total Violations':<35} | {res_v2['all_four_lags']['total_violations']:20d} | {res_v2b['all_four_lags']['total_violations']:25d}")
        print(f"{'(i)  All Lags Largest Drop':<35} | {res_v2['all_four_lags']['max_drop_kw']:17.4f} kW | {res_v2b['all_four_lags']['max_drop_kw']:22.4f} kW")
        print("-" * 86)
        print(f"{'(ii) lag_15 Alone Violations (rows)':<35} | {res_v2['lag_15_alone']['rows_with_violation']:14d} / 300 | {res_v2b['lag_15_alone']['rows_with_violation']:19d} / 300")
        print(f"{'(ii) lag_15 Alone Total Violations':<35} | {res_v2['lag_15_alone']['total_violations']:20d} | {res_v2b['lag_15_alone']['total_violations']:25d}")
        print(f"{'(ii) lag_15 Alone Largest Drop':<35} | {res_v2['lag_15_alone']['max_drop_kw']:17.4f} kW | {res_v2b['lag_15_alone']['max_drop_kw']:22.4f} kW")
        print("-" * 86)

        # 5. Performance table comparison on TEST (Overall & Event Days)
        print("\n" + "=" * 80)
        print("  STEP 4: TEST SET PERFORMANCE COMPARISON (XGB_V2 vs XGB_V2B)")
        print("=" * 80)

        X_test = test_df[feature_names]
        y_test = test_df["target_load_2h"].to_numpy()
        pred_v2 = model_v2.predict(X_test)
        pred_v2b = model_v2b.predict(X_test)

        ev_mask = (test_df["day_type"] == "event").to_numpy()

        perf_v2_all = compute_eval_metrics(y_test, pred_v2)
        perf_v2b_all = compute_eval_metrics(y_test, pred_v2b)

        perf_v2_ev = compute_eval_metrics(y_test[ev_mask], pred_v2[ev_mask])
        perf_v2b_ev = compute_eval_metrics(y_test[ev_mask], pred_v2b[ev_mask])

        print(f"{'Slice / Model':<30} | {'MAE (kW)':>8} | {'RMSE (kW)':>9} | {'Rule A Recall':>13} | {'Rule B Recall':>13}")
        print("-" * 82)
        print(f"{'OVERALL — xgb_v2':<30} | {perf_v2_all['mae']:8.2f} | {perf_v2_all['rmse']:9.2f} | {perf_v2_all['rec_a']*100:12.1f}% | {perf_v2_all['rec_b']*100:12.1f}%")
        print(f"{'OVERALL — xgb_v2b':<30} | {perf_v2b_all['mae']:8.2f} | {perf_v2b_all['rmse']:9.2f} | {perf_v2b_all['rec_a']*100:12.1f}% | {perf_v2b_all['rec_b']*100:12.1f}%")
        print("-" * 82)
        print(f"{'EVENT DAYS — xgb_v2':<30} | {perf_v2_ev['mae']:8.2f} | {perf_v2_ev['rmse']:9.2f} | {perf_v2_ev['rec_a']*100:12.1f}% | {perf_v2_ev['rec_b']*100:12.1f}%")
        print(f"{'EVENT DAYS — xgb_v2b':<30} | {perf_v2b_ev['mae']:8.2f} | {perf_v2b_ev['rmse']:9.2f} | {perf_v2b_ev['rec_a']*100:12.1f}% | {perf_v2b_ev['rec_b']*100:12.1f}%")
        print("=" * 80 + "\n")


if __name__ == "__main__":
    main(seed=42)
