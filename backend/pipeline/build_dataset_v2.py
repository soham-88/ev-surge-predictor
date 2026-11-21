"""
Dataset Builder & Monotone XGBoost v2 Trainer
=============================================
Phase B Pipeline Script:
  0. Inspects and prints the exact 15 baseline feature names in order and lag mappings.
  1. Builds continuous telemetry (730 days) with target (t+2h) and 17 features
     (15 baseline + 2 derived: load_anomaly, lag_trend).
  2. Uses the shared feature assembler with how_table.
  3. Stratified day-based splitting (70% train / 15% val / 15% test).
  4. Boundary Purge: drops any row whose lag window (t-60m) or target (t+2h)
     falls on a day assigned to a DIFFERENT split than the row's own day,
     plus drops any rows with NaN target/lags.
  5. Fits XGBRegressor v2 with monotone constraints (+1 on lags & derived features,
     0 on all others) on TRAIN with early stopping on VAL (eval_metric="mae").
  6. Saves artifacts to candidate_v2/:
     - xgb_v2.joblib
     - feature_names_v2.json
     - metrics_v2.json
     - train_purged.parquet, val_purged.parquet, test_purged.parquet

Usage:
    python backend/pipeline/build_dataset_v2.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict, Tuple

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

# Directory resolution
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
CANDIDATE_V2_DIR = SCRIPT_DIR / "candidate_v2"
CANDIDATE_V2_DIR.mkdir(parents=True, exist_ok=True)

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from app.core.timezone import to_station_local
from app.models.ml_engine import assemble_features_df
from pipeline.generator_v2 import (
    synthesize_telemetry_v2,
    split_by_day,
    lookup_hour_of_week_mean,
    TRANSFORMER_CAPACITY_KW,
    WARNING_THRESHOLD_KW,
    CRITICAL_THRESHOLD_KW,
)

# 15 Baseline feature names from train.py / ml_engine.py
FEATURE_COLUMNS_V1 = [
    "ambient_temp_c",
    "traffic_inflow_index",
    "active_plugs",
    "grid_frequency_hz",
    "load_lag_15m",
    "load_lag_30m",
    "load_lag_45m",
    "load_lag_60m",
    "rolling_mean_60m",
    "rolling_std_60m",
    "plug_delta_15m",
    "hour_sin",
    "hour_cos",
    "day_sin",
    "day_cos",
]

# 17 Feature names for candidate v2
FEATURE_COLUMNS_V2 = FEATURE_COLUMNS_V1 + [
    "load_anomaly",
    "lag_trend",
]

MONOTONE_CONSTRAINTS_V2 = {
    "load_lag_15m": 1,
    "load_lag_30m": 1,
    "load_lag_45m": 1,
    "load_lag_60m": 1,
    "load_anomaly": 1,
    "lag_trend": 1,
}


def inspect_baseline_features() -> None:
    """Step 0: Print the exact 15 input feature names in order and lag column mappings."""
    print("=" * 80)
    print("  STEP 0: BASELINE FEATURE INSPECTION (SHARED ASSEMBLER & TRAIN.PY)")
    print("=" * 80)
    print("Exact 15 input feature names, in order:")
    for idx, fname in enumerate(FEATURE_COLUMNS_V1, start=1):
        lag_note = ""
        if fname == "load_lag_15m":
            lag_note = "  <-- Station load 1 step ago (t - 15 min)"
        elif fname == "load_lag_30m":
            lag_note = "  <-- Station load 2 steps ago (t - 30 min)"
        elif fname == "load_lag_45m":
            lag_note = "  <-- Station load 3 steps ago (t - 45 min)"
        elif fname == "load_lag_60m":
            lag_note = "  <-- Station load 4 steps ago (t - 60 min)"
        print(f"  [{idx:2d}] {fname:<22}{lag_note}")

    print("\nLag Column Summary:")
    print("  • 1 step ago (15 min) : 'load_lag_15m' (column 5)")
    print("  • 2 steps ago (30 min): 'load_lag_30m' (column 6)")
    print("  • 3 steps ago (45 min): 'load_lag_45m' (column 7)")
    print("  • 4 steps ago (60 min): 'load_lag_60m' (column 8)")
    print("=" * 80 + "\n")


def build_and_purge_dataset(
    n_days: int = 730,
    seed: int = 42,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.Series]:
    """Build telemetry features on continuous series, split, and boundary-purge."""
    print("=" * 80)
    print("  STEP 1: DATASET BUILDER & BOUNDARY PURGE (CONTINUOUS SERIES)")
    print("=" * 80)

    # 1. Synthesize or load continuous telemetry
    raw_parquet_path = CANDIDATE_V2_DIR / "train_data_v2.parquet"
    if raw_parquet_path.exists():
        print(f"  Loading existing continuous telemetry from {raw_parquet_path.name} ...")
        df_raw = pd.read_parquet(raw_parquet_path)
    else:
        print(f"  Synthesizing telemetry v2 ({n_days} days, seed={seed}) ...")
        df_raw = synthesize_telemetry_v2(n_days=n_days, interval_minutes=15, seed=seed)
        df_raw.to_parquet(raw_parquet_path, index=False)

    print(f"  Continuous records: {len(df_raw):,} rows ({len(df_raw) // 96} days)")

    # 2. Load TRAIN-only hour-of-week mean table
    how_joblib_path = CANDIDATE_V2_DIR / "hour_of_week_mean.joblib"
    if not how_joblib_path.exists():
        raise FileNotFoundError(f"Missing {how_joblib_path}. Run diagnose_generator_v2.py first.")
    how_table = joblib.load(how_joblib_path)
    print(f"  Loaded TRAIN-only hour-of-week table: {len(how_table)} cells")

    # 3. Continuous feature engineering
    df = df_raw.copy()
    # Target 2h ahead (shift -8)
    df["target_load_2h"] = df["load_kw"].shift(-8)

    # Lags (15m, 30m, 45m, 60m)
    df["load_lag_15m"] = df["load_kw"].shift(1)
    df["load_lag_30m"] = df["load_kw"].shift(2)
    df["load_lag_45m"] = df["load_kw"].shift(3)
    df["load_lag_60m"] = df["load_kw"].shift(4)

    # Use shared assembler with how_table for all 17 features
    features_17 = assemble_features_df(df, is_batch=True, how_table=how_table, feature_names=FEATURE_COLUMNS_V2)
    for col in features_17.columns:
        df[col] = features_17[col]

    # 4. Stratified split by whole calendar days (70% train / 15% val / 15% test)
    train_df, val_df, test_df = split_by_day(df, seed=seed)

    # Date to split mapping
    date_to_split: Dict = {}
    for d in train_df["timestamp"].dt.date.unique():
        date_to_split[d] = "train"
    for d in val_df["timestamp"].dt.date.unique():
        date_to_split[d] = "val"
    for d in test_df["timestamp"].dt.date.unique():
        date_to_split[d] = "test"

    # 5. Boundary Purge
    def purge_split(split_df: pd.DataFrame, split_name: str) -> Tuple[pd.DataFrame, Dict[str, int]]:
        ts = split_df["timestamp"]
        ts_lag60 = ts - pd.Timedelta(minutes=60)
        ts_target2h = ts + pd.Timedelta(hours=2)

        split_lag = ts_lag60.dt.date.map(date_to_split)
        split_target = ts_target2h.dt.date.map(date_to_split)

        cross_lag = (split_lag != split_name)
        cross_target = (split_target != split_name)
        has_nan_target = split_df["target_load_2h"].isna()
        has_nan_lag = split_df["load_lag_60m"].isna()

        drop_mask = cross_lag | cross_target | has_nan_target | has_nan_lag
        purged = split_df[~drop_mask].copy().reset_index(drop=True)

        counts = {
            "initial": len(split_df),
            "cross_lag": int(cross_lag.sum()),
            "cross_target": int(cross_target.sum()),
            "nan_target": int(has_nan_target.sum()),
            "nan_lag": int(has_nan_lag.sum()),
            "total_dropped": int(drop_mask.sum()),
            "kept": len(purged),
        }
        return purged, counts

    print("\n  Boundary Purge Summary (cross-split lag window t-60m or target t+2h):")
    print(f"  {'Split':<8} | {'Initial':>8} | {'Drop Lag Cross':>15} | {'Drop Target Cross':>18} | {'Drop NaN':>9} | {'Total Drop':>11} | {'Kept':>8}")
    print("  " + "-" * 88)

    purged_splits = {}
    for name, split in [("train", train_df), ("val", val_df), ("test", test_df)]:
        purged, c = purge_split(split, name)
        purged_splits[name] = purged
        nan_sum = c["nan_target"] + c["nan_lag"]
        print(f"  {name.upper():<8} | {c['initial']:8d} | {c['cross_lag']:15d} | {c['cross_target']:18d} | {nan_sum:9d} | {c['total_dropped']:11d} | {c['kept']:8d}")
    print("  " + "-" * 88)

    train_purged = purged_splits["train"]
    val_purged = purged_splits["val"]
    test_purged = purged_splits["test"]

    # Save purged datasets to candidate_v2
    train_purged.to_parquet(CANDIDATE_V2_DIR / "train_purged.parquet", index=False)
    val_purged.to_parquet(CANDIDATE_V2_DIR / "val_purged.parquet", index=False)
    test_purged.to_parquet(CANDIDATE_V2_DIR / "test_purged.parquet", index=False)
    print("  Saved train_purged.parquet, val_purged.parquet, test_purged.parquet to candidate_v2/")

    return train_purged, val_purged, test_purged, how_table


def train_monotone_xgboost_v2(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    test_df: pd.DataFrame,
    seed: int = 42,
) -> xgb.XGBRegressor:
    """Train XGBRegressor with monotone constraints on TRAIN, early stopping on VAL."""
    print("\n" + "=" * 80)
    print("  STEP 2: TRAINING MONOTONE XGBOOST V2 (17 FEATURES)")
    print("=" * 80)

    X_train = train_df[FEATURE_COLUMNS_V2]
    y_train = train_df["target_load_2h"]
    X_val = val_df[FEATURE_COLUMNS_V2]
    y_val = val_df["target_load_2h"]
    X_test = test_df[FEATURE_COLUMNS_V2]
    y_test = test_df["target_load_2h"]

    print(f"  Feature set ({len(FEATURE_COLUMNS_V2)} features): {FEATURE_COLUMNS_V2}")
    print(f"  Monotone constraints: {MONOTONE_CONSTRAINTS_V2} (+1 on lags & derived, 0 on others)")
    print(f"  Training shapes: X_train={X_train.shape}, X_val={X_val.shape}, X_test={X_test.shape}")

    model = xgb.XGBRegressor(
        n_estimators=1000,
        learning_rate=0.05,
        max_depth=5,
        subsample=0.8,
        colsample_bytree=0.8,
        monotone_constraints=MONOTONE_CONSTRAINTS_V2,
        early_stopping_rounds=30,
        random_state=seed,
        eval_metric="mae",
        n_jobs=-1,
    )

    print("  Fitting on TRAIN with early stopping on VAL (metric: MAE, patience: 30 rounds) ...")
    model.fit(
        X_train,
        y_train,
        eval_set=[(X_val, y_val)],
        verbose=False,
    )

    best_iter = model.best_iteration
    print(f"  Training complete. Best iteration: {best_iter}")

    # Compute train/val/test evaluation metrics
    pred_tr = model.predict(X_train)
    pred_va = model.predict(X_val)
    pred_te = model.predict(X_test)

    metrics = {
        "model": "XGBRegressor_v2_monotone",
        "random_seed": seed,
        "best_iteration": int(best_iter),
        "n_features": len(FEATURE_COLUMNS_V2),
        "feature_names": FEATURE_COLUMNS_V2,
        "monotone_constraints": MONOTONE_CONSTRAINTS_V2,
        "train": {
            "rows": len(train_df),
            "mae_kw": round(float(mean_absolute_error(y_train, pred_tr)), 3),
            "rmse_kw": round(float(np.sqrt(mean_squared_error(y_train, pred_tr))), 3),
            "r2": round(float(r2_score(y_train, pred_tr)), 4),
        },
        "val": {
            "rows": len(val_df),
            "mae_kw": round(float(mean_absolute_error(y_val, pred_va)), 3),
            "rmse_kw": round(float(np.sqrt(mean_squared_error(y_val, pred_va))), 3),
            "r2": round(float(r2_score(y_val, pred_va)), 4),
        },
        "test": {
            "rows": len(test_df),
            "mae_kw": round(float(mean_absolute_error(y_test, pred_te)), 3),
            "rmse_kw": round(float(np.sqrt(mean_squared_error(y_test, pred_te))), 3),
            "r2": round(float(r2_score(y_test, pred_te)), 4),
        },
    }

    print(f"  TRAIN -> MAE: {metrics['train']['mae_kw']:.2f} kW | RMSE: {metrics['train']['rmse_kw']:.2f} kW | R2: {metrics['train']['r2']:.4f}")
    print(f"  VAL   -> MAE: {metrics['val']['mae_kw']:.2f} kW | RMSE: {metrics['val']['rmse_kw']:.2f} kW | R2: {metrics['val']['r2']:.4f}")
    print(f"  TEST  -> MAE: {metrics['test']['mae_kw']:.2f} kW | RMSE: {metrics['test']['rmse_kw']:.2f} kW | R2: {metrics['test']['r2']:.4f}")

    # Save artifacts
    model_path = CANDIDATE_V2_DIR / "xgb_v2.joblib"
    feat_path = CANDIDATE_V2_DIR / "feature_names_v2.json"
    metrics_path = CANDIDATE_V2_DIR / "metrics_v2.json"

    joblib.dump(model, model_path)
    with open(feat_path, "w") as f:
        json.dump(FEATURE_COLUMNS_V2, f, indent=2)
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)

    print(f"\n  Saved candidate artifacts:")
    print(f"    • Model weights : {model_path.name} ({model_path.stat().st_size / 1024:.1f} KB)")
    print(f"    • Feature names : {feat_path.name} ({len(FEATURE_COLUMNS_V2)} ordered names)")
    print(f"    • Metrics report: {metrics_path.name}")
    print("=" * 80 + "\n")

    return model


def main() -> None:
    inspect_baseline_features()
    train_df, val_df, test_df, how_table = build_and_purge_dataset(n_days=730, seed=42)
    train_monotone_xgboost_v2(train_df, val_df, test_df, seed=42)


if __name__ == "__main__":
    main()
