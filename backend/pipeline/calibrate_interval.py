"""Calibrate empirical quantile prediction interval for the deployed XGBoost model.

Evaluates the saved XGBoost model on the standard test split (seed=42, 90 days, 80/20 split),
calculates residuals (actual - predicted), and computes the empirical 10th and 90th percentiles
(q10, q90), empirical test coverage, and sample count.
Saves the result to backend/saved_models/interval_calibration.joblib without modifying existing model artifacts.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
import joblib
import numpy as np

from backend.pipeline.train import (
    FEATURE_COLUMNS,
    TARGET_COLUMN,
    engineer_features,
    synthesize_telemetry,
)


def calibrate_interval(
    saved_models_dir: Path | str | None = None,
) -> dict[str, float | int | str]:
    if saved_models_dir is None:
        saved_models_dir = Path(
            os.environ.get(
                "SAVED_MODELS_DIR",
                Path(__file__).resolve().parent.parent / "saved_models",
            )
        )
    else:
        saved_models_dir = Path(saved_models_dir)

    model_path = saved_models_dir / "xgboost_model.joblib"
    scaler_path = saved_models_dir / "scaler.joblib"
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found at {model_path}")
    if not scaler_path.exists():
        raise FileNotFoundError(f"Scaler not found at {scaler_path}")

    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path)

    # Standard synthetic test split: seed=42, 90 days, 80/20 temporal split
    df = synthesize_telemetry(n_days=90, seed=42)
    df = engineer_features(df)

    split_idx = int(len(df) * 0.8)
    test_df = df.iloc[split_idx:].copy()

    X_test = test_df[FEATURE_COLUMNS]
    y_test = test_df[TARGET_COLUMN].values

    X_test_scaled = scaler.transform(X_test)
    y_pred = model.predict(X_test_scaled)

    # Residuals: actual - predicted
    residuals = y_test - y_pred

    q10 = float(np.percentile(residuals, 10))
    q90 = float(np.percentile(residuals, 90))

    # Empirical coverage on test set: fraction of actual values falling in [y_pred + q10, y_pred + q90]
    # which is equivalent to residuals between q10 and q90
    covered = ((residuals >= q10) & (residuals <= q90)).mean()

    result = {
        "q10_kw": float(round(q10, 3)),
        "q90_kw": float(round(q90, 3)),
        "coverage": float(round(float(covered), 4)),
        "n_test": int(len(residuals)),
        "calibrated_at": datetime.now(timezone.utc).isoformat(),
    }

    out_path = saved_models_dir / "interval_calibration.joblib"
    joblib.dump(result, out_path)
    print(f"Calibration saved to {out_path}:")
    print(f"  q10 (lower residual): {result['q10_kw']} kW")
    print(f"  q90 (upper residual): {result['q90_kw']} kW")
    print(f"  Test coverage: {result['coverage'] * 100:.2f}% (n={result['n_test']})")

    return result


if __name__ == "__main__":
    calibrate_interval()

