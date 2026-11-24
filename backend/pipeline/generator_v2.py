"""
EV Charging Surge Predictor — Synthetic Telemetry Generator v2
==============================================================
Phase A Candidate Data Generator implementing:
  a) Daily demand multiplier per day: normal(1.0, 0.08), clipped to [0.85, 1.15].
  b) Event days (~8% of days): evening-peak load multiplied by [1.30, 1.60].
     Low-demand days (~8% of days): whole-day load multiplied by [0.70, 0.85].
  c) Intra-day AR(1) shock added to load: phi=0.97 per 15-min step,
     stationary std sigma_s=20.0 kW, dominant intra-day persistence.
  d) Realistic bay occupancy persistence (charging sessions persist 30-90 min).
  e) White noise reduced to ~3.5 kW (<= 5 kW, ~17.5% of AR std) ensuring within-day
     lag-1 autocorrelation of (load - hour_of_week_mean) >= 0.80.
  f) Ambient temperature strictly in [20.0, 40.0] C Mumbai climate range.
  g) Physical load bounds strictly clipped to [10, 300] kW.
  h) Includes 'day_type' column in {'normal', 'event', 'low'} for evaluation only
     (never to be used as a model training feature).
  i) Stratified day-based splitting (70% train / 15% val / 15% test) preserving
     identical day-type distributions across splits.

Phase B Note (Boundary Cross-Split Leakage Mitigation):
-------------------------------------------------------
In continuous telemetry series, 2h-ahead targets (shift -8) and lag features
(lags 15m to 2h, shift +1 to +8) computed across continuous calendar boundaries
cause the 8 boundary steps at the end of a day (22:00-23:45) to look into the next
day's load, and the 8 boundary steps at the start of a day (00:00-01:45) to look back
into the previous day's load. When calendar days are randomly split into train/val/test:
  1. Purging / Masking Boundary Rows: Exclude (drop from loss/metrics) the 8 boundary
     rows at midnight for target calculation, or mask them with NaN.
  2. Day-Partitioned Lags: Compute rolling lags and target strictly within each day
     (or contiguous multi-day blocks assigned to the same split).
  3. Contiguous Block Splitting: Partition dataset into contiguous calendar blocks
     (e.g., 2-week or 1-month chunks) instead of single-day shuffling.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, Tuple, Union

import numpy as np
import pandas as pd

# Transformer and threshold constants matching app.core.config
TRANSFORMER_CAPACITY_KW: float = 250.0
SURGE_THRESHOLD_PCT: float = 0.80  # 80% capacity = 200.0 kW (CRITICAL)
WARNING_THRESHOLD_PCT: float = 0.65  # 65% capacity = 162.5 kW (WARNING)
CRITICAL_THRESHOLD_KW: float = SURGE_THRESHOLD_PCT * TRANSFORMER_CAPACITY_KW  # 200.0 kW
WARNING_THRESHOLD_KW: float = WARNING_THRESHOLD_PCT * TRANSFORMER_CAPACITY_KW  # 162.5 kW


def synthesize_telemetry_v2(
    n_days: int = 730,
    interval_minutes: int = 15,
    seed: int = 42,
) -> pd.DataFrame:
    """Generate realistic EV charging station telemetry (Version 2).

    Parameters
    ----------
    n_days : int, default=730
        Number of days to generate at 15-minute cadence (default 730 days = 2 years).
    interval_minutes : int, default=15
        Cadence between consecutive observations (default 15 min).
    seed : int, default=42
        Fixed random seed for reproducible and deterministic generation.

    Behaviors modeled:
      • Diurnal bimodal curve (morning commute + evening peak)
      • Weekly seasonality (weekday full load, weekend 70% damping)
      • Indian/Mumbai climate ambient temperature [20, 40] °C + heat uplift
      • Traffic inflow index with rush hour peaks
      • Stochastic active charging bay plugs (0 to 8 stalls) with session continuity
      • Grid frequency fluctuations around 50 Hz nominal
      • Daily demand multiplier per day ~ Normal(1.0, 0.08), clipped to [0.85, 1.15]
      • Event days (~8%): evening peak multiplied by Uniform(1.30, 1.60)
      • Low-demand days (~8%): full-day base load multiplied by Uniform(0.70, 0.85)
      • Intra-day AR(1) shock (phi=0.97, stationary sigma=20.0 kW, innovation sigma=4.86 kW)
      • Per-step white noise tuned to 3.5 kW (<= 5 kW, ~17.5% of AR std)
      • Evaluation-only 'day_type' column with values in {'normal', 'event', 'low'}
    """
    rng = np.random.default_rng(seed)

    steps_per_day = 24 * 60 // interval_minutes  # 96 steps per day
    timestamps = pd.date_range(
        start="2025-01-01",
        periods=n_days * steps_per_day,
        freq=f"{interval_minutes}min",
    )
    n = len(timestamps)

    hours = (timestamps.hour + timestamps.minute / 60.0).to_numpy(dtype=np.float64)
    day_of_week = timestamps.dayofweek.to_numpy(dtype=np.int32)  # 0=Mon … 6=Sun
    day_indices = np.arange(n) // steps_per_day  # 0 to n_days - 1

    # 1. Day types allocation: exactly ~8% event, ~8% low, remainder normal
    n_event = max(1, int(round(n_days * 0.08)))
    n_low = max(1, int(round(n_days * 0.08)))
    n_normal = n_days - n_event - n_low
    day_types_pool = ["normal"] * n_normal + ["event"] * n_event + ["low"] * n_low
    rng.shuffle(day_types_pool)
    day_types = np.array(day_types_pool)

    # 2. Daily demand multiplier per day: Normal(1.0, 0.08), clipped to [0.85, 1.15]
    daily_demand_mult = np.clip(rng.normal(1.0, 0.08, n_days), 0.85, 1.15)

    # 3. Specific multipliers for event and low-demand days
    event_evening_mult = np.ones(n_days, dtype=np.float64)
    low_demand_mult = np.ones(n_days, dtype=np.float64)
    for d in range(n_days):
        if day_types[d] == "event":
            event_evening_mult[d] = rng.uniform(1.30, 1.60)
        elif day_types[d] == "low":
            low_demand_mult[d] = rng.uniform(0.70, 0.85)

    # 4. Diurnal load pattern with event evening peak scaling
    morning_peak = 80.0 * np.exp(-0.5 * ((hours - 8.5) / 1.5) ** 2)
    evening_peak = 150.0 * np.exp(-0.5 * ((hours - 18.0) / 2.0) ** 2) * event_evening_mult[day_indices]
    base_load = (50.0 + morning_peak + evening_peak) * daily_demand_mult[day_indices] * low_demand_mult[day_indices]

    # 5. Weekend damping (≈ 70% of weekday)
    weekend_mask = day_of_week >= 5
    base_load[weekend_mask] *= 0.7

    # 6. Ambient temperature (Mumbai/Indian climate, strictly clipped to 20.0 - 40.0 °C)
    day_index = np.arange(n, dtype=np.float64) / steps_per_day
    seasonal_temp = 30.0 + 5.0 * np.sin(2 * np.pi * (day_index - 80) / 365)
    diurnal_temp = 5.0 * np.sin(2 * np.pi * (hours - 6) / 24)
    ambient_temp_c = np.clip(seasonal_temp + diurnal_temp + rng.normal(0, 1.0, n), 20.0, 40.0)

    # Temperature-driven load uplift (heat -> AC + battery cooling above 28°C)
    temp_load_uplift = np.clip((ambient_temp_c - 28.0) * 2.5, 0.0, None)
    base_load += temp_load_uplift

    # 7. Traffic inflow index (0-100)
    traffic_base = (
        30.0
        + 35.0 * np.exp(-0.5 * ((hours - 8.0) / 2.0) ** 2)
        + 45.0 * np.exp(-0.5 * ((hours - 17.5) / 2.5) ** 2)
    )
    traffic_base[weekend_mask] *= 0.6
    traffic_inflow_index = np.clip(
        traffic_base + rng.normal(0, 4.0, n), 0, 100
    ).astype(np.int32)
    base_load += traffic_inflow_index * 0.25

    # 8. Intra-day AR(1) shock (phi=0.97, stationary std=20.0 kW, innovation std=4.86 kW)
    # The AR(1) shock is the primary source of intra-day persistent deviations
    phi = 0.97
    sigma_s = 20.0
    sigma_eps = sigma_s * np.sqrt(1.0 - phi**2)  # ≈ 4.862 kW innovation noise
    shocks = np.zeros(n, dtype=np.float64)
    shocks[0] = rng.normal(0, sigma_s)
    eps = rng.normal(0, sigma_eps, n)
    for t in range(1, n):
        shocks[t] = phi * shocks[t - 1] + eps[t]

    load_before_plugs = base_load + shocks

    # 9. Active plugs (0-8 bays, correlated with load + session persistence)
    # Real EV charging sessions persist across 30-90 minutes (2-6 time steps).
    # Modeling session continuity prevents independent step-to-step binomial jumps
    # from destroying intra-day persistence.
    plug_prob = np.clip(load_before_plugs / 250.0, 0.05, 0.95)
    active_plugs = np.zeros(n, dtype=np.int32)
    curr_plugs = rng.binomial(8, plug_prob[0])
    active_plugs[0] = curr_plugs
    for t in range(1, n):
        target_plugs = rng.binomial(8, plug_prob[t])
        # Smooth transition reflecting persistent charging sessions
        curr_plugs = int(round(0.80 * curr_plugs + 0.20 * target_plugs))
        active_plugs[t] = curr_plugs

    # Small centered load adjustment from active plugs (±4 kW relative to 4 nominal stalls)
    plugs_load_adjustment = (active_plugs - 4) * 2.0

    # 10. Grid frequency (nominal 50 Hz, small perturbations)
    grid_frequency_hz = 50.0 + rng.normal(0, 0.05, n)
    grid_frequency_hz -= np.clip((load_before_plugs - 150.0) * 0.0003, 0.0, None)

    # 11. Final observed load with controlled per-step white noise (3.5 kW <= 5 kW)
    white_noise = rng.normal(0, 3.5, n)
    load_kw = load_before_plugs + plugs_load_adjustment + white_noise
    load_kw = np.clip(load_kw, 10.0, 300.0)

    df = pd.DataFrame(
        {
            "timestamp": timestamps,
            "ambient_temp_c": np.round(ambient_temp_c, 1),
            "traffic_inflow_index": traffic_inflow_index,
            "active_plugs": active_plugs,
            "grid_frequency_hz": np.round(grid_frequency_hz, 3),
            "load_kw": np.round(load_kw, 1),
            "day_type": day_types[day_indices],
        }
    )
    return df


def split_by_day(
    df: pd.DataFrame,
    seed: int = 42,
    train_frac: float = 0.70,
    val_frac: float = 0.15,
    test_frac: float = 0.15,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Split telemetry by whole calendar days (70% train, 15% val, 15% test).

    Ensures whole calendar days are assigned to one and only one split to prevent
    intra-day AR(1) shock leakage across consecutive steps. Stratifies by day_type
    when present so train/val/test each get identical shares of normal, event, and low days,
    guaranteeing >= 8 event days in the test split.

    Parameters
    ----------
    df : pd.DataFrame
        DataFrame containing a 'timestamp' column.
    seed : int, default=42
        Fixed seed for reproducible day assignment.
    train_frac : float, default=0.70
    val_frac : float, default=0.15
    test_frac : float, default=0.15

    Returns
    -------
    tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]
        (train_df, val_df, test_df)
    """
    if "timestamp" not in df.columns:
        raise ValueError("DataFrame must contain a 'timestamp' column for day-based splitting.")

    dates = pd.Series(df["timestamp"].dt.date.unique())
    rng = np.random.default_rng(seed)

    if "day_type" in df.columns:
        date_to_type = df.groupby(df["timestamp"].dt.date)["day_type"].first().to_dict()
        train_dates: list = []
        val_dates: list = []
        test_dates: list = []

        for dt_name in ["normal", "event", "low"]:
            matching_dates = [d for d in dates if date_to_type.get(d) == dt_name]
            if not matching_dates:
                continue
            shuffled = list(rng.permutation(matching_dates))
            n = len(shuffled)
            # Symmetrically allocate val and test shares, assigning the exact balance to train
            n_va = int(round(n * val_frac))
            n_te = int(round(n * test_frac))
            n_tr = n - (n_va + n_te)
            train_dates.extend(shuffled[:n_tr])
            val_dates.extend(shuffled[n_tr : n_tr + n_va])
            test_dates.extend(shuffled[n_tr + n_va :])
    else:
        shuffled = list(rng.permutation(dates))
        n = len(shuffled)
        n_va = int(round(n * val_frac))
        n_te = int(round(n * test_frac))
        n_tr = n - (n_va + n_te)
        train_dates = shuffled[:n_tr]
        val_dates = shuffled[n_tr : n_tr + n_va]
        test_dates = shuffled[n_tr + n_va :]

    train_df = df[df["timestamp"].dt.date.isin(train_dates)].sort_values("timestamp").reset_index(drop=True)
    val_df = df[df["timestamp"].dt.date.isin(val_dates)].sort_values("timestamp").reset_index(drop=True)
    test_df = df[df["timestamp"].dt.date.isin(test_dates)].sort_values("timestamp").reset_index(drop=True)

    return train_df, val_df, test_df


