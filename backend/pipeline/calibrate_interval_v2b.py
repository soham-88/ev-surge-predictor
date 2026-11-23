"""
Binned Empirical Quantile Interval Calibration for Candidate Model v2b
======================================================================
Phase C.3 Pipeline Script:
  1. Loads purged validation dataset (candidate_v2/val_purged.parquet)
     and test dataset (candidate_v2/test_purged.parquet).
  2. Generates predictions using candidate_v2/xgb_v2b.joblib.
  3. Bins by PREDICTED load:
     - Bin 1: pred < 100 kW
     - Bin 2: 100 <= pred < 160 kW
     - Bin 3: pred >= 160 kW
  4. Fits empirical 10th and 90th percentile residuals (q10, q90) from VAL residuals ONLY:
     residual = actual - predicted
     Interval = [pred + q10_bin, pred + q90_bin]
  5. Evaluates empirical coverage and widths on held-out TEST split for:
     a) Single unbinned symmetric interval (refit for xgb_v2b)
     b) Binned interval
     Reporting:
     - Overall coverage
     - Coverage per predicted bin (<100, 100-160, >=160 kW)
     - Coverage per day_type (normal, event, low)
     - Mean interval width overall and per bin
     - Coverage on rows with actual >= 200 kW (informational, biased by selection)
  6. Saves binned result to candidate_v2/interval_v2b.json without modifying
     existing interval_v2.json or backend/saved_models/.

Usage:
    python backend/pipeline/calibrate_interval_v2b.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

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


def assign_predicted_bins(pred: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return boolean masks for the three predicted load bins: <100, [100, 160), >=160 kW."""
    mask_b1 = pred < 100.0
    mask_b2 = (pred >= 100.0) & (pred < 160.0)
    mask_b3 = pred >= 160.0
    return mask_b1, mask_b2, mask_b3


