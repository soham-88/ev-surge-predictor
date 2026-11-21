"""
Comprehensive Model v2 Evaluation & Verification Script
========================================================
Phase C.3 Evaluation Script:
  1. Loads purged train/test datasets and trained candidate artifacts:
     - Model file (default: candidate_v2/xgb_v2b.joblib)
     - Feature file (default: candidate_v2/feature_names_v2b.json)
     - candidate_v2/hour_of_week_mean.joblib
  2. Refits Baseline 3 OLS parameter k on train_purged.
  3. Evaluates 4 forecasters on test_purged:
     - 1. Persistence
     - 2. Plain Hour-of-Week Mean
     - 3. Baseline 3 (Anomaly-Adjusted Hour-of-Week Mean)
     - 4. XGBoost v2b (Candidate)
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
     b) All TEST rows at 03:00 local: fraction >= 200 kW and max prediction (< 200 kW).
     c) PROPERTY TEST on 300 random test rows with max lag <= 190 kW (no clipping needed):
        sweep all four lags together 0..+100 kW in 10 kW steps through full assembler.
        Violations must be 0 (GATED).
        Also reports lag_15 alone violations (rows, total, max drop), reported not gated.
     d) TreeSHAP: TreeExplainer additivity check on 200 rows (|base + sum(shap) - pred| < 1e-3).
  6. GATE verification block:
     - MAE < Baseline 3 MAE and < HoW MAE
     - XGBoost Rule-B recall > Baseline 3 and > HoW (overall and event days)
     - Sanity a, b, c, d PASS.

Usage:
    python backend/pipeline/evaluate_v2.py [--model-file xgb_v2b.joblib] [--feature-file feature_names_v2b.json]
"""

from __future__ import annotations

import argparse
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
from app.models.ml_engine import assemble_features_df
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
    """Shared single helper for alert recall, precision, and false-alarm counts."""
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