def compute_hour_of_week_mean(df_train: pd.DataFrame) -> pd.Series:
    """Compute mean load for each hour of the week (168 cells) from the TRAIN split only.

    Index: MultiIndex (day_of_week, hour) where day_of_week in [0..6] (Mon=0), hour in [0..23].
    """
    dow = df_train["timestamp"].dt.dayofweek.rename("day_of_week")
    hour = df_train["timestamp"].dt.hour.rename("hour")
    table = df_train.groupby([dow, hour])["load_kw"].mean().rename("mean_load_kw")
    return table


def lookup_hour_of_week_mean(
    table: Union[pd.Series, Dict[Tuple[int, int], float]],
    timestamps: pd.Series,
    interpolate: bool = True,
) -> np.ndarray:
    """Map timestamps to their corresponding hour-of-week mean load values.

    Parameters
    ----------
    table : pd.Series or dict
        Table mapping (day_of_week, hour) to mean load in kW (168 cells).
    timestamps : pd.Series
        Pandas Series of timestamps.
    interpolate : bool, default=True
        If True, linearly interpolates across the hour using timestamp minute
        fraction (minute / 60.0), avoiding artificial 15-minute staircase jumps
        at hour boundaries. If False, returns the raw hourly cell value.
    """
    if isinstance(table, pd.Series):
        mapping = table.to_dict()
    else:
        mapping = table

    if not interpolate:
        dows = timestamps.dt.dayofweek
        hours = timestamps.dt.hour
        return np.array([mapping.get((d, h), np.nan) for d, h in zip(dows, hours)], dtype=np.float64)

    vals = []
    dows = timestamps.dt.dayofweek.to_numpy()
    hours = timestamps.dt.hour.to_numpy()
    minutes = timestamps.dt.minute.to_numpy()

    for d, h, m in zip(dows, hours, minutes):
        v0 = mapping.get((d, h), np.nan)
        h1 = (h + 1) % 24
        d1 = d if h < 23 else (d + 1) % 7
        v1 = mapping.get((d1, h1), v0)
        vals.append(v0 + (m / 60.0) * (v1 - v0))

    return np.array(vals, dtype=np.float64)


def compute_surge_recall(
    y_true: Union[np.ndarray, pd.Series],
    y_pred: Union[np.ndarray, pd.Series],
    threshold: float = CRITICAL_THRESHOLD_KW,
) -> float:
    """Compute surge recall detecting events >= threshold (default 200 kW / 80% capacity).

    Matches the exact evaluation formulation used across Phase 1 train.py, benchmark_models.py,
    and verify_artifacts.py.
    """
    y_true_arr = np.asarray(y_true)
    y_pred_arr = np.asarray(y_pred)
    actual_surge = y_true_arr >= threshold
    predicted_surge = y_pred_arr >= threshold
    if actual_surge.sum() > 0:
        return float((predicted_surge & actual_surge).sum() / actual_surge.sum())
    return 1.0
