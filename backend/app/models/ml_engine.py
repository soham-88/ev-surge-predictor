"""
ML Inference Engine — loads saved .joblib artifacts and provides
prediction + SHAP explanation methods for the FastAPI endpoints.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd

from app.core.config import SAVED_MODELS_DIR


class MLEngine:
    """Singleton-style ML engine that lazily loads model artifacts."""

    def __init__(self) -> None:
        self._model = None
        self._scaler = None
        self._explainer = None
        self._feature_names: List[str] = []
        self._training_metrics: Dict = {}
        self._loaded = False

    def load(self) -> None:
        """Load all .joblib artifacts from disk."""
        if self._loaded:
            return

        model_path = SAVED_MODELS_DIR / "xgboost_model.joblib"
        if not model_path.exists():
            raise FileNotFoundError(
                f"Model artifacts not found at {SAVED_MODELS_DIR}. "
                "Run `python -m backend.pipeline.train` first."
            )

        self._model = joblib.load(SAVED_MODELS_DIR / "xgboost_model.joblib")
        self._scaler = joblib.load(SAVED_MODELS_DIR / "scaler.joblib")
        shap_path = SAVED_MODELS_DIR / "shap_explainer.joblib"
        if shap_path.exists():
            self._explainer = joblib.load(shap_path)
        else:
            import shap
            self._explainer = shap.TreeExplainer(self._model)
        self._feature_names = joblib.load(SAVED_MODELS_DIR / "feature_names.joblib")
        self._training_metrics = joblib.load(SAVED_MODELS_DIR / "training_metrics.joblib")
        self._loaded = True

    # ── Feature Assembly ──────────────────────────────────────

    def _assemble_features_df(
        self, df: pd.DataFrame, is_batch: bool = False
    ) -> pd.DataFrame:
        """Build the 15-element feature dataframe matching train.py FEATURE_COLUMNS.
        
        Shared logic for both single-row (live) and multi-row (batch) predictions.
        Where paths diverge (e.g. plug_delta_15m needing consecutive rows for diff),
        it branches explicitly on `is_batch`.
        """
        # 1. Cyclical time encoding
        if 'timestamp' in df.columns:
            timestamps = pd.to_datetime(df['timestamp'])
            hour = timestamps.dt.hour + timestamps.dt.minute / 60.0
            day_of_week = timestamps.dt.dayofweek
        else:
            hour = df['hour']
            day_of_week = df['day_of_week']

        hour_sin = np.sin(2 * np.pi * hour / 24)
        hour_cos = np.cos(2 * np.pi * hour / 24)
        day_sin = np.sin(2 * np.pi * day_of_week / 7)
        day_cos = np.cos(2 * np.pi * day_of_week / 7)

        # 2. Rolling features
        lags_df = df[['load_lag_15m', 'load_lag_30m', 'load_lag_45m', 'load_lag_60m']]
        rolling_mean_60m = lags_df.mean(axis=1)
        # Using ddof=1 to match pandas default in train.py. If a single row, 
        # lags_df.std(axis=1) across the 4 lag columns still works correctly.
        rolling_std_60m = lags_df.std(axis=1, ddof=1)

        # 3. Plug delta
        if is_batch:
            # Batch has consecutive rows, so we can diff exactly
            plug_delta_15m = df["active_plugs"].diff(1).fillna(0)
        else:
            # Single-row live prediction lacks history, use heuristic
            plug_delta_15m = (df["active_plugs"] - 4).clip(lower=0)

        # 4. Assemble in exact order
        features_df = pd.DataFrame({
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
        })
        
        return features_df[self._feature_names]

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
    ) -> Tuple[float, float, np.ndarray]:
        """Run inference. Returns (predicted_load_kw, latency_ms, scaled_features)."""
        self.load()

        df = pd.DataFrame([{
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
        }])
        
        features_df = self._assemble_features_df(df, is_batch=False)
        scaled = self._scaler.transform(features_df)

        t0 = time.perf_counter()
        pred = self._model.predict(scaled)
        latency_ms = (time.perf_counter() - t0) * 1000

        return float(pred[0]), latency_ms, scaled

    def predict_batch(self, df: pd.DataFrame) -> Tuple[np.ndarray, float]:
        """Run inference on an entire pandas DataFrame in one vectorized call.
        
        Assumes df already contains all required feature columns in exact order
        or can be assembled into the correct shape.
        """
        self.load()

        # Assemble features using shared logic
        features_df = self._assemble_features_df(df, is_batch=True)
        
        # Scale
        scaled = self._scaler.transform(features_df)
        
        # Predict
        t0 = time.perf_counter()
        preds = self._model.predict(scaled)
        latency_ms = (time.perf_counter() - t0) * 1000
        
        return preds, latency_ms

    # ── SHAP Explanation ──────────────────────────────────────

    def explain(self, scaled_features: np.ndarray) -> Tuple[float, List[dict]]:
        """Compute TreeSHAP attributions for a single observation.

        Returns (base_value, list of {feature, value, shap_delta_kw}).
        """
        self.load()

        shap_values = self._explainer.shap_values(scaled_features)
        base_value = float(self._explainer.expected_value)

        attributions = []
        for i, fname in enumerate(self._feature_names):
            attributions.append({
                "feature": fname,
                "value": round(float(scaled_features[0, i]), 4),
                "shap_delta_kw": round(float(shap_values[0, i]), 4),
            })

        # Sort by absolute SHAP contribution (descending)
        attributions.sort(key=lambda a: abs(a["shap_delta_kw"]), reverse=True)

        return base_value, attributions

    # ── Training Metrics ──────────────────────────────────────

    @property
    def training_metrics(self) -> Dict:
        self.load()
        return self._training_metrics


# Global singleton instance
engine = MLEngine()
