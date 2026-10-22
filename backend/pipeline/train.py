"""
EV Charging Surge Predictor — Phase 1: Training Pipeline
=========================================================
Synthesizes EV and grid telemetry data, engineers features (lags, rolling
stats, cyclical time), trains an XGBoost regressor, configures a TreeSHAP
explainer, evaluates model performance, and saves .joblib artifacts.

Spec references:
  - §3.1  Mathematical Formulation  (target = load t+2h)
  - §3.2  Feature Pipeline          (cyclical, lag, rolling features)
  - §3.3  Comparative Evaluation    (MAE < 8.5 kW KPI)

Artifacts saved to  backend/saved_models/:
  • xgboost_model.joblib   — trained XGBRegressor
  • scaler.joblib           — fitted StandardScaler
  • shap_explainer.joblib   — TreeSHAP Explainer
  • feature_names.joblib    — ordered feature name list
  • training_metrics.joblib — evaluation metrics dict
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

# ──────────────────────────────────────────────────────────────
# 0.  Paths
# ──────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
SAVED_MODELS_DIR = BACKEND_DIR / "saved_models"
SAVED_MODELS_DIR.mkdir(parents=True, exist_ok=True)


# ──────────────────────────────────────────────────────────────
# 1.  Synthetic Telemetry Generator
# ──────────────────────────────────────────────────────────────
def synthesize_telemetry(
    n_days: int = 90,
    interval_minutes: int = 15,
    seed: int = 42,
) -> pd.DataFrame:
    """Generate realistic EV charging station telemetry.

    The synthetic dataset models:
      • Diurnal load curves (morning commute + evening peak)
      • Weekly seasonality (weekday heavier than weekend)
      • Temperature-correlated load increase  (AC + battery draw)
      • Traffic inflow correlated with rush-hour patterns
      • Grid frequency perturbations around 60 Hz nominal
      • Stochastic active-plug counts (0-8 bays)
    """
    rng = np.random.default_rng(seed)

    timestamps = pd.date_range(
        start="2025-01-01",
        periods=n_days * (24 * 60 // interval_minutes),
        freq=f"{interval_minutes}min",
    )
    n = len(timestamps)

    hours = (timestamps.hour + timestamps.minute / 60.0).to_numpy(dtype=np.float64)
    day_of_week = timestamps.dayofweek.to_numpy(dtype=np.int32)  # 0=Mon … 6=Sun

    # --- Diurnal load pattern (bimodal: morning + evening peak) ---
    morning_peak = 80.0 * np.exp(-0.5 * ((hours - 8.5) / 1.5) ** 2)
    evening_peak = 150.0 * np.exp(-0.5 * ((hours - 18.0) / 2.0) ** 2)
    base_load = 50.0 + morning_peak + evening_peak  # kW

    # Weekend damping (≈ 70 % of weekday)
    weekend_mask = day_of_week >= 5
    base_load[weekend_mask] *= 0.7

    # --- Ambient temperature (Mumbai/Indian climate, approx 20-40C) ---
    day_index = np.arange(n, dtype=np.float64) / (24 * 60 // interval_minutes)
    seasonal_temp = 30.0 + 5.0 * np.sin(2 * np.pi * (day_index - 80) / 365)
    diurnal_temp = 5.0 * np.sin(2 * np.pi * (hours - 6) / 24)
    ambient_temp_c = seasonal_temp + diurnal_temp + rng.normal(0, 2, n)

    # Temperature-driven load uplift (heat -> AC + battery cooling)
    temp_load_uplift = np.clip((ambient_temp_c - 28) * 2.5, 0, None)
    base_load += temp_load_uplift

    # --- Traffic inflow index (0-100) ---
    traffic_base = (
        30.0
        + 35.0 * np.exp(-0.5 * ((hours - 8) / 2) ** 2)
        + 45.0 * np.exp(-0.5 * ((hours - 17.5) / 2.5) ** 2)
    )
    traffic_base[weekend_mask] *= 0.6
    traffic_inflow_index = np.clip(
        traffic_base + rng.normal(0, 8, n), 0, 100
    ).astype(np.int32)

    # Traffic contributes significantly to load
    base_load += traffic_inflow_index * 0.25

    # --- Active plugs (0-8 bays, correlated with load) ---
    plug_prob = np.clip(base_load / 250.0, 0.05, 0.95)
    active_plugs = rng.binomial(8, plug_prob)
    base_load += active_plugs * 5.0  # each plug adds ~5 kW base

    # --- Grid frequency (nominal 60 Hz, small perturbations) ---
    grid_frequency_hz = 60.0 + rng.normal(0, 0.05, n)
    # Heavy load depresses frequency slightly
    grid_frequency_hz -= np.clip((base_load - 150) * 0.0003, 0, None)

    # --- Final observed load with noise ---
    load_kw = base_load + rng.normal(0, 5, n)
    load_kw = np.clip(load_kw, 10, 300)  # physical bounds

    df = pd.DataFrame(
        {
            "timestamp": timestamps,
            "ambient_temp_c": np.round(ambient_temp_c, 1),
            "traffic_inflow_index": traffic_inflow_index,
            "active_plugs": active_plugs,
            "grid_frequency_hz": np.round(grid_frequency_hz, 3),
            "load_kw": np.round(load_kw, 1),
        }
    )
    return df


# ──────────────────────────────────────────────────────────────
# 2.  Feature Engineering
# ──────────────────────────────────────────────────────────────
def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add lag, rolling, and cyclical features per spec §3.2.

    Creates:
      - load_lag_15m/30m/60m      (historical station load lags)
      - rolling_mean_60m          (4-step rolling mean)
      - rolling_std_60m           (4-step rolling std)
      - plug_delta_15m            (plug-in rate of change)
      - hour_sin, hour_cos        (cyclical hour encoding)
      - day_sin, day_cos          (cyclical day-of-week encoding)
      - target: load_kw shifted forward by 8 steps (2 hours at 15-min)
    """
    df = df.copy()

    # Lag features (Xt−15m, Xt−30m, Xt−45m, Xt−60m)
    df["load_lag_15m"] = df["load_kw"].shift(1)
    df["load_lag_30m"] = df["load_kw"].shift(2)
    df["load_lag_45m"] = df["load_kw"].shift(3)
    df["load_lag_60m"] = df["load_kw"].shift(4)

    # Rolling statistics over 60 minutes (4 × 15-min steps)
    df["rolling_mean_60m"] = df["load_kw"].rolling(window=4).mean()
    df["rolling_std_60m"] = df["load_kw"].rolling(window=4).std()

    # Plug-in rate of change
    df["plug_delta_15m"] = df["active_plugs"].diff(1)

    # Cyclical time features
    hour = df["timestamp"].dt.hour + df["timestamp"].dt.minute / 60.0
    day = df["timestamp"].dt.dayofweek

    df["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    df["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    df["day_sin"] = np.sin(2 * np.pi * day / 7)
    df["day_cos"] = np.cos(2 * np.pi * day / 7)

    # Target: load 2 hours ahead (8 × 15-min steps)
    df["target_load_2h"] = df["load_kw"].shift(-8)

    # Drop rows with NaN from lags/rolling/target
    df.dropna(inplace=True)
    df.reset_index(drop=True, inplace=True)

    return df


# ──────────────────────────────────────────────────────────────
# 3.  Model Training
# ──────────────────────────────────────────────────────────────
FEATURE_COLUMNS = [
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

TARGET_COLUMN = "target_load_2h"


def train_model(
    df: pd.DataFrame,
    test_size: float = 0.2,
    seed: int = 42,
) -> dict:
    """Train XGBoost regressor and evaluate against spec KPIs.

    Returns a dict with:
      model, scaler, explainer, feature_names, metrics, X_test, y_test
    """
    X = df[FEATURE_COLUMNS].values
    y = df[TARGET_COLUMN].values

    # Train/test split (temporal awareness: shuffle=False for time-series)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, shuffle=False
    )

    # Standardize features
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # XGBoost Regressor — tuned for tabular EV telemetry
    model = xgb.XGBRegressor(
        n_estimators=500,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.85,
        reg_alpha=0.1,
        reg_lambda=1.0,
        min_child_weight=5,
        objective="reg:squarederror",
        tree_method="hist",
        random_state=seed,
        n_jobs=-1,
    )

    print("Training XGBoost model ...")
    model.fit(
        X_train_scaled,
        y_train,
        eval_set=[(X_test_scaled, y_test)],
        verbose=50,
    )

    # ── Evaluation ──
    y_pred = model.predict(X_test_scaled)
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))

    # Inference latency benchmark (average over 100 single-sample predictions)
    import time
    _sample = X_test_scaled[:1]
    for _ in range(10):  # warmup
        model.predict(_sample)
    latency_times = []
    for _ in range(100):
        t0 = time.perf_counter()
        model.predict(_sample)
        latency_times.append((time.perf_counter() - t0) * 1000)
    avg_latency_ms = round(float(np.mean(latency_times)), 1)

    # Surge recall: detect events where load > 80% of 250 kW capacity (Safety Margin)
    TRANSFORMER_CAPACITY = 250.0
    SURGE_THRESHOLD = 0.80 * TRANSFORMER_CAPACITY  # 200.0 kW
    actual_surge = y_test >= SURGE_THRESHOLD
    predicted_surge = y_pred >= SURGE_THRESHOLD
    if actual_surge.sum() > 0:
        surge_recall = (predicted_surge & actual_surge).sum() / actual_surge.sum()
    else:
        surge_recall = 1.0  # no surge events to miss

    metrics = {
        "mae_kw": round(float(mae), 2),
        "rmse_kw": round(float(rmse), 2),
        "surge_recall_pct": round(float(surge_recall * 100), 1),
        "latency_ms": avg_latency_ms,
        "n_train": len(X_train),
        "n_test": len(X_test),
        "n_features": len(FEATURE_COLUMNS),
    }

    print("\n" + "=" * 55)
    print("  MODEL EVALUATION RESULTS")
    print("=" * 55)
    print(f"  MAE           : {metrics['mae_kw']:.2f} kW   (target < 8.5)")
    print(f"  RMSE          : {metrics['rmse_kw']:.2f} kW")
    print(f"  Surge Recall  : {metrics['surge_recall_pct']:.1f}%  (target = 100%)")
    print(f"  Avg Latency   : {metrics['latency_ms']:.1f} ms/sample")
    print(f"  Train samples : {metrics['n_train']}")
    print(f"  Test samples  : {metrics['n_test']}")
    print("=" * 55)

    if metrics["mae_kw"] < 8.5:
        print("  [PASS] MAE KPI PASSED")
    else:
        print("  [WARN] MAE KPI NOT MET -- consider hyper-parameter tuning")

    # ── TreeSHAP Explainer ──
    print("\nConfiguring TreeSHAP explainer ...")
    explainer = shap.TreeExplainer(model)
    # Validate by computing SHAP values on a small sample
    sample_shap = explainer.shap_values(X_test_scaled[:5])
    print(f"  SHAP output shape (sample): {sample_shap.shape}")
    print(f"  SHAP base value (E[f(x)]): {explainer.expected_value:.2f} kW")

    return {
        "model": model,
        "scaler": scaler,
        "explainer": explainer,
        "feature_names": FEATURE_COLUMNS,
        "metrics": metrics,
        "X_test": X_test,
        "X_test_scaled": X_test_scaled,
        "y_test": y_test,
        "y_pred": y_pred,
    }


