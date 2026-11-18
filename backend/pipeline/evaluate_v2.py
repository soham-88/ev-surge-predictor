"""
Comprehensive Model v2 Evaluation & Verification Script
========================================================
Phase B Evaluation Script:
  1. Loads purged train/test datasets and trained candidate artifacts:
     - candidate_v2/xgb_v2.joblib
     - candidate_v2/feature_names_v2.json
     - candidate_v2/hour_of_week_mean.joblib
  2. Refits Baseline 3 OLS parameter k on train_purged.
  3. Evaluates 4 forecasters on test_purged:
     - 1. Persistence
     - 2. Plain Hour-of-Week Mean
     - 3. Baseline 3 (Anomaly-Adjusted Hour-of-Week Mean)
     - 4. XGBoost v2 (Monotone Candidate)
     Overall AND per day_type (normal, event, low):
     - MAE & RMSE
     - Rule A: Alert >= 200.0 kW vs Actual >= 200.0 kW (Recall, Precision, FP count)
     - Rule B: Alert >= 162.5 kW vs Actual >= 200.0 kW (Recall, Precision, FP count)
     Uses ONE shared recall/precision/FP evaluation helper.
  4. Evening load comparison on TEST (17:00-21:00 station-local):
     event-day mean vs normal-day mean.
  5. Sanity checks:
     a) 50 random TEST rows at 18:00 local with +100 kW lags (clipped to 300 kW):
        mean prediction increase >= +30 kW.
     b) All TEST rows at 03:00 local: fraction >= 200 kW and max prediction.
     c) Monotonicity: 200 random TEST rows swept from -50 to +100 kW in 10 kW steps
        for (i) all four lags together and (ii) lag_15 alone, recomputing derived features.
        Violations must be 0.
     d) TreeSHAP: TreeExplainer additivity check on 200 rows (|base + sum(shap) - pred| < 1e-3).
  6. GATE verification block:
     - MAE < Baseline 3 MAE and < HoW MAE
     - XGBoost v2 Rule-B recall > Baseline 3 and > HoW (overall and event days)
     - Sanity a, c, d PASS.

Usage:
    python backend/pipeline/evaluate_v2.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
import shap
from sklearn.metrics import mean_absolute_error, mean_squared_error

# Directory resolution
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
CANDIDATE_V2_DIR = SCRIPT_DIR / "candidate_v2"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from app.core.timezone import to_station_local
from pipeline.generator_v2 import (
    lookup_hour_of_week_mean,
    TRANSFORMER_CAPACITY_KW,
    WARNING_THRESHOLD_KW,
    CRITICAL_THRESHOLD_KW,
)


def evaluate_forecast_rule(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    alert_threshold: float,
    actual_threshold: float = CRITICAL_THRESHOLD_KW,
) -> Dict[str, float | int]:
    """Shared single helper for alert recall, precision, and false-alarm counts.

    Parameters
    ----------
    y_true : np.ndarray
        Ground-truth observed station load at target timestamp (kW).
    y_pred : np.ndarray
        Forecasted station load at target timestamp (kW).
    alert_threshold : float
        Threshold above which an alert is triggered (200 kW for Rule A, 162.5 kW for Rule B).
    actual_threshold : float, default=200.0 kW
        Ground truth threshold for a critical surge event.
    """
    actual_surge = y_true >= actual_threshold
    pred_alert = y_pred >= alert_threshold

    n_actual = int(actual_surge.sum())
    n_alert = int(pred_alert.sum())

    tp = int((actual_surge & pred_alert).sum())
    fp = int((~actual_surge & pred_alert).sum())

    recall = float(tp / n_actual) if n_actual > 0 else 1.0
    precision = float(tp / n_alert) if n_alert > 0 else (1.0 if n_actual == 0 else 0.0)

    return {
        "n_surges": n_actual,
        "n_alerts": n_alert,
        "tp": tp,
        "fp": fp,
        "recall": recall,
        "precision": precision,
    }


def compute_model_performance(
    y_true: np.ndarray,
    y_pred: np.ndarray,
) -> Dict[str, Any]:
    """Compute MAE, RMSE, Rule A metrics, and Rule B metrics using the shared helper."""
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    rule_a = evaluate_forecast_rule(y_true, y_pred, alert_threshold=CRITICAL_THRESHOLD_KW, actual_threshold=CRITICAL_THRESHOLD_KW)
    rule_b = evaluate_forecast_rule(y_true, y_pred, alert_threshold=WARNING_THRESHOLD_KW, actual_threshold=CRITICAL_THRESHOLD_KW)

    return {
        "mae": mae,
        "rmse": rmse,
        "rule_a": rule_a,
        "rule_b": rule_b,
    }


def run_evaluation(seed: int = 42) -> None:
    print("=" * 80)
    print("  EV SURGE PREDICTOR — MODEL V2 EVALUATION & VERIFICATION REPORT (PHASE B)")
    print(f"  Fixed Seed: {seed} | Candidate Dir: {CANDIDATE_V2_DIR}")
    print("=" * 80)

    # 1. Load artifacts and datasets
    train_parquet = CANDIDATE_V2_DIR / "train_purged.parquet"
    test_parquet = CANDIDATE_V2_DIR / "test_purged.parquet"
    how_joblib = CANDIDATE_V2_DIR / "hour_of_week_mean.joblib"
    model_joblib = CANDIDATE_V2_DIR / "xgb_v2.joblib"
    feat_json = CANDIDATE_V2_DIR / "feature_names_v2.json"

    for p in [train_parquet, test_parquet, how_joblib, model_joblib, feat_json]:
        if not p.exists():
            raise FileNotFoundError(f"Missing required artifact: {p}. Run build_dataset_v2.py first.")

    train_df = pd.read_parquet(train_parquet)
    test_df = pd.read_parquet(test_parquet)
    how_table = joblib.load(how_joblib)
    xgb_model = joblib.load(model_joblib)
    with open(feat_json, "r") as f:
        feature_names_v2 = json.load(f)

    print(f"\n[1/4] Loaded Purged Datasets & Model Artifacts:")
    print(f"  • Train dataset : {len(train_df):,} rows")
    print(f"  • Test dataset  : {len(test_df):,} rows")
    print(f"  • Feature count : {len(feature_names_v2)} features")
    print(f"  • Model type    : {type(xgb_model).__name__} (best_iteration={getattr(xgb_model, 'best_iteration', 'N/A')})")

    # 2. Refit Baseline 3 (Anomaly-Adjusted HoW) OLS slope k on train_purged
    train_df["how_current"] = lookup_hour_of_week_mean(how_table, train_df["timestamp"])
    train_df["how_2h"] = lookup_hour_of_week_mean(how_table, train_df["timestamp"] + pd.Timedelta(hours=2))
    a_t = train_df["load_kw"] - train_df["how_current"]
    a_target = train_df["target_load_2h"] - train_df["how_2h"]
    k_ols = float(np.sum(a_t * a_target) / np.sum(a_t**2))
    print(f"\n[2/4] Baseline 3 Refit on train_purged:")
    print(f"  • Fitted Anomaly Multiplier (k) : {k_ols:.4f}")
    print(f"  • Theoretical phi^8 (0.97^8)   : {0.97**8:.4f}")

    # 3. Generate forecasts on test_purged
    test_df["how_current"] = lookup_hour_of_week_mean(how_table, test_df["timestamp"])
    test_df["how_2h"] = lookup_hour_of_week_mean(how_table, test_df["timestamp"] + pd.Timedelta(hours=2))

    # Baseline 1: Persistence
    pred_persist = test_df["load_kw"].to_numpy(dtype=np.float64)
    # Baseline 2: Plain HoW Mean
    pred_how = test_df["how_2h"].to_numpy(dtype=np.float64)
    # Baseline 3: Anomaly-Adjusted HoW Mean
    pred_b3 = (test_df["how_2h"] + k_ols * (test_df["load_kw"] - test_df["how_current"])).to_numpy(dtype=np.float64)
    # Model 4: XGBoost v2 (Monotone)
    X_test = test_df[feature_names_v2]
    pred_xgb = xgb_model.predict(X_test).astype(np.float64)

    y_test = test_df["target_load_2h"].to_numpy(dtype=np.float64)

    models_dict = {
        "Persistence": pred_persist,
        "Plain HoW Mean": pred_how,
        "Baseline 3": pred_b3,
        "XGBoost v2 (Candidate)": pred_xgb,
    }

    # 4. Evaluation Tables
    print("\n" + "=" * 80)
    print("  STEP 4: HELD-OUT TEST EVALUATION TABLE (4 FORECASTERS, OVERALL & BY DAY_TYPE)")
    print("=" * 80)

    day_types = ["OVERALL", "normal", "event", "low"]
    perf_results: Dict[str, Dict[str, Any]] = {}

    for dt in day_types:
        if dt == "OVERALL":
            sub_mask = np.ones(len(y_test), dtype=bool)
            title = "OVERALL HELD-OUT TEST SET (ALL 9,480 ROWS)"
        else:
            sub_mask = (test_df["day_type"] == dt).to_numpy()
            title = f"DAY_TYPE: {dt.upper()} ({sub_mask.sum():,} ROWS)"

        print(f"\n--- {title} ---")
        print(f"{'Model':<24} | {'MAE (kW)':>8} | {'RMSE':>6} | {'Rule A Rec':>10} | {'Rule A Prec':>11} | {'Rule A FP':>9} | {'Rule B Rec':>10} | {'Rule B Prec':>11} | {'Rule B FP':>9}")
        print("-" * 115)

        perf_results[dt] = {}
        for m_name, y_m in models_dict.items():
            perf = compute_model_performance(y_test[sub_mask], y_m[sub_mask])
            perf_results[dt][m_name] = perf
            ma = perf["rule_a"]
            mb = perf["rule_b"]
            print(
                f"{m_name:<24} | "
                f"{perf['mae']:8.2f} | "
                f"{perf['rmse']:6.2f} | "
                f"{ma['recall']*100:9.1f}% | "
                f"{ma['precision']*100:10.1f}% | "
                f"{ma['fp']:9d} | "
                f"{mb['recall']*100:9.1f}% | "
                f"{mb['precision']*100:10.1f}% | "
                f"{mb['fp']:9d}"
            )
        print("-" * 115)

    # Evening load comparison on TEST
    local_ts = to_station_local(test_df["timestamp"])
    hours = local_ts.dt.hour + local_ts.dt.minute / 60.0
    evening_mask = (hours >= 17.0) & (hours <= 21.0)
    ev_evening = test_df[evening_mask & (test_df["day_type"] == "event")]["load_kw"]
    norm_evening = test_df[evening_mask & (test_df["day_type"] == "normal")]["load_kw"]

    print("\n" + "=" * 80)
    print("  EVENING PEAK LOAD CHARACTERIZATION (17:00 - 21:00 LOCAL TIME, TEST SPLIT)")
    print("=" * 80)
    print(f"  • Event-Day Evening Mean Load  : {ev_evening.mean():.2f} kW (n={len(ev_evening):,} steps across 9 event days)")
    print(f"  • Normal-Day Evening Mean Load : {norm_evening.mean():.2f} kW (n={len(norm_evening):,} steps across 92 normal days)")
    evening_ratio = ev_evening.mean() / norm_evening.mean()
    evening_uplift_pct = (evening_ratio - 1.0) * 100.0
    print(f"  • Event / Normal Evening Ratio : {evening_ratio:.3f} (+{evening_uplift_pct:.1f}% load uplift)")
    print("=" * 80)

    # 5. Sanity Checks
    print("\n" + "=" * 80)
    print("  STEP 5: SANITY CHECKS (ROBUSTNESS, MONOTONICITY & EXPLAINABILITY)")
    print("=" * 80)

    rng = np.random.default_rng(seed)

    # Sanity Check (a): 50 random TEST rows at 18:00 local; add +100 kW to lag_15..lag_60 (clip to 300 kW)
    idx_18 = test_df.index[local_ts.dt.hour == 18].tolist()
    sampled_50_idx = rng.choice(idx_18, size=50, replace=False)
    sample_50_orig = X_test.loc[sampled_50_idx].copy()
    pred_orig_50 = xgb_model.predict(sample_50_orig)

    sample_50_pert = sample_50_orig.copy()
    for col in ["load_lag_15m", "load_lag_30m", "load_lag_45m", "load_lag_60m"]:
        sample_50_pert[col] = np.clip(sample_50_pert[col] + 100.0, 10.0, 300.0)

    # Recompute derived features using station-local time
    ts_50 = test_df.loc[sampled_50_idx, "timestamp"]
    ts_50_local = to_station_local(ts_50)
    how_50_m15 = lookup_hour_of_week_mean(how_table, ts_50_local - pd.Timedelta(minutes=15))
    sample_50_pert["load_anomaly"] = sample_50_pert["load_lag_15m"] - how_50_m15
    sample_50_pert["lag_trend"] = sample_50_pert["load_lag_15m"] - sample_50_pert["load_lag_60m"]

    pred_pert_50 = xgb_model.predict(sample_50_pert)
    mean_increase_50 = float(np.mean(pred_pert_50 - pred_orig_50))
    sanity_a_pass = mean_increase_50 >= 30.0

    print(f"\n[Sanity Check a — Surge Responsiveness at 18:00 Local]")
    print(f"  • Mean original prediction at 18:00 : {np.mean(pred_orig_50):.2f} kW")
    print(f"  • Mean perturbed (+100 kW lags)     : {np.mean(pred_pert_50):.2f} kW")
    print(f"  • Mean prediction increase          : {mean_increase_50:.2f} kW (Required: >= +30.0 kW)")
    print(f"  • Result                            : [{'PASS' if sanity_a_pass else 'FAIL'}]")

    # Sanity Check (b): All TEST rows at 03:00 local with ORIGINAL lags
    idx_03 = test_df.index[local_ts.dt.hour == 3].tolist()
    X_03 = X_test.loc[idx_03]
    pred_03 = xgb_model.predict(X_03)
    frac_ge_200 = float(np.mean(pred_03 >= CRITICAL_THRESHOLD_KW))
    max_pred_03 = float(np.max(pred_03))
    print(f"\n[Sanity Check b — Off-Peak Night Baseline at 03:00 Local]")
    print(f"  • Total test rows evaluated at 03:00 : {len(idx_03):,}")
    print(f"  • Fraction with prediction >= 200 kW : {frac_ge_200*100:.2f}% ({int(np.sum(pred_03 >= 200.0))} of {len(idx_03)})")
    print(f"  • Max prediction at 03:00            : {max_pred_03:.2f} kW (Transformer capacity: 250 kW)")

    # Sanity Check (c): Monotonicity sweep for 200 random TEST rows
    sampled_200_idx = rng.choice(X_test.index, size=200, replace=False)
    X_200 = X_test.loc[sampled_200_idx]
    ts_200_local = to_station_local(test_df.loc[sampled_200_idx, "timestamp"])
    how_200_m15 = lookup_hour_of_week_mean(how_table, ts_200_local - pd.Timedelta(minutes=15))

    sweep_deltas = np.arange(-50, 101, 10)  # -50, -40, ..., +100

    # (i) All four lags together
    violations_i = 0
    for row_pos, (row_idx, row) in enumerate(X_200.iterrows()):
        h_m15 = how_200_m15[row_pos]
        prev_p = None
        for d in sweep_deltas:
            r = row.copy()
            for col in ["load_lag_15m", "load_lag_30m", "load_lag_45m", "load_lag_60m"]:
                r[col] = r[col] + d
            r["load_anomaly"] = r["load_lag_15m"] - h_m15
            r["lag_trend"] = r["load_lag_15m"] - r["load_lag_60m"]
            p = float(xgb_model.predict(pd.DataFrame([r]))[0])
            if prev_p is not None and p < prev_p - 1e-5:
                violations_i += 1
            prev_p = p

    # (ii) lag_15 alone
    violations_ii = 0
    for row_pos, (row_idx, row) in enumerate(X_200.iterrows()):
        h_m15 = how_200_m15[row_pos]
        prev_p = None
        for d in sweep_deltas:
            r = row.copy()
            r["load_lag_15m"] = r["load_lag_15m"] + d
            r["load_anomaly"] = r["load_lag_15m"] - h_m15
            r["lag_trend"] = r["load_lag_15m"] - r["load_lag_60m"]
            p = float(xgb_model.predict(pd.DataFrame([r]))[0])
            if prev_p is not None and p < prev_p - 1e-5:
                violations_ii += 1
            prev_p = p

    total_violations = violations_i + violations_ii
    sanity_c_pass = total_violations == 0

    print(f"\n[Sanity Check c — Monotonicity Sweep (-50 to +100 kW in 10 kW steps)]")
    print(f"  • (i)  All four lags swept together violations : {violations_i} (Required: 0)")
    print(f"  • (ii) lag_15 alone swept violations          : {violations_ii} (Required: 0)")
    print(f"  • Total monotonicity violations               : {total_violations} (Required: 0)")
    print(f"  • Result                                      : [{'PASS' if sanity_c_pass else 'FAIL'}]")

    # Sanity Check (d): SHAP local additivity error < 1e-3
    explainer = shap.TreeExplainer(xgb_model)
    shap_vals = explainer.shap_values(X_200)
    base_val = float(explainer.expected_value)
    preds_200 = xgb_model.predict(X_200)
    shap_reconstructed = base_val + np.sum(shap_vals, axis=1)
    max_shap_err = float(np.max(np.abs(shap_reconstructed - preds_200)))
    sanity_d_pass = max_shap_err < 1e-3

    print(f"\n[Sanity Check d — TreeSHAP Local Additivity Verification]")
    print(f"  • Base value (expected value)       : {base_val:.4f} kW")
    print(f"  • Max |base + sum(shap) - pred| err : {max_shap_err:.6e} kW (Required: < 1.0e-3)")
    print(f"  • Result                            : [{'PASS' if sanity_d_pass else 'FAIL'}]")

    # 6. Final Gate Block
    print("\n" + "=" * 80)
    print("  STEP 6: FINAL GATE BLOCK (STRICT PASS/FAIL CRITERIA)")
    print("=" * 80)

    mae_xgb_all = perf_results["OVERALL"]["XGBoost v2 (Candidate)"]["mae"]
    mae_b3_all = perf_results["OVERALL"]["Baseline 3"]["mae"]
    mae_how_all = perf_results["OVERALL"]["Plain HoW Mean"]["mae"]

    rec_b_xgb_all = perf_results["OVERALL"]["XGBoost v2 (Candidate)"]["rule_b"]["recall"]
    rec_b_b3_all = perf_results["OVERALL"]["Baseline 3"]["rule_b"]["recall"]
    rec_b_how_all = perf_results["OVERALL"]["Plain HoW Mean"]["rule_b"]["recall"]

    rec_b_xgb_ev = perf_results["event"]["XGBoost v2 (Candidate)"]["rule_b"]["recall"]
    rec_b_b3_ev = perf_results["event"]["Baseline 3"]["rule_b"]["recall"]
    rec_b_how_ev = perf_results["event"]["Plain HoW Mean"]["rule_b"]["recall"]

    gate_mae_pass = (mae_xgb_all < mae_b3_all) and (mae_xgb_all < mae_how_all)
    gate_rec_b_all_pass = (rec_b_xgb_all > rec_b_b3_all) and (rec_b_xgb_all > rec_b_how_all)
    gate_rec_b_ev_pass = (rec_b_xgb_ev > rec_b_b3_ev) and (rec_b_xgb_ev > rec_b_how_ev)

    print(f"  • Gate 1: MAE below Baseline 3 & HoW:              "
          f"{mae_xgb_all:.2f} kW < {mae_b3_all:.2f} kW & {mae_how_all:.2f} kW "
          f"-> [{'PASS' if gate_mae_pass else 'FAIL'}]")

    print(f"  • Gate 2: Overall Rule-B Recall > B3 & HoW:        "
          f"{rec_b_xgb_all*100:.1f}% > {rec_b_b3_all*100:.1f}% & {rec_b_how_all*100:.1f}% "
          f"-> [{'PASS' if gate_rec_b_all_pass else 'FAIL'}]")

    print(f"  • Gate 3: Event-Day Rule-B Recall > B3 & HoW:      "
          f"{rec_b_xgb_ev*100:.1f}% > {rec_b_b3_ev*100:.1f}% & {rec_b_how_ev*100:.1f}% "
          f"-> [{'PASS' if gate_rec_b_ev_pass else 'FAIL'}]")

    print(f"  • Gate 4: Sanity Check (a) Surge Response >= +30 kW: "
          f"{mean_increase_50:.2f} kW "
          f"-> [{'PASS' if sanity_a_pass else 'FAIL'}]")

    print(f"  • Gate 5: Sanity Check (c) Monotonicity 0 Violations:"
          f"{total_violations} violations "
          f"-> [{'PASS' if sanity_c_pass else 'FAIL'}]")

    print(f"  • Gate 6: Sanity Check (d) SHAP Additivity < 1e-3:   "
          f"{max_shap_err:.2e} kW "
          f"-> [{'PASS' if sanity_d_pass else 'FAIL'}]")

    print("-" * 80)
    all_gates_pass = (
        gate_mae_pass
        and gate_rec_b_all_pass
        and gate_rec_b_ev_pass
        and sanity_a_pass
        and sanity_c_pass
        and sanity_d_pass
    )
    if all_gates_pass:
        print("  OVERALL VERDICT: ALL PHASE B GATES PASSED [PASS]")
    else:
        print("  OVERALL VERDICT: ONE OR MORE GATES FAILED [FAIL]")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    run_evaluation(seed=42)