def calibrate_binned_intervals(
    candidate_dir: Path | str | None = None,
) -> Dict[str, Any]:
    if candidate_dir is None:
        candidate_dir = CANDIDATE_V2_DIR
    else:
        candidate_dir = Path(candidate_dir)

    val_path = candidate_dir / "val_purged.parquet"
    test_path = candidate_dir / "test_purged.parquet"
    model_path = candidate_dir / "xgb_v2b.joblib"
    feat_path = candidate_dir / "feature_names_v2b.json"

    for p in [val_path, test_path, model_path, feat_path]:
        if not p.exists():
            raise FileNotFoundError(f"Missing required artifact: {p}.")

    val_df = pd.read_parquet(val_path)
    test_df = pd.read_parquet(test_path)
    model = joblib.load(model_path)
    with open(feat_path, "r") as f:
        feature_names = json.load(f)

    print("=" * 80)
    print("  BINNED EMPIRICAL QUANTILE INTERVAL CALIBRATION FOR XGBOOST V2B")
    print(f"  Candidate Dir: {candidate_dir}")
    print("=" * 80)

    # 1. Fit intervals on VAL residuals ONLY
    X_val = val_df[feature_names]
    y_val = val_df["target_load_2h"].to_numpy(dtype=np.float64)
    pred_val = model.predict(X_val).astype(np.float64)
    res_val = y_val - pred_val

    # Single overall interval on VAL
    q10_single = float(np.percentile(res_val, 10))
    q90_single = float(np.percentile(res_val, 90))
    width_single = q90_single - q10_single

    # Binned intervals on VAL
    b1_val, b2_val, b3_val = assign_predicted_bins(pred_val)

    q10_b1, q90_b1 = float(np.percentile(res_val[b1_val], 10)), float(np.percentile(res_val[b1_val], 90))
    q10_b2, q90_b2 = float(np.percentile(res_val[b2_val], 10)), float(np.percentile(res_val[b2_val], 90))
    q10_b3, q90_b3 = float(np.percentile(res_val[b3_val], 10)), float(np.percentile(res_val[b3_val], 90))

    width_b1 = q90_b1 - q10_b1
    width_b2 = q90_b2 - q10_b2
    width_b3 = q90_b3 - q10_b3

    print(f"\n[1/3] Fitted Quantiles on Validation Set (n={len(val_df):,} rows):")
    print(f"  • Single Overall Interval : q10 = {q10_single:+7.3f} kW, q90 = {q90_single:+7.3f} kW (Width: {width_single:6.3f} kW)")
    print(f"  • Bin 1 (pred < 100 kW)   : q10 = {q10_b1:+7.3f} kW, q90 = {q90_b1:+7.3f} kW (Width: {width_b1:6.3f} kW, n={b1_val.sum():,})")
    print(f"  • Bin 2 (100 <= pred <160): q10 = {q10_b2:+7.3f} kW, q90 = {q90_b2:+7.3f} kW (Width: {width_b2:6.3f} kW, n={b2_val.sum():,})")
    print(f"  • Bin 3 (pred >= 160 kW)  : q10 = {q10_b3:+7.3f} kW, q90 = {q90_b3:+7.3f} kW (Width: {width_b3:6.3f} kW, n={b3_val.sum():,})")

    # 2. Evaluate on held-out TEST split
    X_test = test_df[feature_names]
    y_test = test_df["target_load_2h"].to_numpy(dtype=np.float64)
    pred_test = model.predict(X_test).astype(np.float64)
    res_test = y_test - pred_test

    b1_test, b2_test, b3_test = assign_predicted_bins(pred_test)

    # Single interval test coverage
    test_cov_single_mask = (res_test >= q10_single) & (res_test <= q90_single)
    single_cov_overall = float(test_cov_single_mask.mean())

    # Binned interval test coverage
    test_cov_binned_mask = np.zeros(len(test_df), dtype=bool)
    test_cov_binned_mask[b1_test] = (res_test[b1_test] >= q10_b1) & (res_test[b1_test] <= q90_b1)
    test_cov_binned_mask[b2_test] = (res_test[b2_test] >= q10_b2) & (res_test[b2_test] <= q90_b2)
    test_cov_binned_mask[b3_test] = (res_test[b3_test] >= q10_b3) & (res_test[b3_test] <= q90_b3)

    binned_cov_overall = float(test_cov_binned_mask.mean())
    binned_cov_b1 = float(test_cov_binned_mask[b1_test].mean())
    binned_cov_b2 = float(test_cov_binned_mask[b2_test].mean())
    binned_cov_b3 = float(test_cov_binned_mask[b3_test].mean())

    # Single coverage by predicted bin
    single_cov_b1 = float(test_cov_single_mask[b1_test].mean())
    single_cov_b2 = float(test_cov_single_mask[b2_test].mean())
    single_cov_b3 = float(test_cov_single_mask[b3_test].mean())

    # Coverage by day_type
    day_types = ["normal", "event", "low"]
    single_cov_daytype = {}
    binned_cov_daytype = {}
    for dt in day_types:
        dt_mask = (test_df["day_type"] == dt).to_numpy()
        single_cov_daytype[dt] = float(test_cov_single_mask[dt_mask].mean()) if dt_mask.sum() > 0 else 0.0
        binned_cov_daytype[dt] = float(test_cov_binned_mask[dt_mask].mean()) if dt_mask.sum() > 0 else 0.0

    # Mean interval width overall on test
    # For single: constant width_single everywhere
    # For binned: weighted average width across test set
    test_widths_binned = np.zeros(len(test_df), dtype=np.float64)
    test_widths_binned[b1_test] = width_b1
    test_widths_binned[b2_test] = width_b2
    test_widths_binned[b3_test] = width_b3
    mean_width_binned_overall = float(test_widths_binned.mean())

    # Critical surge rows (actual load >= 200 kW)
    surge_mask = y_test >= CRITICAL_THRESHOLD_KW
    single_cov_surge = float(test_cov_single_mask[surge_mask].mean())
    binned_cov_surge = float(test_cov_binned_mask[surge_mask].mean())

    print("\n" + "=" * 80)
    print("  [2/3] HELD-OUT TEST EVALUATION COMPARISON (SINGLE VS BINNED INTERVALS)")
    print("=" * 80)
    print(f"{'Metric':<32} | {'Single Symmetric':>18} | {'Binned Interval':>18} | {'Nominal Target':>15}")
    print("-" * 90)
    print(f"{'Overall Test Coverage':<32} | {single_cov_overall*100:17.2f}% | {binned_cov_overall*100:17.2f}% | {'80.00%':>15}")
    print(f"{'Coverage: pred < 100 kW':<32} | {single_cov_b1*100:17.2f}% | {binned_cov_b1*100:17.2f}% | {'80.00%':>15}")
    print(f"{'Coverage: 100 <= pred < 160 kW':<32} | {single_cov_b2*100:17.2f}% | {binned_cov_b2*100:17.2f}% | {'80.00%':>15}")
    print(f"{'Coverage: pred >= 160 kW':<32} | {single_cov_b3*100:17.2f}% | {binned_cov_b3*100:17.2f}% | {'80.00%':>15}")
    print("-" * 90)
    print(f"{'Coverage: Normal Days':<32} | {single_cov_daytype['normal']*100:17.2f}% | {binned_cov_daytype['normal']*100:17.2f}% | {'80.00%':>15}")
    print(f"{'Coverage: Event Days':<32} | {single_cov_daytype['event']*100:17.2f}% | {binned_cov_daytype['event']*100:17.2f}% | {'80.00%':>15}")
    print(f"{'Coverage: Low-Demand Days':<32} | {single_cov_daytype['low']*100:17.2f}% | {binned_cov_daytype['low']*100:17.2f}% | {'80.00%':>15}")
    print("-" * 90)
    print(f"{'Mean Width: Overall':<32} | {width_single:15.2f} kW | {mean_width_binned_overall:15.2f} kW | {'N/A':>15}")
    print(f"{'Width: pred < 100 kW':<32} | {width_single:15.2f} kW | {width_b1:15.2f} kW | {'N/A':>15}")
    print(f"{'Width: 100 <= pred < 160 kW':<32} | {width_single:15.2f} kW | {width_b2:15.2f} kW | {'N/A':>15}")
    print(f"{'Width: pred >= 160 kW':<32} | {width_single:15.2f} kW | {width_b3:15.2f} kW | {'N/A':>15}")
    print("-" * 90)
    print(f"{'Coverage: Actual >= 200 kW*':<32} | {single_cov_surge*100:17.2f}% | {binned_cov_surge*100:17.2f}% | {'Informational*':>15}")
    print("  * Note: Coverage on actual >= 200 kW is conditioned on the outcome, hence selection-biased.")
    print("=" * 80)

    # 3. Gate verification
    gate_overall_pass = abs(binned_cov_overall - 0.80) <= 0.03
    gate_b1_pass = abs(binned_cov_b1 - 0.80) <= 0.04
    gate_b2_pass = abs(binned_cov_b2 - 0.80) <= 0.04
    gate_b3_pass = abs(binned_cov_b3 - 0.80) <= 0.04
    all_binned_gates_pass = gate_overall_pass and gate_b1_pass and gate_b2_pass and gate_b3_pass

    print("\n" + "=" * 80)
    print("  [3/3] BINNED INTERVAL CALIBRATION GATE BLOCK")
    print("=" * 80)
    print(f"  • Overall Test Coverage (within +-3 pp of 80% [77%, 83%]) : "
          f"{binned_cov_overall*100:.2f}% ({binned_cov_overall*100 - 80:+.2f} pp) -> [{'PASS' if gate_overall_pass else 'FAIL'}]")
    print(f"  • Bin 1 (<100 kW) Coverage (within +-4 pp [76%, 84%])      : "
          f"{binned_cov_b1*100:.2f}% ({binned_cov_b1*100 - 80:+.2f} pp) -> [{'PASS' if gate_b1_pass else 'FAIL'}]")
    print(f"  • Bin 2 (100-160 kW) Coverage (within +-4 pp [76%, 84%])   : "
          f"{binned_cov_b2*100:.2f}% ({binned_cov_b2*100 - 80:+.2f} pp) -> [{'PASS' if gate_b2_pass else 'FAIL'}]")
    print(f"  • Bin 3 (>=160 kW) Coverage (within +-4 pp [76%, 84%])     : "
          f"{binned_cov_b3*100:.2f}% ({binned_cov_b3*100 - 80:+.2f} pp) -> [{'PASS' if gate_b3_pass else 'FAIL'}]")
    print("-" * 80)
    print(f"  BINNED INTERVAL GATE STATUS: [{'PASS' if all_binned_gates_pass else 'FAIL'}]")
    print("=" * 80 + "\n")

    # 4. Save to candidate_v2/interval_v2b.json
    output_dict = {
        "candidate_model": "xgb_v2b.joblib",
        "feature_names_file": "feature_names_v2b.json",
        "calibration_timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "nominal_coverage": 0.80,
        "single_interval": {
            "q10_kw": round(q10_single, 4),
            "q90_kw": round(q90_single, 4),
            "width_kw": round(width_single, 4),
            "test_coverage_overall": round(single_cov_overall, 4),
            "test_coverage_by_bin": {
                "<100": round(single_cov_b1, 4),
                "100-160": round(single_cov_b2, 4),
                ">=160": round(single_cov_b3, 4),
            },
            "test_coverage_by_day_type": single_cov_daytype,
            "test_coverage_actual_ge_200": round(single_cov_surge, 4),
        },
        "binned_interval": {
            "bins": [
                {
                    "name": "<100",
                    "pred_min_kw": None,
                    "pred_max_kw": 100.0,
                    "q10_kw": round(q10_b1, 4),
                    "q90_kw": round(q90_b1, 4),
                    "width_kw": round(width_b1, 4),
                    "val_count": int(b1_val.sum()),
                    "test_count": int(b1_test.sum()),
                    "test_coverage": round(binned_cov_b1, 4),
                },
                {
                    "name": "100-160",
                    "pred_min_kw": 100.0,
                    "pred_max_kw": 160.0,
                    "q10_kw": round(q10_b2, 4),
                    "q90_kw": round(q90_b2, 4),
                    "width_kw": round(width_b2, 4),
                    "val_count": int(b2_val.sum()),
                    "test_count": int(b2_test.sum()),
                    "test_coverage": round(binned_cov_b2, 4),
                },
                {
                    "name": ">=160",
                    "pred_min_kw": 160.0,
                    "pred_max_kw": None,
                    "q10_kw": round(q10_b3, 4),
                    "q90_kw": round(q90_b3, 4),
                    "width_kw": round(width_b3, 4),
                    "val_count": int(b3_val.sum()),
                    "test_count": int(b3_test.sum()),
                    "test_coverage": round(binned_cov_b3, 4),
                },
            ],
            "test_coverage_overall": round(binned_cov_overall, 4),
            "mean_test_width_overall": round(mean_width_binned_overall, 4),
            "test_coverage_by_day_type": binned_cov_daytype,
            "test_coverage_actual_ge_200": round(binned_cov_surge, 4),
        },
        "gate_block": {
            "gate_overall_pass": gate_overall_pass,
            "gate_b1_pass": gate_b1_pass,
            "gate_b2_pass": gate_b2_pass,
            "gate_b3_pass": gate_b3_pass,
            "all_gates_pass": all_binned_gates_pass,
        },
    }

    out_file = candidate_dir / "interval_v2b.json"
    with open(out_file, "w") as f:
        json.dump(output_dict, f, indent=2)

    print(f"  • Successfully saved binned calibration artifact to: {out_file.name}\n")
    return output_dict


if __name__ == "__main__":
    calibrate_binned_intervals()