def run_evaluation(
    model_filename: str = "xgb_v2b.joblib",
    feature_filename: str = "feature_names_v2b.json",
    seed: int = 42,
) -> None:
    print("=" * 80)
    print("  EV SURGE PREDICTOR — MODEL V2 EVALUATION & VERIFICATION REPORT (PHASE C.3)")
    print(f"  Model File: {model_filename} | Feature File: {feature_filename}")
    print(f"  Fixed Seed: {seed} | Candidate Dir: {CANDIDATE_V2_DIR}")
    print("=" * 80)

    # 1. Load artifacts and datasets
    train_parquet = CANDIDATE_V2_DIR / "train_purged.parquet"
    test_parquet = CANDIDATE_V2_DIR / "test_purged.parquet"
    how_joblib = CANDIDATE_V2_DIR / "hour_of_week_mean.joblib"
    model_joblib = CANDIDATE_V2_DIR / model_filename
    feat_json = CANDIDATE_V2_DIR / feature_filename

    for p in [train_parquet, test_parquet, how_joblib, model_joblib, feat_json]:
        if not p.exists():
            raise FileNotFoundError(f"Missing required artifact: {p}.")

    train_df = pd.read_parquet(train_parquet)
    test_df = pd.read_parquet(test_parquet)
    how_table = joblib.load(how_joblib)
    xgb_model = joblib.load(model_joblib)
    with open(feat_json, "r") as f:
        feature_names = json.load(f)

    print(f"\n[1/4] Loaded Purged Datasets & Model Artifacts:")
    print(f"  • Train dataset : {len(train_df):,} rows")
    print(f"  • Test dataset  : {len(test_df):,} rows")
    print(f"  • Feature count : {len(feature_names)} features")
    print(f"  • Model artifact: {model_joblib.name} (best_iteration={getattr(xgb_model, 'best_iteration', 'N/A')})")

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
    # Model 4: XGBoost candidate
    X_test = test_df[feature_names]
    pred_xgb = xgb_model.predict(X_test).astype(np.float64)

    y_test = test_df["target_load_2h"].to_numpy(dtype=np.float64)

    model_display_name = f"XGBoost ({Path(model_filename).stem})"
    models_dict = {
        "Persistence": pred_persist,
        "Plain HoW Mean": pred_how,
        "Baseline 3": pred_b3,
        model_display_name: pred_xgb,
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
            title = f"OVERALL HELD-OUT TEST SET (ALL {len(y_test):,} ROWS)"
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
    lags_50 = sample_50_pert[["load_lag_15m", "load_lag_30m", "load_lag_45m", "load_lag_60m"]]
    sample_50_pert["rolling_mean_60m"] = lags_50.mean(axis=1)
    sample_50_pert["rolling_std_60m"] = lags_50.std(axis=1, ddof=1)

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
    sanity_b_pass = max_pred_03 < CRITICAL_THRESHOLD_KW
    print(f"\n[Sanity Check b — Off-Peak Night Baseline at 03:00 Local]")
    print(f"  • Total test rows evaluated at 03:00 : {len(idx_03):,}")
    print(f"  • Fraction with prediction >= 200 kW : {frac_ge_200*100:.2f}% ({int(np.sum(pred_03 >= 200.0))} of {len(idx_03)})")
    print(f"  • Max prediction at 03:00            : {max_pred_03:.2f} kW (Required: < 200.0 kW)")
    print(f"  • Result                            : [{'PASS' if sanity_b_pass else 'FAIL'}]")

    # Sanity Check (c): PROPERTY TEST on 300 random TEST rows with max lag <= 190 kW
    lag_cols = ["load_lag_15m", "load_lag_30m", "load_lag_45m", "load_lag_60m"]
    max_lags = test_df[lag_cols].max(axis=1)
    eligible_test = test_df[max_lags <= 190.0].copy()
    sampled_prop = eligible_test.sample(n=300, random_state=seed).reset_index(drop=True)

    sweep_deltas_prop = np.arange(0, 101, 10)  # 0, 10, ..., 100 kW (11 steps)

    # (i) All four lags together (GATED: must be 0)
    all_preds_prop_i = []
    for _, r in sampled_prop.iterrows():
        prev_plugs = float(r["active_plugs"] - r["plug_delta_15m"])
        row_records = []
        for d in sweep_deltas_prop:
            rc = r.to_dict()
            for col in lag_cols:
                rc[col] = float(rc[col]) + d  # No clipping needed since max lag + 100 <= 290 kW
            row_records.append(rc)
        df_11 = pd.DataFrame(row_records)
        feats_11 = assemble_features_df(
            df_11,
            is_batch=False,
            how_table=how_table,
            feature_names=feature_names,
            prev_active_plugs=prev_plugs,
        )
        p_11 = xgb_model.predict(feats_11.astype(float))
        all_preds_prop_i.append(p_11)

    preds_arr_prop_i = np.array(all_preds_prop_i)
    diffs_prop_i = np.diff(preds_arr_prop_i, axis=1)
    viols_prop_i = diffs_prop_i < -1e-5
    tot_viols_i = int(np.sum(viols_prop_i))
    viol_rows_i = int(np.sum(np.any(viols_prop_i, axis=1)))
    max_drop_i = float(np.max(-diffs_prop_i[viols_prop_i])) if tot_viols_i > 0 else 0.0
    sanity_c_pass = tot_viols_i == 0

    # (ii) lag_15 alone (REPORTED, NOT GATED)
    all_preds_prop_ii = []
    for _, r in sampled_prop.iterrows():
        prev_plugs = float(r["active_plugs"] - r["plug_delta_15m"])
        row_records = []
        for d in sweep_deltas_prop:
            rc = r.to_dict()
            rc["load_lag_15m"] = float(rc["load_lag_15m"]) + d  # No clipping needed
            row_records.append(rc)
        df_11 = pd.DataFrame(row_records)
        feats_11 = assemble_features_df(
            df_11,
            is_batch=False,
            how_table=how_table,
            feature_names=feature_names,
            prev_active_plugs=prev_plugs,
        )
        p_11 = xgb_model.predict(feats_11.astype(float))
        all_preds_prop_ii.append(p_11)

    preds_arr_prop_ii = np.array(all_preds_prop_ii)
    diffs_prop_ii = np.diff(preds_arr_prop_ii, axis=1)
    viols_prop_ii = diffs_prop_ii < -1e-5
    tot_viols_ii = int(np.sum(viols_prop_ii))
    viol_rows_ii = int(np.sum(np.any(viols_prop_ii, axis=1)))
    max_drop_ii = float(np.max(-diffs_prop_ii[viols_prop_ii])) if tot_viols_ii > 0 else 0.0

    print(f"\n[Sanity Check c — Property Test: Monotonicity Sweep (0 to +100 kW, max lag <= 190 kW)]")
    print(f"  • Test rows eligible (max lag <= 190 kW)      : {len(eligible_test):,} of {len(test_df):,}")
    print(f"  • Sampled rows for Property Test             : {len(sampled_prop)}")
    print(f"  • (i)  All four lags swept (0..+100 kW, no clip):")
    print(f"      - Violations (gated == 0)                : {tot_viols_i} (Violating rows: {viol_rows_i})")
    print(f"      - Max prediction drop                    : {max_drop_i:.4f} kW")
    print(f"      - Result                                 : [{'PASS' if sanity_c_pass else 'FAIL'}]")
    print(f"  • (ii) lag_15 alone swept (0..+100 kW, no clip, informational):")
    print(f"      - Violations                             : {tot_viols_ii} (Violating rows: {viol_rows_ii})")
    print(f"      - Max prediction drop                    : {max_drop_ii:.4f} kW")

    # Sanity Check (d): SHAP local additivity error < 1e-3
    sampled_200_idx = rng.choice(X_test.index, size=200, replace=False)
    X_200 = X_test.loc[sampled_200_idx]
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

    mae_xgb_all = perf_results["OVERALL"][model_display_name]["mae"]
    mae_b3_all = perf_results["OVERALL"]["Baseline 3"]["mae"]
    mae_how_all = perf_results["OVERALL"]["Plain HoW Mean"]["mae"]

    rec_b_xgb_all = perf_results["OVERALL"][model_display_name]["rule_b"]["recall"]
    rec_b_b3_all = perf_results["OVERALL"]["Baseline 3"]["rule_b"]["recall"]
    rec_b_how_all = perf_results["OVERALL"]["Plain HoW Mean"]["rule_b"]["recall"]

    rec_b_xgb_ev = perf_results["event"][model_display_name]["rule_b"]["recall"]
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

    print(f"  • Gate 5: Sanity Check (b) Off-Peak 03:00 Max < 200kW:"
          f"{max_pred_03:.2f} kW "
          f"-> [{'PASS' if sanity_b_pass else 'FAIL'}]")

    print(f"  • Gate 6: Sanity Check (c) Property Test Monotone (0 viols):"
          f"{tot_viols_i} violations "
          f"-> [{'PASS' if sanity_c_pass else 'FAIL'}]")

    print(f"  • Gate 7: Sanity Check (d) SHAP Additivity < 1e-3:   "
          f"{max_shap_err:.2e} kW "
          f"-> [{'PASS' if sanity_d_pass else 'FAIL'}]")

    print("-" * 80)
    all_gates_pass = (
        gate_mae_pass
        and gate_rec_b_all_pass
        and gate_rec_b_ev_pass
        and sanity_a_pass
        and sanity_b_pass
        and sanity_c_pass
        and sanity_d_pass
    )
    if all_gates_pass:
        print("  OVERALL VERDICT: ALL PHASE C.3 EVALUATION GATES PASSED [PASS]")
    else:
        print("  OVERALL VERDICT: ONE OR MORE GATES FAILED [FAIL]")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate Model v2 Candidate")
    parser.add_argument("--model-file", type=str, default="xgb_v2b.joblib", help="Candidate model artifact name in candidate_v2/")
    parser.add_argument("--feature-file", type=str, default="feature_names_v2b.json", help="Candidate feature names artifact name in candidate_v2/")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    run_evaluation(
        model_filename=args.model_file,
        feature_filename=args.feature_file,
        seed=args.seed,
    )
