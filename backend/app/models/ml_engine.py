"""
ML Inference Engine — loads saved .joblib artifacts and provides
prediction + SHAP explanation methods for the FastAPI endpoints.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Dict, List, Tuple, Any

import joblib
import numpy as np
import pandas as pd

from app.core.config import SAVED_MODELS_DIR, BACKEND_DIR
from app.core.timezone import to_station_local


def assemble_features_df(
    df: pd.DataFrame,
    is_batch: bool = False,
    how_table: Any = None,
    feature_names: List[str] | None = None,
    prev_active_plugs: int | float | None = None,
) -> pd.DataFrame:
    """Build the feature dataframe matching FEATURE_COLUMNS (15) or v2 (17).

    Shared logic for training, single-row (live), and multi-row (batch) predictions.
    If how_table is None: returns the 15-element feature dataframe, preserving existing behavior.
    If how_table is provided: adds two derived features (load_anomaly, lag_trend) using
    station-local time via to_station_local:
      - load_anomaly = lag_15 - HoW(t - 15 min)
      - lag_trend = lag_15 - lag_60
    """
    # 1. Cyclical time encoding
    if "timestamp" in df.columns:
        timestamps = to_station_local(df["timestamp"])
        hour = timestamps.dt.hour + timestamps.dt.minute / 60.0
        day_of_week = timestamps.dt.dayofweek
    else:
        timestamps = None
        hour = df["hour"]
        day_of_week = df["day_of_week"]

    hour_sin = np.sin(2 * np.pi * hour / 24)
    hour_cos = np.cos(2 * np.pi * hour / 24)
    day_sin = np.sin(2 * np.pi * day_of_week / 7)
    day_cos = np.cos(2 * np.pi * day_of_week / 7)

    # 2. Rolling features
    lags_df = df[["load_lag_15m", "load_lag_30m", "load_lag_45m", "load_lag_60m"]]
    rolling_mean_60m = lags_df.mean(axis=1)
    rolling_std_60m = lags_df.std(axis=1, ddof=1)

    # 3. Plug delta
    if how_table is not None:
        if is_batch:
            plug_delta_15m = df["active_plugs"].diff(1).fillna(0)
        else:
            if prev_active_plugs is not None:
                plug_delta_15m = (df["active_plugs"] - float(prev_active_plugs)).astype(float)
            else:
                plug_delta_15m = 0.0
    else:
        if is_batch:
            plug_delta_15m = df["active_plugs"].diff(1).fillna(0)
        else:
            plug_delta_15m = (df["active_plugs"] - 4).clip(lower=0)

    # 4. Assemble in exact order
    features_dict = {
        "ambient_temp_c": df["ambient_temp_c"],
        "traffic_inflow_index": df["traffic_inflow_index"],
        "active_plugs": df["active_plugs"],
        "grid_frequency_hz": df["grid_frequency_hz"],
        "load_lag_15m": df["load_lag_15m"],
        "load_lag_30m": df["load_lag_30m"],
        "load_lag_45m": df["load_lag_45m"],
        "load_lag_60m": df["load_lag_60m"],
        "rolling_mean_60m": rolling_mean_60m,
        "rolling_std_60m": rolling_std_60m,
        "plug_delta_15m": plug_delta_15m,
        "hour_sin": hour_sin,
        "hour_cos": hour_cos,
        "day_sin": day_sin,
        "day_cos": day_cos,
    }

    if how_table is not None:
        from pipeline.generator_v2 import lookup_hour_of_week_mean

        if timestamps is not None:
            ts_minus_15 = timestamps - pd.Timedelta(minutes=15)
            how_m15 = lookup_hour_of_week_mean(how_table, ts_minus_15)
        else:
            # Single-row or batch without timestamp: construct station-local reference
            ref_dt = pd.to_datetime("2025-01-06 00:00:00")  # Monday
            h_vals = np.asarray(hour, dtype=np.float64)
            d_vals = np.asarray(day_of_week, dtype=np.int32)
            ts_arr = [
                ref_dt + pd.Timedelta(days=int(d), minutes=float(h * 60.0) - 15.0)
                for d, h in zip(d_vals, h_vals)
            ]
            how_m15 = lookup_hour_of_week_mean(how_table, pd.Series(ts_arr))

        features_dict["load_anomaly"] = df["load_lag_15m"] - how_m15
        features_dict["lag_trend"] = df["load_lag_15m"] - df["load_lag_60m"]

    features_df = pd.DataFrame(features_dict)

    if how_table is None:
        if feature_names:
            return features_df[feature_names]
        return features_df

    target_cols = (
        feature_names + ["load_anomaly", "lag_trend"]
        if feature_names and "load_anomaly" not in feature_names
        else (feature_names if feature_names else list(features_dict.keys()))
    )
    return features_df[target_cols]


class MLEngine:
    """Singleton-style ML engine that lazily loads model artifacts."""

    def __init__(self) -> None:
        self._model = None
        self._how_table = None
        self._explainer = None
        self._feature_names: List[str] = []
        self._training_metrics: Dict = {}
        self._interval_calibration: Dict[str, Any] = {}
        self._global_shap_cache: Dict[str, Any] | None = None
        self._loaded = False

    def load(self) -> None:
        """Load all .joblib artifacts from disk and run startup validation."""
        if self._loaded:
            return

        model_path = SAVED_MODELS_DIR / "xgboost_model.joblib"
        if not model_path.exists():
            raise FileNotFoundError(
                f"Model artifacts not found at {SAVED_MODELS_DIR}. "
                "Run `python -m backend.pipeline.train` first."
            )

        self._model = joblib.load(model_path)
        
        how_path = SAVED_MODELS_DIR / "hour_of_week_mean.joblib"
        if not how_path.exists():
            raise FileNotFoundError(f"Hour-of-week table not found at {how_path}.")
        self._how_table = joblib.load(how_path)

        self._feature_names = joblib.load(SAVED_MODELS_DIR / "feature_names.joblib")

        shap_path = SAVED_MODELS_DIR / "shap_explainer.joblib"
        if shap_path.exists():
            self._explainer = joblib.load(shap_path)
        else:
            import shap
            self._explainer = shap.TreeExplainer(self._model)

        self._training_metrics = joblib.load(SAVED_MODELS_DIR / "training_metrics.joblib")

        cal_path = SAVED_MODELS_DIR / "interval_calibration.joblib"
        if cal_path.exists():
            self._interval_calibration = joblib.load(cal_path)
        else:
            self._interval_calibration = {
                "q10_kw": -20.337,
                "q90_kw": 19.801,
                "coverage": 0.797,
                "n_test": 9210,
            }

        # Startup validation: fail fast with clear messages
        if len(self._feature_names) != self._model.n_features_in_:
            raise ValueError(
                f"Feature count mismatch: {len(self._feature_names)} feature names loaded, "
                f"but model expects {self._model.n_features_in_} features."
            )

        try:
            test_shap = self._explainer.shap_values(np.zeros((1, len(self._feature_names))))
            if test_shap.shape[1] != len(self._feature_names):
                raise ValueError(
                    f"Explainer output dimension {test_shap.shape[1]} does not match feature count {len(self._feature_names)}."
                )
        except Exception as e:
            raise ValueError(
                f"SHAP explainer feature validation failed for {len(self._feature_names)} features: {e}"
            ) from e

        if self._how_table is None or len(self._how_table) != 168:
            how_len = len(self._how_table) if self._how_table is not None else 0
            raise ValueError(
                f"Hour-of-week table must contain 168 cells (7 days x 24 hours), but found {how_len}."
            )

        self._loaded = True

    # ── Feature Assembly ──────────────────────────────────────

    def _assemble_features_df(
        self,
        df: pd.DataFrame,
        is_batch: bool = False,
        how_table: Any = None,
        prev_active_plugs: int | float | None = None,
    ) -> pd.DataFrame:
        """Build the feature dataframe.

        If how_table is None: returns the 15-element feature dataframe matching
        train.py FEATURE_COLUMNS, preserving exact existing behavior.
        If how_table is provided: adds two derived features (load_anomaly, lag_trend)
        using station-local time via to_station_local, producing 17 features total.
        """
        target_fnames = self._feature_names if how_table is not None else None
        return assemble_features_df(
            df=df,
            is_batch=is_batch,
            how_table=how_table,
            feature_names=target_fnames,
            prev_active_plugs=prev_active_plugs,
        )

    # ── Prediction ────────────────────────────────────────────

    def predict(
        self,
        ambient_temp_c: float,
        traffic_inflow_index: int,
        active_plugs: int,
        grid_frequency_hz: float,
        load_lags_kw: List[float],
        hour: float,
        day_of_week: int,
        timestamp: Any = None,
        prev_active_plugs: int | float | None = None,
    ) -> Tuple[float, float, np.ndarray]:
        """Run inference on unscaled features. Returns (predicted_load_kw, latency_ms, raw_features)."""
        self.load()

        row_dict = {
            "ambient_temp_c": ambient_temp_c,
            "traffic_inflow_index": traffic_inflow_index,
            "active_plugs": active_plugs,
            "grid_frequency_hz": grid_frequency_hz,
            "load_lag_15m": load_lags_kw[0],
            "load_lag_30m": load_lags_kw[1],
            "load_lag_45m": load_lags_kw[2],
            "load_lag_60m": load_lags_kw[3],
            "hour": hour,
            "day_of_week": day_of_week,
        }
        if timestamp is not None:
            row_dict["timestamp"] = timestamp

        df = pd.DataFrame([row_dict])

        features_df = assemble_features_df(
            df,
            is_batch=False,
            how_table=self._how_table,
            feature_names=self._feature_names,
            prev_active_plugs=prev_active_plugs,
        )

        t0 = time.perf_counter()
        pred = self._model.predict(features_df)
        latency_ms = (time.perf_counter() - t0) * 1000.0

        raw_features = features_df.values.astype(np.float64)
        return float(pred[0]), latency_ms, raw_features

    def predict_batch(self, df: pd.DataFrame) -> Tuple[np.ndarray, float]:
        """Run inference on an entire pandas DataFrame in one vectorized call."""
        self.load()

        # Assemble features using shared logic with how_table
        features_df = assemble_features_df(
            df,
            is_batch=True,
            how_table=self._how_table,
            feature_names=self._feature_names,
        )

        t0 = time.perf_counter()
        preds = self._model.predict(features_df)
        latency_ms = (time.perf_counter() - t0) * 1000.0

        return preds, latency_ms

    def get_prediction_interval(self, predicted_load_kw: float) -> Tuple[float, float]:
        """Calculate dynamic empirical quantile bounds [lower, upper] for predicted load.

        Bins by PREDICTED load:
          - < 100 kW
          - 100 to 160 kW
          - >= 160 kW
        Falls back to single interval if 'bins' is missing.
        Lower bound is clipped to >= 0; upper bound is guaranteed >= predicted_load_kw.
        """
        self.load()
        bins = self._interval_calibration.get("bins")
        q10 = None
        q90 = None

        if bins:
            for b in bins:
                p_min = b.get("pred_min_kw")
                p_max = b.get("pred_max_kw")
                if p_min is None and p_max is not None:
                    if predicted_load_kw < p_max:
                        q10 = float(b["q10_kw"])
                        q90 = float(b["q90_kw"])
                        break
                elif p_min is not None and p_max is not None:
                    if p_min <= predicted_load_kw < p_max:
                        q10 = float(b["q10_kw"])
                        q90 = float(b["q90_kw"])
                        break
                elif p_min is not None and p_max is None:
                    if predicted_load_kw >= p_min:
                        q10 = float(b["q10_kw"])
                        q90 = float(b["q90_kw"])
                        break

        if q10 is None or q90 is None:
            q10 = float(self._interval_calibration.get("q10_kw", -20.337))
            q90 = float(self._interval_calibration.get("q90_kw", 19.801))

        lower = max(0.0, round(predicted_load_kw + q10, 1))
        upper = max(predicted_load_kw, round(predicted_load_kw + q90, 1))
        return lower, upper

    @property
    def interval_calibration(self) -> Dict[str, Any]:
        self.load()
        return self._interval_calibration

    # ── SHAP Explanation ──────────────────────────────────────

    def explain(self, raw_features: np.ndarray) -> Tuple[float, List[dict]]:
        """Compute TreeSHAP attributions for a single observation using unscaled raw features.

        Returns (base_value, list of {feature, value, shap_delta_kw}).
        """
        self.load()

        shap_values = self._explainer.shap_values(raw_features)
        base_value = float(self._explainer.expected_value)

        attributions = []
        for i, fname in enumerate(self._feature_names):
            attributions.append({
                "feature": fname,
                "value": round(float(raw_features[0, i]), 4),
                "shap_delta_kw": round(float(shap_values[0, i]), 4),
            })

        # Sort by absolute SHAP contribution (descending)
        attributions.sort(key=lambda a: abs(a["shap_delta_kw"]), reverse=True)

        return base_value, attributions

    def get_global_shap_importance(self) -> Dict[str, Any]:
        """Compute or return cached global TreeSHAP feature importances across all 17 features."""
        self.load()
        if self._global_shap_cache is not None:
            return self._global_shap_cache

        global_path = SAVED_MODELS_DIR / "global_shap_importance.joblib"
        if global_path.exists():
            cached = joblib.load(global_path)
            cached.setdefault("n_samples", cached.get("sample_size", 200))
            cached.setdefault("split_name", "test")
            cached.setdefault("total_test_rows", self.training_metrics.get("n_test", 9210))
            self._global_shap_cache = cached
            return self._global_shap_cache

        # Fallback if cache file is missing: compute from backend/tests/fixtures/v2_test_sample.csv
        fixture_path = BACKEND_DIR / "tests" / "fixtures" / "v2_test_sample.csv"
        total_test_rows = self.training_metrics.get("n_test", 9210)

        if not fixture_path.exists():
            items = [
                {"feature": fname, "mean_abs_shap_kw": 0.0, "importance_pct": round(100.0 / len(self._feature_names), 1), "rank": i + 1}
                for i, fname in enumerate(self._feature_names)
            ]
            self._global_shap_cache = {
                "total_features": len(items),
                "sample_size": 0,
                "n_samples": 0,
                "split_name": "test",
                "total_test_rows": total_test_rows,
                "feature_importances": items,
            }
            return self._global_shap_cache

        df_fixture = pd.read_csv(fixture_path)
        if "timestamp" in df_fixture.columns:
            df_fixture["timestamp"] = pd.to_datetime(df_fixture["timestamp"])
        feats_df = assemble_features_df(
            df_fixture,
            is_batch=True,
            how_table=self._how_table,
            feature_names=self._feature_names,
        )
        n_sample = min(200, len(feats_df))
        sample_df = feats_df.iloc[:n_sample]

        shap_vals = self._explainer.shap_values(sample_df)
        mean_abs = np.mean(np.abs(shap_vals), axis=0)
        total = float(np.sum(mean_abs)) if float(np.sum(mean_abs)) > 0 else 1.0

        items = []
        for i, fname in enumerate(self._feature_names):
            val = float(mean_abs[i])
            pct = round((val / total) * 100.0, 1)
            items.append({
                "feature": fname,
                "mean_abs_shap_kw": round(val, 3),
                "importance_pct": pct,
            })

        items.sort(key=lambda x: x["mean_abs_shap_kw"], reverse=True)
        for rank, item in enumerate(items, start=1):
            item["rank"] = rank

        result = {
            "total_features": len(items),
            "sample_size": n_sample,
            "n_samples": n_sample,
            "split_name": "test",
            "total_test_rows": total_test_rows,
            "feature_importances": items,
        }
        self._global_shap_cache = result
        return result

    # ── Training Metrics ──────────────────────────────────────

    @property
    def training_metrics(self) -> Dict:
        self.load()
        return self._training_metrics


# Global singleton instance
engine = MLEngine()
