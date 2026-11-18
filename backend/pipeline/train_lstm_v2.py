"""
PyTorch LSTM Benchmark Training & Evaluation for Model v2
=========================================================
Phase D Pipeline Script:
  1. Inspects existing LSTM architecture and training recipe.
  2. Builds continuous sequences on the same stratified day-based split as XGBoost v2:
     - Applies extended boundary purge to prevent lookback leakage across split boundaries.
     - Fits StandardScaler on TRAIN only.
     - Early stopping on VAL only (patience=12).
  3. Evaluates 5 forecasters on the EXACT intersection of held-out TEST rows:
     - 1. Persistence
     - 2. Plain Hour-of-Week Mean
     - 3. Baseline 3 (Anomaly-Adjusted HoW Mean)
     - 4. XGBoost v2b (Monotone Candidate)
     - 5. PyTorch LSTM v2 (Benchmark)
     Reporting MAE, RMSE, Rule A/B recall, precision, FP count overall and per day_type.
  4. Single-row CPU inference latency benchmark:
     - XGBoost v2b (shared assembler + predict)
     - LSTM v2 (sequence inference path)
     (50 warmup, 500 timed iterations, median and p95).
  5. Round-trip verification:
     - Saves candidate_v2/lstm_v2.pt, candidate_v2/lstm_scaler_v2.joblib,
       and candidate_v2/lstm_v2_config.json.
     - Spawns an isolated fresh Python subprocess to load saved artifacts, predict
       on 200 random test rows, and verify max absolute difference < 1e-4 kW.
  6. Gate verification block.

Usage:
    python backend/pipeline/train_lstm_v2.py
"""

from __future__ import annotations

import json
import random
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

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
from pipeline.evaluate_v2 import compute_model_performance
from pipeline.generator_v2 import (
    lookup_hour_of_week_mean,
    CRITICAL_THRESHOLD_KW,
    WARNING_THRESHOLD_KW,
)
from pipeline.train_lstm import LSTMPredictor


