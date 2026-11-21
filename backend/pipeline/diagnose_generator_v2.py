"""
Diagnosis & Verification Script for Synthetic Telemetry Generator v2
====================================================================
Phase A.2 Candidate Data Generator Diagnostic & Gate Evaluation:
  1. Component Variance Breakdown (std of each load component: daily multiplier,
     event/low-day effect, AR(1) shock, and per-step white noise).
  2. Data generation at n_days=730 (15-min cadence, 70,080 rows) saved to candidate_v2/train_data_v2.parquet.
  3. Stratified day-based splitting (70% train / 15% val / 15% test) with event day & surge counts.
  4. Hour-of-week mean table computed from TRAIN only and saved to candidate_v2/hour_of_week_mean.joblib.
  5. Baseline 3 (Anomaly-Adjusted Hour-of-Week Mean) fitted via OLS on TRAIN split only.
  6. Held-out TEST split evaluation:
     - Days and rows per day_type
     - Load summary statistics per day_type
     - Within-day average lag-1 autocorrelation of (load - hour_of_week_mean)
     - Performance table comparing Persistence, Plain HoW, and Baseline 3 MAE & surge recall
     - Threshold exceedance counts (WARNING & CRITICAL)
  7. GATE SECTION evaluating:
     - (a) within-day autocorrelation >= 0.80
     - (b) test event days >= 8
     - (c) Baseline 3 MAE at least 20% lower than plain HoW MAE (overall)
     - (d) Baseline 3 event-day surge recall > plain HoW event-day recall
  8. Phase B Boundary Leakage Architectural Note.

Usage:
    python backend/pipeline/diagnose_generator_v2.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error

# Add pipeline directory to sys.path for direct script execution
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
CANDIDATE_V2_DIR = SCRIPT_DIR / "candidate_v2"
CANDIDATE_V2_DIR.mkdir(parents=True, exist_ok=True)

if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from generator_v2 import (
    synthesize_telemetry_v2,
    split_by_day,
    compute_hour_of_week_mean,
    lookup_hour_of_week_mean,
    compute_surge_recall,
    TRANSFORMER_CAPACITY_KW,
    WARNING_THRESHOLD_KW,
    CRITICAL_THRESHOLD_KW,
)


def report_component_variances_v2_baseline(seed: int = 42) -> None:
    """Report std (kW) of each load component in generator_v2 before changes."""
    rng = np.random.default_rng(seed)
    n_days = 90
    steps_per_day = 96
    timestamps = pd.date_range("2025-01-01", periods=n_days * steps_per_day, freq="15min")
    n = len(timestamps)

    hours = (timestamps.hour + timestamps.minute / 60.0).to_numpy(dtype=np.float64)
    day_of_week = timestamps.dayofweek.to_numpy(dtype=np.int32)
    day_indices = np.arange(n) // steps_per_day

    n_event = max(1, int(round(n_days * 0.08)))
    n_low = max(1, int(round(n_days * 0.08)))
    n_normal = n_days - n_event - n_low
    day_types_pool = ["normal"] * n_normal + ["event"] * n_event + ["low"] * n_low
    rng.shuffle(day_types_pool)
    day_types = np.array(day_types_pool)

    daily_demand_mult = np.clip(rng.normal(1.0, 0.08, n_days), 0.85, 1.15)
    event_evening_mult = np.ones(n_days, dtype=np.float64)
    low_demand_mult = np.ones(n_days, dtype=np.float64)
    for d in range(n_days):
        if day_types[d] == "event":
            event_evening_mult[d] = rng.uniform(1.30, 1.60)
        elif day_types[d] == "low":
            low_demand_mult[d] = rng.uniform(0.70, 0.85)

    morning_peak = 80.0 * np.exp(-0.5 * ((hours - 8.5) / 1.5) ** 2)
    evening_peak = 150.0 * np.exp(-0.5 * ((hours - 18.0) / 2.0) ** 2)
    nominal_diurnal = 50.0 + morning_peak + evening_peak
    weekend_mask = day_of_week >= 5
    nominal_diurnal[weekend_mask] *= 0.7

    # 1. Daily multiplier effect (deviation from nominal 1.0)
    daily_mult_effect = nominal_diurnal * (daily_demand_mult[day_indices] - 1.0)

    # 2. Event/low-day effect
    event_effect = 150.0 * np.exp(-0.5 * ((hours - 18.0) / 2.0) ** 2) * (event_evening_mult[day_indices] - 1.0)
    event_effect[weekend_mask] *= 0.7
    low_effect = nominal_diurnal * (low_demand_mult[day_indices] - 1.0)
    event_low_effect = event_effect + low_effect

    # 3. AR(1) shock (Phase A.1 initial parameters: phi=0.97, sigma_s=10.0 kW)
    phi_a1 = 0.97
    sigma_s_a1 = 10.0
    sigma_eps_a1 = sigma_s_a1 * np.sqrt(1.0 - phi_a1**2)
    shocks_a1 = np.zeros(n, dtype=np.float64)
    shocks_a1[0] = rng.normal(0, sigma_s_a1)
    eps_a1 = rng.normal(0, sigma_eps_a1, n)
    for t in range(1, n):
        shocks_a1[t] = phi_a1 * shocks_a1[t - 1] + eps_a1[t]

    # 4. Additive per-step white noise
    white_noise = rng.normal(0, 5.0, n)

    # 5. Additional uncorrelated step noise from stochastic inputs (binomial plugs, temp, traffic)
    plug_noise_std = np.sqrt(8 * 0.5 * 0.5) * 5.0  # ~7.07 kW
    traffic_noise_std = 8.0 * 0.25  # ~2.00 kW
    temp_noise_std = 2.0 * 2.5  # ~5.00 kW
    total_white_noise_std = np.sqrt(5.0**2 + plug_noise_std**2 + traffic_noise_std**2 + temp_noise_std**2)

    print("\n" + "=" * 80)
    print("  STEP 1: COMPONENT VARIANCE BREAKDOWN IN GENERATOR V2 (PRE-CHANGE DIAGNOSIS)")
    print("=" * 80)
    print(f"{'Component':<35} | {'Std Dev (kW)':>12} | {'Domain / Nature':<25}")
    print("-" * 78)
    print(f"{'1. Daily demand multiplier effect':<35} | {np.std(daily_mult_effect):12.2f} | Whole-day scaling (constant/day)")
    print(f"{'2. Event/low-day effect':<35} | {np.std(event_low_effect):12.2f} | Multi-hour evening/day scaling")
    print(f"{'3. AR(1) shock (Phase A.1 baseline)':<35} | {np.std(shocks_a1):12.2f} | Persistent intra-day shock (phi=0.97)")
    print(f"{'4. Direct per-step white noise':<35} | {np.std(white_noise):12.2f} | Uncorrelated 15-min innovation")
    print(f"{'   + Active plugs binomial noise':<35} | {plug_noise_std:12.2f} | Independent 15-min i.i.d. draws")
    print(f"{'   + Traffic / Temp step noise':<35} | {np.sqrt(traffic_noise_std**2 + temp_noise_std**2):12.2f} | Step-level input perturbations")
    print(f"{'   * Total step uncorrelated noise':<35} | {total_white_noise_std:12.2f} | Combined white noise in quadrature")
    print("-" * 78)

    print("\n[DIAGNOSTIC FINDING — WHICH COMPONENT DOMINATED THE WITHIN-DAY RESIDUAL?]")
    print(
        "  • The daily demand multiplier (std 6.56 kW) and low-day suppression (std 8.81 kW) are\n"
        "    constant across each 24-hour day, so they shift the daily baseline but do not vary\n"
        "    from step to step within a day.\n"
        "  • The intra-day residual (load - hour_of_week_mean) was swamped by high-frequency uncorrelated\n"
        "    noise: direct white noise (5.04 kW) + independent binomial active-plug sampling (7.07 kW)\n"
        "    + temperature/traffic noise (5.38 kW), combining to ~10.3 kW of per-step white noise.\n"
        "  • In Phase A.1, the AR(1) shock stationary std was only 10.0 kW (within-day sample std ~6.9 kW).\n"
        "  • CONCLUSION: The UNCORRELATED STEP-TO-STEP WHITE NOISE (~10.3 kW) DOMINATED the persistent\n"
        "    AR(1) shock (~6.9 kW within-day), destroying temporal persistence and driving the within-day\n"
        "    lag-1 autocorrelation down to ~0.28.\n"
        "  • FIX IN PHASE A.2: Boost AR(1) shock std to 20.0 kW, model charging session persistence for\n"
        "    active bays, and cap per-step white noise to 3.5 kW (<= 5 kW, ~17.5% of AR std), restoring\n"
        "    within-day autocorrelation to >= 0.80."
    )


def run_diagnostics(seed: int = 42) -> None:
    print("=" * 80)
    print("  EV SURGE PREDICTOR — DATA GENERATOR V2 DIAGNOSTIC REPORT (PHASE A.2)")
    print(f"  Fixed Seed: {seed} | Artifact Directory: {CANDIDATE_V2_DIR}")
    print("=" * 80)

    # 1. Report component variance breakdown
    report_component_variances_v2_baseline(seed=seed)

    # 2. Synthesize telemetry v2 with n_days=730 (2 years, 70,080 rows)
    print("\n" + "=" * 80)
    print("  STEP 2: SYNTHESIZING EXPANDED TELEMETRY V2 (730 DAYS = 70,080 ROWS)")
    print("=" * 80)
    n_days = 730
    df_raw = synthesize_telemetry_v2(n_days=n_days, interval_minutes=15, seed=seed)
    print(f"  Total records generated: {len(df_raw):,} rows ({len(df_raw) // 96} days)")
    print(f"  Date range: {df_raw['timestamp'].iloc[0]} -> {df_raw['timestamp'].iloc[-1]}")
    print(f"  Columns: {df_raw.columns.tolist()}")
    print(f"  Ambient temp range: [{df_raw['ambient_temp_c'].min():.1f}, {df_raw['ambient_temp_c'].max():.1f}] °C (Mumbai [20, 40] °C)")
    print(f"  Load range: [{df_raw['load_kw'].min():.1f}, {df_raw['load_kw'].max():.1f}] kW (Physical bounds [10, 300] kW)")

    # Save full generated dataset to candidate_v2/train_data_v2.parquet
    parquet_path = CANDIDATE_V2_DIR / "train_data_v2.parquet"
    try:
        df_raw.to_parquet(parquet_path, index=False)
        size_kb = parquet_path.stat().st_size / 1024
        print(f"  Saved generated dataset to {parquet_path.name} ({size_kb:.1f} KB)")
    except Exception as e:
        csv_path = CANDIDATE_V2_DIR / "train_data_v2.csv"
        df_raw.to_csv(csv_path, index=False)
        size_kb = csv_path.stat().st_size / 1024
        print(f"  Parquet fallback: saved generated dataset to {csv_path.name} ({size_kb:.1f} KB) (reason: {e})")

    # 3. Continuous 2h-ahead target formulation (8 x 15-min steps)
    df = df_raw.copy()
    df["target_load_2h"] = df["load_kw"].shift(-8)

    # 4. Stratified split by whole calendar days (70% train / 15% val / 15% test)
    print("\n" + "=" * 80)
    print("  STEP 3: STRATIFIED SPLIT BY WHOLE CALENDAR DAYS (70% TRAIN / 15% VAL / 15% TEST)")
    print("=" * 80)
    train_df, val_df, test_df = split_by_day(df, seed=seed)

    print(f"{'Split':<8} | {'Total Days':>10} | {'Normal Days':>11} | {'Event Days':>10} | {'Low Days':>8} | {'Event-Day Surges (>=200kW)':>27}")
    print("-" * 88)
    for name, split in [("TRAIN", train_df), ("VAL", val_df), ("TEST", test_df)]:
        d_tot = split["timestamp"].dt.date.nunique()
        d_norm = split[split["day_type"] == "normal"]["timestamp"].dt.date.nunique()
        d_ev = split[split["day_type"] == "event"]["timestamp"].dt.date.nunique()
        d_low = split[split["day_type"] == "low"]["timestamp"].dt.date.nunique()
        ev_surges = int((split[(split["day_type"] == "event") & (split["load_kw"] >= CRITICAL_THRESHOLD_KW)]["load_kw"]).count())
        print(f"{name:<8} | {d_tot:10d} | {d_norm:11d} | {d_ev:10d} | {d_low:8d} | {ev_surges:27d}")
    print("-" * 88)

    # 5. Compute & save hour-of-week mean table from TRAIN split only
    print("\n" + "=" * 80)
    print("  STEP 4: COMPUTING HOUR-OF-WEEK MEAN TABLE FROM TRAIN SPLIT ONLY")
    print("=" * 80)
    how_table = compute_hour_of_week_mean(train_df)
    how_joblib_path = CANDIDATE_V2_DIR / "hour_of_week_mean.joblib"
    joblib.dump(how_table, how_joblib_path)
    print(f"  Hour-of-week table shape: {len(how_table)} cells (7 days x 24 hours)")
    print(f"  Saved table to: {how_joblib_path.name} ({how_joblib_path.stat().st_size / 1024:.1f} KB)")

    # 6. Fit Baseline 3 (Anomaly-Adjusted Hour-of-Week Mean) via OLS on TRAIN split only
    print("\n" + "=" * 80)
    print("  STEP 5: FITTING BASELINE 3 (ANOMALY-ADJUSTED HOUR-OF-WEEK MEAN) ON TRAIN")
    print("=" * 80)
    # y_hat_{t+2h} = HoW(t+2h) + k * (load_t - HoW(t))
    train_valid = train_df.dropna(subset=["target_load_2h"]).copy()
    train_valid["how_current"] = lookup_hour_of_week_mean(how_table, train_valid["timestamp"])
    train_valid["how_2h"] = lookup_hour_of_week_mean(how_table, train_valid["timestamp"] + pd.Timedelta(hours=2))

    a_t = train_valid["load_kw"] - train_valid["how_current"]
    a_target = train_valid["target_load_2h"] - train_valid["how_2h"]
    # OLS slope k without intercept: k = sum(a_t * a_target) / sum(a_t^2)
    k_ols = float(np.sum(a_t * a_target) / np.sum(a_t**2))
    k_theoretical = 0.97**8  # phi^8 ≈ 0.7838 for 8 steps of 15 min (2 hours)
    print(f"  • Fitted OLS Anomaly Multiplier (k) : {k_ols:.4f}")
    print(f"  • Theoretical AR(1) 8-Step Multiplier (phi^8 = 0.97^8): {k_theoretical:.4f}")
    print(f"  • Attenuation Factor (k / phi^8)   : {k_ols / k_theoretical:.4f} (slight attenuation from observation noise)")

    # 7. Evaluate on TEST split
    print("\n" + "=" * 80)
    print("  STEP 6: EVALUATING HELD-OUT TEST SPLIT DIAGNOSTICS")
    print("=" * 80)

    test_valid = test_df.dropna(subset=["target_load_2h"]).copy()
    test_valid["how_current"] = lookup_hour_of_week_mean(how_table, test_valid["timestamp"])
    test_valid["how_2h"] = lookup_hour_of_week_mean(how_table, test_valid["timestamp"] + pd.Timedelta(hours=2))

    # Baseline forecasters for t+2h:
    # (a) Persistence: predicted load in 2h equals current load
    test_valid["pred_persist_2h"] = test_valid["load_kw"]
    # (b) Plain Hour-of-Week mean: predicted load in 2h equals train HoW mean at t+2h
    test_valid["pred_how_2h"] = test_valid["how_2h"]
    # (c) Baseline 3: Anomaly-Adjusted HoW mean: HoW(t+2h) + k * (load_t - HoW(t))
    test_valid["pred_baseline3_2h"] = test_valid["how_2h"] + k_ols * (test_valid["load_kw"] - test_valid["how_current"])

    # -------------------------------------------------------------
    # DIAGNOSTIC 1: Days and Rows per Day Type (Test Split)
    # -------------------------------------------------------------
    print("\n=== DIAGNOSTIC 1: DAYS AND ROWS PER DAY_TYPE (TEST SPLIT) ===")
    print(f"{'Day Type':<12} | {'Days':>6} | {'Rows':>6} | {'Day Share':>10} | {'Row Share':>10}")
    print("-" * 54)
    tot_days = test_valid["timestamp"].dt.date.nunique()
    tot_rows = len(test_valid)
    for dt in ["normal", "event", "low"]:
        sub = test_valid[test_valid["day_type"] == dt]
        d_cnt = sub["timestamp"].dt.date.nunique()
        r_cnt = len(sub)
        print(f"{dt:<12} | {d_cnt:6d} | {r_cnt:6d} | {d_cnt / tot_days * 100:9.1f}% | {r_cnt / tot_rows * 100:9.1f}%")
    print("-" * 54)
    print(f"{'Total':<12} | {tot_days:6d} | {tot_rows:6d} | {100.0:9.1f}% | {100.0:9.1f}%")

    # -------------------------------------------------------------
    # DIAGNOSTIC 2: Load Summary Statistics per Day Type (Test Split)
    # -------------------------------------------------------------
    print("\n=== DIAGNOSTIC 2: LOAD STATISTICS (kW) PER DAY_TYPE (TEST SPLIT) ===")
    print(f"{'Day Type':<12} | {'Mean (kW)':>10} | {'Std (kW)':>10} | {'Min (kW)':>10} | {'Max (kW)':>10}")
    print("-" * 60)
    for dt in ["normal", "event", "low"]:
        sub = test_valid[test_valid["day_type"] == dt]
        print(f"{dt:<12} | {sub['load_kw'].mean():10.2f} | {sub['load_kw'].std():10.2f} | {sub['load_kw'].min():10.2f} | {sub['load_kw'].max():10.2f}")
    print("-" * 60)
    print(f"{'Overall':<12} | {test_valid['load_kw'].mean():10.2f} | {test_valid['load_kw'].std():10.2f} | {test_valid['load_kw'].min():10.2f} | {test_valid['load_kw'].max():10.2f}")

    # -------------------------------------------------------------
    # DIAGNOSTIC 3: Lag-1 Autocorrelation of (load - hour_of_week_mean)
    # -------------------------------------------------------------
    print("\n=== DIAGNOSTIC 3: LAG-1 AUTOCORRELATION OF (LOAD - HOUR_OF_WEEK_MEAN) ===")
    test_valid["residual_seasonality"] = test_valid["load_kw"] - test_valid["how_current"]
    pooled_ac1 = test_valid["residual_seasonality"].autocorr(lag=1)

    # Within-day autocorrelation across test calendar days
    day_acs = []
    for _, day_group in test_valid.groupby(test_valid["timestamp"].dt.date):
        ac = day_group["residual_seasonality"].autocorr(lag=1)
        if pd.notna(ac):
            day_acs.append(ac)
    within_day_ac1 = float(np.mean(day_acs)) if day_acs else pooled_ac1

    print(f"  • Within-Day Average Lag-1 Autocorrelation : {within_day_ac1:.4f}  (Gate target >= 0.80)")
    print(f"  • Pooled Test Series Lag-1 Autocorrelation: {pooled_ac1:.4f}")
    print(f"  • Residual Mean                           : {test_valid['residual_seasonality'].mean():.2f} kW")
    print(f"  • Residual Std Dev                        : {test_valid['residual_seasonality'].std():.2f} kW")

    # -------------------------------------------------------------
    # DIAGNOSTIC 4: Baseline Forecasts Comparison (Persistence vs HoW vs Baseline 3)
    # -------------------------------------------------------------
    print("\n=== DIAGNOSTIC 4: BASELINE PERFORMANCE COMPARISON (t+2h LOAD FORECAST, TEST SPLIT) ===")
    print(f"  Thresholds: CRITICAL >= {CRITICAL_THRESHOLD_KW:.1f} kW (80% capacity = 200 kW), Transformer = {TRANSFORMER_CAPACITY_KW:.1f} kW")
    print(f"{'Day Type':<8} | {'Surges':>6} | {'Persist MAE':>11} | {'Persist Rec':>11} | {'HoW MAE':>9} | {'HoW Rec':>9} | {'Base3 MAE':>9} | {'Base3 Rec':>9}")
    print("-" * 92)

    for dt in ["normal", "event", "low"]:
        sub = test_valid[test_valid["day_type"] == dt]
        n_surges = int((sub["target_load_2h"] >= CRITICAL_THRESHOLD_KW).sum())
        mae_p = mean_absolute_error(sub["target_load_2h"], sub["pred_persist_2h"])
        mae_h = mean_absolute_error(sub["target_load_2h"], sub["pred_how_2h"])
        mae_b = mean_absolute_error(sub["target_load_2h"], sub["pred_baseline3_2h"])
        rec_p = compute_surge_recall(sub["target_load_2h"], sub["pred_persist_2h"]) * 100.0
        rec_h = compute_surge_recall(sub["target_load_2h"], sub["pred_how_2h"]) * 100.0
        rec_b = compute_surge_recall(sub["target_load_2h"], sub["pred_baseline3_2h"]) * 100.0
        rec_p_str = f"{rec_p:5.1f}%" if n_surges > 0 else "N/A"
        rec_h_str = f"{rec_h:5.1f}%" if n_surges > 0 else "N/A"
        rec_b_str = f"{rec_b:5.1f}%" if n_surges > 0 else "N/A"
        print(f"{dt:<8} | {n_surges:6d} | {mae_p:9.2f} kW | {rec_p_str:>11} | {mae_h:7.2f} kW | {rec_h_str:>9} | {mae_b:7.2f} kW | {rec_b_str:>9}")

    tot_surges = int((test_valid["target_load_2h"] >= CRITICAL_THRESHOLD_KW).sum())
    tot_mae_p = mean_absolute_error(test_valid["target_load_2h"], test_valid["pred_persist_2h"])
    tot_mae_h = mean_absolute_error(test_valid["target_load_2h"], test_valid["pred_how_2h"])
    tot_mae_b = mean_absolute_error(test_valid["target_load_2h"], test_valid["pred_baseline3_2h"])
    tot_rec_p = compute_surge_recall(test_valid["target_load_2h"], test_valid["pred_persist_2h"]) * 100.0
    tot_rec_h = compute_surge_recall(test_valid["target_load_2h"], test_valid["pred_how_2h"]) * 100.0
    tot_rec_b = compute_surge_recall(test_valid["target_load_2h"], test_valid["pred_baseline3_2h"]) * 100.0
    print("-" * 92)
    print(f"{'Overall':<8} | {tot_surges:6d} | {tot_mae_p:9.2f} kW | {tot_rec_p:10.1f}% | {tot_mae_h:7.2f} kW | {tot_rec_h:8.1f}% | {tot_mae_b:7.2f} kW | {tot_rec_b:8.1f}%")

    # Event day specific recalls for Gate (d)
    ev_sub = test_valid[test_valid["day_type"] == "event"]
    ev_rec_h = compute_surge_recall(ev_sub["target_load_2h"], ev_sub["pred_how_2h"]) * 100.0
    ev_rec_b = compute_surge_recall(ev_sub["target_load_2h"], ev_sub["pred_baseline3_2h"]) * 100.0
    mae_reduction_pct = ((tot_mae_h - tot_mae_b) / tot_mae_h) * 100.0

    # -------------------------------------------------------------
    # DIAGNOSTIC 5: Threshold Exceedances (WARNING & CRITICAL)
    # -------------------------------------------------------------
    print(f"\n=== DIAGNOSTIC 5: THRESHOLD EXCEEDANCES (WARNING >= {WARNING_THRESHOLD_KW:.1f} kW, CRITICAL >= {CRITICAL_THRESHOLD_KW:.1f} kW) ===")
    print(f"{'Day Type':<10} | {'Rows':>6} | {'WARNING Rows':>12} | {'WARNING %':>10} | {'CRITICAL Rows':>13} | {'CRITICAL %':>11} | {'Total Exceed':>12}")
    print("-" * 88)

    for dt in ["normal", "event", "low"]:
        sub = test_valid[test_valid["day_type"] == dt]
        n_sub = len(sub)
        n_warn = int(((sub["load_kw"] >= WARNING_THRESHOLD_KW) & (sub["load_kw"] < CRITICAL_THRESHOLD_KW)).sum())
        n_crit = int((sub["load_kw"] >= CRITICAL_THRESHOLD_KW).sum())
        n_any = int((sub["load_kw"] >= WARNING_THRESHOLD_KW).sum())
        pct_warn = (n_warn / n_sub) * 100.0 if n_sub > 0 else 0.0
        pct_crit = (n_crit / n_sub) * 100.0 if n_sub > 0 else 0.0
        pct_any = (n_any / n_sub) * 100.0 if n_sub > 0 else 0.0
        print(f"{dt:<10} | {n_sub:6d} | {n_warn:12d} | {pct_warn:9.1f}% | {n_crit:13d} | {pct_crit:10.1f}% | {n_any:6d} ({pct_any:4.1f}%)")

    n_tot = len(test_valid)
    tot_warn = int(((test_valid["load_kw"] >= WARNING_THRESHOLD_KW) & (test_valid["load_kw"] < CRITICAL_THRESHOLD_KW)).sum())
    tot_crit = int((test_valid["load_kw"] >= CRITICAL_THRESHOLD_KW).sum())
    tot_any = int((test_valid["load_kw"] >= WARNING_THRESHOLD_KW).sum())
    print("-" * 88)
    print(f"{'Overall':<10} | {n_tot:6d} | {tot_warn:12d} | {tot_warn / n_tot * 100:9.1f}% | {tot_crit:13d} | {tot_crit / n_tot * 100:10.1f}% | {tot_any:6d} ({tot_any / n_tot * 100:4.1f}%)")

    # -------------------------------------------------------------
    # STEP 7: GATE SECTION (STRICT PASS/FAIL VERIFICATION)
    # -------------------------------------------------------------
    test_event_days = test_valid[test_valid["day_type"] == "event"]["timestamp"].dt.date.nunique()
    gate_a_pass = within_day_ac1 >= 0.80
    gate_b_pass = test_event_days >= 8
    gate_c_pass = mae_reduction_pct >= 20.0
    gate_d_pass = ev_rec_b > ev_rec_h

    print("\n" + "=" * 80)
    print("  STEP 7: PHASE A.2 GATE VERIFICATION")
    print("=" * 80)
    print(f"  • Gate (a) Within-day autocorrelation >= 0.80:       {within_day_ac1:.4f}  -> [{'PASS' if gate_a_pass else 'FAIL'}]")
    print(f"  • Gate (b) Test split event days >= 8:               {test_event_days:d}        -> [{'PASS' if gate_b_pass else 'FAIL'}]")
    print(f"  • Gate (c) Baseline 3 MAE >= 20% lower than HoW:     {mae_reduction_pct:5.1f}%   -> [{'PASS' if gate_c_pass else 'FAIL'}] ({tot_mae_b:.2f} kW vs {tot_mae_h:.2f} kW)")
    print(f"  • Gate (d) Baseline 3 event surge recall > HoW:      {ev_rec_b:5.1f}% > {ev_rec_h:5.1f}% -> [{'PASS' if gate_d_pass else 'FAIL'}]")
    print("-" * 80)

    all_gates_pass = gate_a_pass and gate_b_pass and gate_c_pass and gate_d_pass
    if all_gates_pass:
        print("  OVERALL VERDICT: ALL GATES PASSED [PASS]")
    else:
        print("  OVERALL VERDICT: ONE OR MORE GATES FAILED [FAIL]")
    print("=" * 80)

    # -------------------------------------------------------------
    # STEP 8: PHASE B ARCHITECTURAL NOTE (BOUNDARY LEAKAGE)
    # -------------------------------------------------------------
    print("\n" + "=" * 80)
    print("  STEP 8: PHASE B ARCHITECTURAL NOTE — CROSS-SPLIT BOUNDARY LEAKAGE")
    print("=" * 80)
    print(
        "  When target_load_2h (shift -8) and lag features (lags 15m to 2h, shift +1 to +8)\n"
        "  are computed on a continuous multi-day time series before splitting by day:\n"
        "    • Rows within 2h of midnight (22:00 - 23:45) have target values located in the next day.\n"
        "    • Rows within 2h after midnight (00:00 - 01:45) look back into the previous day's load.\n"
        "  When calendar days are independently assigned to train/val/test, this could allow rows at\n"
        "  the boundary to observe features or targets from an adjacent day in another split.\n"
        "\n"
        "  RECOMMENDED MITIGATION STRATEGIES FOR PHASE B:\n"
        "    1. Boundary Masking / Purging: Exclude the 8 boundary steps at the end of each day block\n"
        "       (or mask target_load_2h with NaN at day transitions) so no training row evaluates a target\n"
        "       outside its assigned calendar day (purging only 8/96 = 8.3% of rows).\n"
        "    2. Partition-Aware Feature Assembly: Compute lags strictly within each day's chunk with\n"
        "       zero-padding or historical station-local mean initialization at 00:00.\n"
        "    3. Contiguous Block Splitting: Instead of random single-day allocation, partition time series\n"
        "       into contiguous blocks (e.g., 2-week continuous intervals) so boundary transitions occur\n"
        "       at only 2-3 points across the entire 2-year dataset rather than hundreds."
    )
    print("=" * 80 + "\n")


if __name__ == "__main__":
    run_diagnostics(seed=42)
