"""
Empirical Quantile Interval Calibration for Candidate Model v2
==============================================================
Phase C Pipeline Script:
  1. Loads purged validation dataset (candidate_v2/val_purged.parquet)
     and test dataset (candidate_v2/test_purged.parquet).
  2. Evaluates candidate model (candidate_v2/xgb_v2.joblib) on VAL split.
  3. Fits empirical 10th and 90th percentile residuals (q10, q90) from VAL residuals ONLY.
  4. Evaluates empirical coverage on held-out TEST split:
     - Overall coverage
     - Coverage per day_type (normal, event, low)
     - Mean interval width (q90 - q10)
     - Coverage on critical surge rows (actual load >= 200 kW)
  5. Saves calibration report to candidate_v2/interval_v2.json without modifying
     backend/saved_models/.

Usage:
    python backend/pipeline/calibrate_interval_v2.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

import joblib
import numpy as np
import pandas as pd

# Directory resolution
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
CANDIDATE_V2_DIR = SCRIPT_DIR / "candidate_v2"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from pipeline.generator_v2 import CRITICAL_THRESHOLD_KW


def calibrate_candidate_interval(
    candidate_dir: Path | str | None = None,
) -> Dict[str, Any]:
    if candidate_dir is None:
        candidate_dir = CANDIDATE_V2_DIR
    else:
        candidate_dir = Path(candidate_dir)

    val_path = candidate_dir / "val_purged.parquet"
    test_path = candidate_dir / "test_purged.parquet"
    model_path = candidate_dir / "xgb_v2.joblib"
    feat_path = candidate_dir / "feature_names_v2.json"

    for p in [val_path, test_path, model_path, feat_path]:
        if not p.exists():
            raise FileNotFoundError(f"Missing required artifact: {p}. Run build_dataset_v2.py first.")

    val_df = pd.read_parquet(val_path)
    test_df = pd.read_parquet(test_path)
    model = joblib.load(model_path)
    with open(feat_path, "r") as f:
        feature_names = json.load(f)

    # 1. Fit interval on VAL residuals ONLY
    X_val = val_df[feature_names]
    y_val = val_df["target_load_2h"].to_numpy(dtype=np.float64)
    pred_val = model.predict(X_val).astype(np.float64)
    res_val = y_val - pred_val

    q10 = float(np.percentile(res_val, 10))
    q90 = float(np.percentile(res_val, 90))
    interval_width = q90 - q10

    # 2. Evaluate on held-out TEST split
    X_test = test_df[feature_names]
    y_test = test_df["target_load_2h"].to_numpy(dtype=np.float64)
    pred_test = model.predict(X_test).astype(np.float64)
    res_test = y_test - pred_test

    # Empirical test coverage: fraction of test rows where actual load falls inside [pred + q10, pred + q90]
    test_covered_mask = (res_test >= q10) & (res_test <= q90)
    cov_overall = float(test_covered_mask.mean())

    coverage_per_day_type: Dict[str, float] = {}
    for dt in ["normal", "event", "low"]:
        sub_mask = (test_df["day_type"] == dt).to_numpy()
        cov_dt = float(test_covered_mask[sub_mask].mean()) if sub_mask.sum() > 0 else 0.0
        coverage_per_day_type[dt] = round(cov_dt, 4)

    # Coverage for rows where actual >= 200 kW
    surge_mask = y_test >= CRITICAL_THRESHOLD_KW
    cov_surge = float(test_covered_mask[surge_mask].mean()) if surge_mask.sum() > 0 else 1.0

    nominal_coverage = 0.80
    diff_from_nominal = abs(cov_overall - nominal_coverage)
    within_3pct = diff_from_nominal <= 0.03

    result = {
        "model": "xgb_v2",
        "nominal_coverage": nominal_coverage,
        "calibration_split": "VAL (val_purged.parquet)",
        "q10_kw": float(round(q10, 3)),
        "q90_kw": float(round(q90, 3)),
        "mean_interval_width_kw": float(round(interval_width, 3)),
        "test_coverage_overall": float(round(cov_overall, 4)),
        "test_coverage_per_day_type": coverage_per_day_type,
        "test_coverage_surge_ge_200kw": float(round(cov_surge, 4)),
        "n_val": int(len(val_df)),
        "n_test": int(len(test_df)),
        "n_test_surges": int(surge_mask.sum()),
        "coverage_gate_passed": within_3pct,
        "calibrated_at": datetime.now(timezone.utc).isoformat(),
    }

    out_json = candidate_dir / "interval_v2.json"
    with open(out_json, "w") as f:
        json.dump(result, f, indent=2)

    print("=" * 80)
    print("  EV SURGE PREDICTOR — INTERVAL CALIBRATION REPORT (MODEL V2 CANDIDATE)")
    print("=" * 80)
    print(f"  Fitted on VAL split ({result['n_val']:,} rows):")
    print(f"    • q10 (lower bound delta) : {result['q10_kw']:+.3f} kW")
    print(f"    • q90 (upper bound delta) : {result['q90_kw']:+.3f} kW")
    print(f"    • Mean interval width     : {result['mean_interval_width_kw']:.3f} kW")
    print("\n  Evaluated on TEST split (nominal 80.0% coverage):")
    print(f"    • Overall Empirical Coverage  : {result['test_coverage_overall']*100:.2f}% (Target: 80.0% ± 3.0%) -> [{'PASS' if within_3pct else 'FAIL'}]")
    print(f"    • Normal-Day Coverage         : {result['test_coverage_per_day_type']['normal']*100:.2f}%")
    print(f"    • Event-Day Coverage          : {result['test_coverage_per_day_type']['event']*100:.2f}%")
    print(f"    • Low-Day Coverage            : {result['test_coverage_per_day_type']['low']*100:.2f}%")
    print(f"    • Critical Surge (>=200 kW)   : {result['test_coverage_surge_ge_200kw']*100:.2f}% (n={result['n_test_surges']} surge rows)")
    print(f"\n  Saved calibration result to: {out_json.name}")
    print("=" * 80 + "\n")

    return result


if __name__ == "__main__":
    calibrate_candidate_interval()