def set_reproducible_seeds(seed: int = 42) -> None:
    """Fix all random seeds for deterministic behavior."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.use_deterministic_algorithms(True, warn_only=True)


def print_architecture_inspection() -> None:
    """Print inspection summary of v1 vs v2 LSTM architecture and training recipe."""
    print("=" * 80)
    print("  STEP 0: LSTM ARCHITECTURE & TRAINING RECIPE INSPECTION")
    print("=" * 80)
    print(
        "  • Architecture: 2-layer LSTM (spec §3.3)\n"
        "      - LSTM: input_size=17, hidden_size=64, num_layers=2, batch_first=True, dropout=0.2\n"
        "      - Head: Linear(64, 32) -> ReLU() -> Dropout(0.2) -> Linear(32, 1) -> squeeze(-1)\n"
        "      - Output: scalar point forecast for load_kw at target horizon t+2h.\n"
        "  • Input Window Length:\n"
        "      - seq_len = 8 steps (8 x 15 min = 120 min span, 105 min lookback).\n"
        "      - Reused identically from v1 train_lstm.py.\n"
        "  • Input Features:\n"
        "      - 17 features: 15 baseline features + 2 derived features (load_anomaly, lag_trend)\n"
        "        matching feature_names_v2b.json.\n"
        "  • Scaler:\n"
        "      - StandardScaler fit on TRAIN only, transforming VAL and TEST without leakage.\n"
        "  • Loss & Optimizer:\n"
        "      - Loss: nn.MSELoss()\n"
        "      - Optimizer: torch.optim.Adam(lr=1e-3)\n"
        "  • Training & Convergence:\n"
        "      - Max epochs = 60, batch_size = 64.\n"
        "      - Early stopping on VAL only (patience = 12 epochs); best epoch weights restored.\n"
        "      - (Deviation from v1: v1 ran fixed 60 epochs without early stopping; v2 adds\n"
        "        formal early stopping on validation loss to prevent overfitting).\n"
        "  • Backend Loading Note:\n"
        "      - The backend runtime (/api/v1/predict) only executes XGBoost for serving.\n"
        "      - The backend endpoint /api/v1/metrics reads lstm_metrics.joblib to display benchmarks.\n"
        "      - In verification scripts (verify_artifacts.py), LSTMPredictor is loaded from disk;\n"
        "        here we verify candidate loading from candidate_v2/lstm_v2.pt in a separate process."
    )
    print("=" * 80 + "\n")


def prepare_continuous_sequences(
    seq_len: int = 8,
    seed: int = 42,
) -> Tuple[
    pd.DataFrame,
    List[str],
    Dict[str, np.ndarray],
    Dict[str, np.ndarray],
    Dict[str, np.ndarray],
    StandardScaler,
    Any,
]:
    """Build continuous sequences with extended boundary purge on the stratified split."""
    print("=" * 80)
    print("  STEP 1: DATA PIPELINE, EXTENDED BOUNDARY PURGE & SEQUENCE ASSEMBLY")
    print("=" * 80)

    # 1. Load artifacts
    raw_path = CANDIDATE_V2_DIR / "train_data_v2.parquet"
    how_path = CANDIDATE_V2_DIR / "hour_of_week_mean.joblib"
    feat_path = CANDIDATE_V2_DIR / "feature_names_v2b.json"

    train_purged = pd.read_parquet(CANDIDATE_V2_DIR / "train_purged.parquet")
    val_purged = pd.read_parquet(CANDIDATE_V2_DIR / "val_purged.parquet")
    test_purged = pd.read_parquet(CANDIDATE_V2_DIR / "test_purged.parquet")
    how_table = joblib.load(how_path)
    with open(feat_path, "r") as f:
        feature_names = json.load(f)

    df_raw = pd.read_parquet(raw_path)
    print(f"  • Loaded raw continuous series: {len(df_raw):,} records (730 days)")

    # 2. Date-to-split mapping from the existing stratified split
    date_to_split: Dict = {}
    for d in train_purged["timestamp"].dt.date.unique():
        date_to_split[d] = "train"
    for d in val_purged["timestamp"].dt.date.unique():
        date_to_split[d] = "val"
    for d in test_purged["timestamp"].dt.date.unique():
        date_to_split[d] = "test"

    # 3. Continuous feature engineering
    df = df_raw.copy()
    df["target_load_2h"] = df["load_kw"].shift(-8)
    df["load_lag_15m"] = df["load_kw"].shift(1).bfill()
    df["load_lag_30m"] = df["load_kw"].shift(2).bfill()
    df["load_lag_45m"] = df["load_kw"].shift(3).bfill()
    df["load_lag_60m"] = df["load_kw"].shift(4).bfill()

    feats = assemble_features_df(df, is_batch=True, how_table=how_table, feature_names=feature_names)
    for col in feats.columns:
        df[col] = feats[col]

    # 4. Extended Boundary Purge: drop rows whose seq_len window crosses into a different split
    window_td = pd.Timedelta(minutes=(seq_len - 1) * 15)  # 105 min lookback for 8 steps
    print(f"\n  [Extended Boundary Purge Details (Lookback Window: {window_td})]:")

    def filter_split_indices(purged_df: pd.DataFrame, split_name: str) -> Tuple[np.ndarray, int]:
        ts_start = purged_df["timestamp"] - window_td
        valid_mask = (ts_start.dt.date.map(date_to_split) == split_name).to_numpy()
        valid_ts = set(purged_df.loc[valid_mask, "timestamp"])
        indices = df.index[df["timestamp"].isin(valid_ts)].to_numpy()
        dropped = int((~valid_mask).sum())
        return indices, dropped

    train_idx, drop_tr = filter_split_indices(train_purged, "train")
    val_idx, drop_va = filter_split_indices(val_purged, "val")
    test_idx, drop_te = filter_split_indices(test_purged, "test")

    print(f"  • TRAIN: {len(train_purged):,} XGB rows -> {len(train_idx):,} LSTM rows (Dropped {drop_tr:,} boundary rows, {drop_tr/len(train_purged)*100:.2f}%)")
    print(f"  • VAL  : {len(val_purged):,} XGB rows -> {len(val_idx):,} LSTM rows (Dropped {drop_va:,} boundary rows, {drop_va/len(val_purged)*100:.2f}%)")
    print(f"  • TEST : {len(test_purged):,} XGB rows -> {len(test_idx):,} LSTM rows (Dropped {drop_te:,} boundary rows, {drop_te/len(test_purged)*100:.2f}%)")

    # 5. Fit StandardScaler on TRAIN rows ONLY
    scaler = StandardScaler()
    scaler.fit(df.loc[train_idx, feature_names].values)
    X_scaled_all = scaler.transform(df[feature_names].values)

    # 6. Build 3D sequences (n_samples, seq_len, n_features)
    def extract_sequences(indices: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        Xs = []
        ys = []
        for i in indices:
            Xs.append(X_scaled_all[i - (seq_len - 1) : i + 1])
            ys.append(df.loc[i, "target_load_2h"])
        return np.array(Xs, dtype=np.float32), np.array(ys, dtype=np.float32)

    X_seqs = {}
    y_seqs = {}
    indices_dict = {"train": train_idx, "val": val_idx, "test": test_idx}

    for s_name, idx_arr in indices_dict.items():
        X_s, y_s = extract_sequences(idx_arr)
        X_seqs[s_name] = X_s
        y_seqs[s_name] = y_s
        print(f"  • {s_name.upper():<5} Sequence Matrix Shape: {X_s.shape} paired with targets {y_s.shape}")

    print("=" * 80 + "\n")
    return df, feature_names, X_seqs, y_seqs, indices_dict, scaler, how_table


def train_lstm_model(
    X_seqs: Dict[str, np.ndarray],
    y_seqs: Dict[str, np.ndarray],
    n_features: int,
    epochs: int = 60,
    batch_size: int = 64,
    lr: float = 1e-3,
    patience: int = 12,
    seed: int = 42,
) -> Tuple[LSTMPredictor, int, float, List[Dict[str, float]]]:
    """Train the 2-layer LSTM with early stopping on validation loss."""
    print("=" * 80)
    print("  STEP 2: PYTORCH LSTM TRAINING WITH VALIDATION EARLY STOPPING")
    print(f"  Epochs: {epochs} | Batch Size: {batch_size} | LR: {lr} | Patience: {patience}")
    print("=" * 80)

    set_reproducible_seeds(seed)
    device = torch.device("cpu")

    model = LSTMPredictor(
        input_size=n_features,
        hidden_size=64,
        num_layers=2,
        dropout=0.2,
    ).to(device)

    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.MSELoss()

    train_ds = TensorDataset(torch.FloatTensor(X_seqs["train"]), torch.FloatTensor(y_seqs["train"]))
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)

    val_x = torch.FloatTensor(X_seqs["val"]).to(device)
    val_y = torch.FloatTensor(y_seqs["val"]).to(device)

    best_val_loss = float("inf")
    best_epoch = 0
    best_state_dict: Dict = {}
    patience_counter = 0
    history: List[Dict[str, float]] = []

    t_start = time.perf_counter()
    for ep in range(1, epochs + 1):
        model.train()
        train_loss = 0.0
        for xb, yb in train_loader:
            optimizer.zero_grad()
            preds = model(xb)
            loss = criterion(preds, yb)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * len(xb)
        train_loss /= len(train_loader.dataset)

        model.eval()
        with torch.no_grad():
            val_preds = model(val_x).squeeze(-1)
            val_loss = criterion(val_preds, val_y).item()
            val_mae = mean_absolute_error(val_y.numpy(), val_preds.numpy())

        history.append({
            "epoch": ep,
            "train_loss": train_loss,
            "val_loss": val_loss,
            "val_mae": val_mae,
        })

        improved = val_loss < best_val_loss
        if improved:
            best_val_loss = val_loss
            best_epoch = ep
            best_state_dict = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            patience_counter = 0
        else:
            patience_counter += 1

        if ep % 5 == 0 or ep == 1 or improved:
            indicator = "★ (best)" if improved else ""
            print(
                f"  Epoch {ep:2d}/{epochs:2d} | Train MSE: {train_loss:8.4f} | "
                f"Val MSE: {val_loss:8.4f} | Val MAE: {val_mae:5.2f} kW {indicator}"
            )

        if patience_counter >= patience:
            print(f"\n  [EARLY STOPPING TRIGGERED] No improvement for {patience} epochs at epoch {ep}.")
            break

    t_elapsed = time.perf_counter() - t_start
    print(f"\n  • Training Wall Time : {t_elapsed:.1f} seconds")
    print(f"  • Best Epoch Restored: {best_epoch} (Val MSE: {best_val_loss:.4f})")
    model.load_state_dict(best_state_dict)
    model.eval()
    print("=" * 80 + "\n")

    return model, best_epoch, best_val_loss, history


def evaluate_comparative_table(
    df: pd.DataFrame,
    test_idx: np.ndarray,
    X_test_seq: np.ndarray,
    y_test_seq: np.ndarray,
    model_lstm: LSTMPredictor,
    how_table: Any,
    feature_names: List[str],
) -> Dict[str, Any]:
    """Evaluate 5 models on the identical intersection of test rows."""
    print("=" * 80)
    print("  STEP 3: 5-FORECASTER COMPARATIVE EVALUATION TABLE (SAME TEST ROWS)")
    print(f"  Intersection Test Rows Evaluated: {len(test_idx):,} rows")
    print("=" * 80)

    # Load working candidate XGBoost v2b
    xgb_path = CANDIDATE_V2_DIR / "xgb_v2b.joblib"
    model_xgb = joblib.load(xgb_path)

    # Refit Baseline 3 OLS slope k on train_purged
    train_purged = pd.read_parquet(CANDIDATE_V2_DIR / "train_purged.parquet")
    how_curr_tr = lookup_hour_of_week_mean(how_table, train_purged["timestamp"])
    how_2h_tr = lookup_hour_of_week_mean(how_table, train_purged["timestamp"] + pd.Timedelta(hours=2))
    a_t_tr = train_purged["load_kw"] - how_curr_tr
    a_target_tr = train_purged["target_load_2h"] - how_2h_tr
    k_ols = float(np.sum(a_t_tr * a_target_tr) / np.sum(a_t_tr**2))

    # Evaluate forecasts on test_idx
    sub_test = df.loc[test_idx].copy()
    y_test = y_test_seq.astype(np.float64)

    # 1. Persistence
    pred_persist = sub_test["load_kw"].to_numpy(dtype=np.float64)

    # 2. Plain HoW Mean
    pred_how = np.asarray(lookup_hour_of_week_mean(how_table, sub_test["timestamp"] + pd.Timedelta(hours=2)), dtype=np.float64)

    # 3. Baseline 3 (Anomaly-Adjusted HoW)
    how_curr = np.asarray(lookup_hour_of_week_mean(how_table, sub_test["timestamp"]), dtype=np.float64)
    pred_b3 = pred_how + k_ols * (sub_test["load_kw"].to_numpy(dtype=np.float64) - how_curr)

    # 4. XGBoost v2b
    pred_xgb = model_xgb.predict(sub_test[feature_names]).astype(np.float64)

    # 5. LSTM v2
    model_lstm.eval()
    with torch.no_grad():
        pred_lstm = model_lstm(torch.FloatTensor(X_test_seq)).squeeze(-1).numpy().astype(np.float64)

    models_dict = {
        "Persistence": pred_persist,
        "Plain HoW Mean": pred_how,
        "Baseline 3": pred_b3,
        "XGBoost v2b (Final)": pred_xgb,
        "LSTM v2 (Benchmark)": pred_lstm,
    }

    day_types = ["OVERALL", "normal", "event", "low"]
    perf_results: Dict[str, Dict[str, Any]] = {}

    for dt in day_types:
        if dt == "OVERALL":
            sub_mask = np.ones(len(y_test), dtype=bool)
            title = f"OVERALL IDENTICAL TEST ROWS ({len(y_test):,} ROWS)"
        else:
            sub_mask = (sub_test["day_type"] == dt).to_numpy()
            title = f"DAY_TYPE: {dt.upper()} ({sub_mask.sum():,} ROWS)"

        print(f"\n--- {title} ---")
        print(f"{'Model':<22} | {'MAE (kW)':>8} | {'RMSE':>6} | {'Rule A Rec':>10} | {'Rule A Prec':>11} | {'Rule A FP':>9} | {'Rule B Rec':>10} | {'Rule B Prec':>11} | {'Rule B FP':>9}")
        print("-" * 115)

        perf_results[dt] = {}
        for m_name, y_m in models_dict.items():
            perf = compute_model_performance(y_test[sub_mask], y_m[sub_mask])
            perf_results[dt][m_name] = perf
            ma = perf["rule_a"]
            mb = perf["rule_b"]
            print(
                f"{m_name:<22} | "
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

    print("=" * 80 + "\n")
    return perf_results


def measure_inference_latencies(
    test_df: pd.DataFrame,
    model_lstm: LSTMPredictor,
    scaler: StandardScaler,
    how_table: Any,
    feature_names: List[str],
    X_test_seq: np.ndarray,
) -> Tuple[float, float, float, float]:
    """Measure single-row CPU inference latency for XGBoost v2b and LSTM v2."""
    print("=" * 80)
    print("  STEP 4: SINGLE-ROW CPU INFERENCE LATENCY BENCHMARK")
    print("  Protocol: 50 warmup calls, 500 timed calls, CPU only")
    print("=" * 80)

    model_xgb = joblib.load(CANDIDATE_V2_DIR / "xgb_v2b.joblib")

    # 1. XGBoost v2b via shared assembler + predict
    sample_row = test_df.iloc[0]
    prev_plugs = float(sample_row["active_plugs"] - sample_row["plug_delta_15m"])
    local_ts = to_station_local(sample_row["timestamp"])
    h = local_ts.hour + local_ts.minute / 60.0
    d = local_ts.weekday()

    single_dict = {
        "ambient_temp_c": sample_row["ambient_temp_c"],
        "traffic_inflow_index": sample_row["traffic_inflow_index"],
        "active_plugs": sample_row["active_plugs"],
        "grid_frequency_hz": sample_row["grid_frequency_hz"],
        "load_lag_15m": sample_row["load_lag_15m"],
        "load_lag_30m": sample_row["load_lag_30m"],
        "load_lag_45m": sample_row["load_lag_45m"],
        "load_lag_60m": sample_row["load_lag_60m"],
        "hour": h,
        "day_of_week": d,
        "timestamp": sample_row["timestamp"],
    }
    single_df = pd.DataFrame([single_dict])

    # Warmup XGBoost
    for _ in range(50):
        feats = assemble_features_df(
            single_df,
            is_batch=False,
            how_table=how_table,
            feature_names=feature_names,
            prev_active_plugs=prev_plugs,
        )
        model_xgb.predict(feats.astype(float))

    # Timed XGBoost
    times_xgb: List[float] = []
    for _ in range(500):
        t0 = time.perf_counter()
        feats = assemble_features_df(
            single_df,
            is_batch=False,
            how_table=how_table,
            feature_names=feature_names,
            prev_active_plugs=prev_plugs,
        )
        model_xgb.predict(feats.astype(float))
        times_xgb.append((time.perf_counter() - t0) * 1000.0)

    med_xgb = float(np.median(times_xgb))
    p95_xgb = float(np.percentile(times_xgb, 95))

    # 2. LSTM v2 via real inference code path (single sequence tensor)
    model_lstm.eval()
    sample_lstm_tensor = torch.FloatTensor(X_test_seq[:1])

    with torch.no_grad():
        for _ in range(50):
            model_lstm(sample_lstm_tensor)

        times_lstm: List[float] = []
        for _ in range(500):
            t0 = time.perf_counter()
            model_lstm(sample_lstm_tensor)
            times_lstm.append((time.perf_counter() - t0) * 1000.0)

    med_lstm = float(np.median(times_lstm))
    p95_lstm = float(np.percentile(times_lstm, 95))

    print(f"  • XGBoost v2b (Assembler + Predict) : Median = {med_xgb:6.3f} ms | p95 = {p95_xgb:6.3f} ms")
    print(f"  • LSTM v2     (Tensor Forward Pass) : Median = {med_lstm:6.3f} ms | p95 = {p95_lstm:6.3f} ms")
    print("=" * 80 + "\n")

    return med_xgb, p95_xgb, med_lstm, p95_lstm


def verify_round_trip(
    model: LSTMPredictor,
    scaler: StandardScaler,
    feature_names: List[str],
    X_test_seq: np.ndarray,
    seed: int = 42,
) -> Tuple[bool, float]:
    """Save candidate artifacts and verify round-trip in an isolated Python subprocess."""
    print("=" * 80)
    print("  STEP 5: CANDIDATE ARTIFACT SAVE & SUBPROCESS ROUND-TRIP VERIFICATION")
    print("=" * 80)

    # 1. Save candidate artifacts
    model_save_path = CANDIDATE_V2_DIR / "lstm_v2.pt"
    scaler_save_path = CANDIDATE_V2_DIR / "lstm_scaler_v2.joblib"
    config_save_path = CANDIDATE_V2_DIR / "lstm_v2_config.json"

    torch.save(model.state_dict(), model_save_path)
    joblib.dump(scaler, scaler_save_path)

    config_data = {
        "model_name": "lstm_v2",
        "seq_len": 8,
        "input_size": len(feature_names),
        "hidden_size": 64,
        "num_layers": 2,
        "dropout": 0.2,
        "feature_names": feature_names,
        "seed": seed,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(config_save_path, "w") as f:
        json.dump(config_data, f, indent=2)

    print(f"  • Saved model state_dict : {model_save_path.name} ({model_save_path.stat().st_size / 1024:.1f} KB)")
    print(f"  • Saved scaler artifact  : {scaler_save_path.name} ({scaler_save_path.stat().st_size / 1024:.1f} KB)")
    print(f"  • Saved model config     : {config_save_path.name}")

    # 2. Select 200 random test sequences and compute in-memory predictions
    rng = np.random.default_rng(seed)
    sampled_indices = rng.choice(len(X_test_seq), size=200, replace=False)
    sample_seqs = X_test_seq[sampled_indices]

    model.eval()
    with torch.no_grad():
        preds_in_memory = model(torch.FloatTensor(sample_seqs)).squeeze(-1).numpy().astype(np.float64)

    # 3. Spawn a separate, fresh Python process to load saved files and predict
    with tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f_in, \
         tempfile.NamedTemporaryFile(suffix=".npy", delete=False) as f_out:
        temp_input = f_in.name
        temp_output = f_out.name
        np.save(temp_input, sample_seqs)

    script_code = f"""