# ──────────────────────────────────────────────────────────────
# 4.  Save Artifacts
# ──────────────────────────────────────────────────────────────
def save_artifacts(results: dict) -> None:
    """Persist model, scaler, SHAP explainer, and metadata as .joblib."""
    artifacts = {
        "xgboost_model.joblib": results["model"],
        "scaler.joblib": results["scaler"],
        "shap_explainer.joblib": results["explainer"],
        "feature_names.joblib": results["feature_names"],
        "training_metrics.joblib": results["metrics"],
    }

    print(f"\nSaving artifacts to {SAVED_MODELS_DIR}/")
    for name, obj in artifacts.items():
        path = SAVED_MODELS_DIR / name
        joblib.dump(obj, path)
        size_kb = path.stat().st_size / 1024
        print(f"  - {name:30s} ({size_kb:7.1f} KB)")

    print("\n[OK] All artifacts saved successfully.")


# ──────────────────────────────────────────────────────────────
# 5.  Main Entry Point
# ──────────────────────────────────────────────────────────────
def main() -> None:
    print("=" * 55)
    print("  EV CHARGING SURGE PREDICTOR -- TRAINING PIPELINE")
    print("=" * 55)

    # Step 1: Synthesize data
    print("\n[1/4] Synthesizing 90 days of EV/grid telemetry ...")
    df_raw = synthesize_telemetry(n_days=90)
    print(f"  Raw records: {len(df_raw):,}")
    print(f"  Date range : {df_raw['timestamp'].iloc[0]} -> {df_raw['timestamp'].iloc[-1]}")
    print(f"  Load range : {df_raw['load_kw'].min():.1f} - {df_raw['load_kw'].max():.1f} kW")

    # Step 2: Engineer features
    print("\n[2/4] Engineering lag, rolling, and cyclical features ...")
    df = engineer_features(df_raw)
    print(f"  Feature-engineered records: {len(df):,}")
    print(f"  Feature columns ({len(FEATURE_COLUMNS)}): {', '.join(FEATURE_COLUMNS)}")

    # Step 3: Train model & configure SHAP
    print("\n[3/4] Training XGBoost + configuring TreeSHAP ...")
    results = train_model(df)

    # Step 4: Save artifacts
    print("\n[4/4] Saving .joblib artifacts ...")
    save_artifacts(results)

    print("\n>>> Phase 1 complete. Artifacts ready for FastAPI inference engine.\n")


if __name__ == "__main__":
    main()