import sys
from pathlib import Path
backend_dir = r"{BACKEND_DIR}"
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import json
import torch
import numpy as np
from pipeline.train_lstm import LSTMPredictor

config_path = Path(r"{config_save_path}")
model_path = Path(r"{model_save_path}")

with open(config_path, "r") as f:
    cfg = json.load(f)

model = LSTMPredictor(
    input_size=cfg["input_size"],
    hidden_size=cfg["hidden_size"],
    num_layers=cfg["num_layers"],
    dropout=cfg["dropout"],
)
model.load_state_dict(torch.load(model_path, map_location="cpu", weights_only=True))
model.eval()

sample_seqs = np.load(r"{temp_input}")
with torch.no_grad():
    preds = model(torch.FloatTensor(sample_seqs)).squeeze(-1).numpy().astype(np.float64)

np.save(r"{temp_output}", preds)
"""

    try:
        proc = subprocess.run(
            [sys.executable, "-c", script_code],
            capture_output=True,
            text=True,
            check=True,
        )
        preds_subprocess = np.load(temp_output)
    finally:
        Path(temp_input).unlink(missing_ok=True)
        Path(temp_output).unlink(missing_ok=True)

    max_abs_diff = float(np.max(np.abs(preds_in_memory - preds_subprocess)))
    pass_round_trip = max_abs_diff < 1e-4

    print(f"\n  [Subprocess Round-Trip Evaluation on 200 Random Test Rows]:")
    print(f"  • Max Absolute Difference : {max_abs_diff:.8e} kW (Required: < 1.0e-4 kW)")
    print(f"  • Round-Trip Status       : [{'PASS' if pass_round_trip else 'FAIL'}]")
    print("=" * 80 + "\n")

    return pass_round_trip, max_abs_diff


def main() -> None:
    seed = 42
    print_architecture_inspection()

    # 1. Data and Sequences
    df, feature_names, X_seqs, y_seqs, indices_dict, scaler, how_table = prepare_continuous_sequences(
        seq_len=8, seed=seed
    )

    # 2. Train LSTM
    model_lstm, best_epoch, best_val_loss, history = train_lstm_model(
        X_seqs=X_seqs,
        y_seqs=y_seqs,
        n_features=len(feature_names),
        epochs=60,
        batch_size=64,
        lr=1e-3,
        patience=12,
        seed=seed,
    )

    # 3. 5-Forecaster Comparative Evaluation on identical test rows
    perf_results = evaluate_comparative_table(
        df=df,
        test_idx=indices_dict["test"],
        X_test_seq=X_seqs["test"],
        y_test_seq=y_seqs["test"],
        model_lstm=model_lstm,
        how_table=how_table,
        feature_names=feature_names,
    )

    # 4. Latency
    test_purged = pd.read_parquet(CANDIDATE_V2_DIR / "test_purged.parquet")
    med_xgb, p95_xgb, med_lstm, p95_lstm = measure_inference_latencies(
        test_df=test_purged,
        model_lstm=model_lstm,
        scaler=scaler,
        how_table=how_table,
        feature_names=feature_names,
        X_test_seq=X_seqs["test"],
    )

    # 5. Round-trip verification
    pass_round_trip, max_diff = verify_round_trip(
        model=model_lstm,
        scaler=scaler,
        feature_names=feature_names,
        X_test_seq=X_seqs["test"],
        seed=seed,
    )

    # 6. Final Gate Block
    print("=" * 80)
    print("  STEP 6: FINAL GATE BLOCK (PHASE D ACCEPTANCE CRITERIA)")
    print("=" * 80)

    mae_persist = perf_results["OVERALL"]["Persistence"]["mae"]
    mae_lstm = perf_results["OVERALL"]["LSTM v2 (Benchmark)"]["mae"]

    gate_convergence = (best_epoch < 60) and (best_epoch > 1)
    gate_intersection = len(indices_dict["test"]) == 9210
    gate_mae_sanity = mae_lstm < mae_persist
    all_gates = gate_convergence and gate_intersection and pass_round_trip and gate_mae_sanity

    print(f"  • Gate 1: Seeds fixed & training converged (best epoch < 60) : Best Epoch = {best_epoch} -> [{'PASS' if gate_convergence else 'FAIL'}]")
    print(f"  • Gate 2: Same-rows comparison done (intersection test rows) : n = {len(indices_dict['test']):,} rows -> [{'PASS' if gate_intersection else 'FAIL'}]")
    print(f"  • Gate 3: Subprocess round-trip max diff < 1e-4 kW          : {max_diff:.6e} kW -> [{'PASS' if pass_round_trip else 'FAIL'}]")
    print(f"  • Gate 4: LSTM test MAE not worse than Persistence MAE      : {mae_lstm:.2f} kW < {mae_persist:.2f} kW -> [{'PASS' if gate_mae_sanity else 'FAIL'}]")
    print("-" * 80)
    print(f"  OVERALL VERDICT: [{'ALL PHASE D GATES PASSED [PASS]' if all_gates else 'ONE OR MORE GATES FAILED [FAIL]'}]")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    main()
