"""
EV Charging Surge Predictor — LSTM Benchmark Training
======================================================
Trains a 2-layer LSTM sequence model on the SAME synthetic telemetry
and feature-engineered dataset as the XGBoost primary model, using
an identical train/test split and evaluation methodology.

This produces REAL, measured benchmark metrics (MAE, RMSE, Surge Recall,
inference latency) that replace the previously hardcoded placeholder
numbers in GET /api/v1/metrics.

Spec reference: §3.3 Comparative Evaluation

Artifacts saved to  backend/saved_models/:
  • lstm_model.pt            — trained PyTorch LSTM state dict
  • lstm_metrics.joblib      — evaluation metrics dict
"""

from __future__ import annotations

from datetime import datetime, timezone
import sys
from pathlib import Path

import joblib
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

# Reuse the exact same data pipeline as XGBoost
from train import (
    synthesize_telemetry,
    engineer_features,
    FEATURE_COLUMNS,
    TARGET_COLUMN,
    SAVED_MODELS_DIR,
)
from latency_utils import measure_inference_latency

# ──────────────────────────────────────────────────────────────
#  1.  LSTM Model Definition
# ──────────────────────────────────────────────────────────────

class LSTMPredictor(nn.Module):
    """2-layer LSTM for tabular time-series regression (spec §3.3)."""

    def __init__(self, input_size: int, hidden_size: int = 64, num_layers: int = 2, dropout: float = 0.2):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.fc = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(32, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x shape: (batch, seq_len, features)
        lstm_out, _ = self.lstm(x)
        # Take the last timestep's output
        last_hidden = lstm_out[:, -1, :]
        return self.fc(last_hidden).squeeze(-1)


# ──────────────────────────────────────────────────────────────
#  2.  Sequence Dataset Builder
# ──────────────────────────────────────────────────────────────

def create_sequences(X: np.ndarray, y: np.ndarray, seq_len: int = 8):
    """Slide a window of `seq_len` steps over the feature matrix.
    
    Each sample becomes a (seq_len, n_features) tensor paired with
    the target value at the END of that window.
    """
    Xs, ys = [], []
    for i in range(len(X) - seq_len):
        Xs.append(X[i : i + seq_len])
        ys.append(y[i + seq_len])
    return np.array(Xs), np.array(ys)


def evaluate_lstm(
    model: nn.Module,
    X_seq: np.ndarray,
    y_seq: np.ndarray,
    device: torch.device,
    batch_size: int = 64,
) -> tuple[float, float, float, np.ndarray]:
    """Single standard evaluation function for LSTM sequence predictions.
    
    Returns (mae_kw, rmse_kw, surge_recall_pct, y_pred).
    """
    model.eval()
    ds = TensorDataset(
        torch.FloatTensor(X_seq),
        torch.FloatTensor(y_seq),
    )
    loader = DataLoader(ds, batch_size=batch_size, shuffle=False)
    all_preds = []
    all_targets = []

    with torch.no_grad():
        for X_batch, y_batch in loader:
            X_batch = X_batch.to(device)
            preds = model(X_batch)
            all_preds.append(preds.cpu().numpy())
            all_targets.append(y_batch.numpy())

    y_pred = np.concatenate(all_preds)
    y_true = np.concatenate(all_targets)

    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))

    TRANSFORMER_CAPACITY = 250.0
    SURGE_THRESHOLD = 0.80 * TRANSFORMER_CAPACITY  # 200.0 kW
    actual_surge = y_true >= SURGE_THRESHOLD
    predicted_surge = y_pred >= SURGE_THRESHOLD
    if actual_surge.sum() > 0:
        surge_recall = float((predicted_surge & actual_surge).sum() / actual_surge.sum() * 100.0)
    else:
        surge_recall = 100.0

    return mae, rmse, surge_recall, y_pred


# ──────────────────────────────────────────────────────────────
#  3.  Training Loop
# ──────────────────────────────────────────────────────────────

def train_lstm(
    epochs: int = 60,
    batch_size: int = 64,
    lr: float = 1e-3,
    seq_len: int = 8,
    seed: int = 42,
) -> dict:
    """Train LSTM on the same data pipeline as XGBoost and evaluate."""

    torch.manual_seed(seed)
    np.random.seed(seed)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"  Device: {device}")

    # ── Data pipeline (identical to XGBoost) ──
    print("\n[1/5] Synthesizing telemetry & engineering features ...")
    df_raw = synthesize_telemetry(n_days=90, seed=42)
    df = engineer_features(df_raw)

    X_all = df[FEATURE_COLUMNS].values
    y_all = df[TARGET_COLUMN].values

    # Same temporal split as XGBoost (shuffle=False, 80/20)
    split_idx = int(len(X_all) * 0.8)
    X_train_raw, X_test_raw = X_all[:split_idx], X_all[split_idx:]
    y_train_raw, y_test_raw = y_all[:split_idx], y_all[split_idx:]

    # Scale with the SAME approach (fit on train only)
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_raw)
    X_test_scaled = scaler.transform(X_test_raw)

    # Create sequences
    print(f"[2/5] Creating sequences (window={seq_len}) ...")
    X_train_seq, y_train_seq = create_sequences(X_train_scaled, y_train_raw, seq_len)
    X_test_seq, y_test_seq = create_sequences(X_test_scaled, y_test_raw, seq_len)

    print(f"  Train sequences: {X_train_seq.shape[0]}")
    print(f"  Test sequences:  {X_test_seq.shape[0]}")

    # Convert to tensors
    train_ds = TensorDataset(
        torch.FloatTensor(X_train_seq),
        torch.FloatTensor(y_train_seq),
    )
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)

    # ── Model ──
    n_features = X_train_seq.shape[2]
    model = LSTMPredictor(input_size=n_features, hidden_size=64, num_layers=2, dropout=0.2).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.MSELoss()

    # ── Training ──
    print(f"\n[3/5] Training LSTM for {epochs} epochs ...")
    for epoch in range(1, epochs + 1):
        model.train()
        epoch_loss = 0.0
        for X_batch, y_batch in train_loader:
            X_batch, y_batch = X_batch.to(device), y_batch.to(device)
            optimizer.zero_grad()
            preds = model(X_batch)
            loss = criterion(preds, y_batch)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item() * X_batch.size(0)

        epoch_loss /= len(train_loader.dataset)
        if epoch % 10 == 0 or epoch == 1:
            print(f"  Epoch {epoch:3d}/{epochs}  |  Train MSE: {epoch_loss:.4f}")

    # ── Evaluation (Single standard evaluation function) ──
    print("\n[4/5] Evaluating on test set ...")
    mae, rmse, surge_recall, y_pred = evaluate_lstm(model, X_test_seq, y_test_seq, device, batch_size)

    # Measure inference latency using standardized protocol (single sample, 10 warmup, 100 timed iterations, median)
    sample_lstm = torch.FloatTensor(X_test_seq[:1]).to(device)
    with torch.no_grad():
        avg_latency_ms = measure_inference_latency(lambda s: model(s), sample_lstm, n_warmup=10, n_iterations=100)

    metrics = {
        "mae_kw": round(float(mae), 2),
        "rmse_kw": round(float(rmse), 2),
        "surge_recall_pct": round(float(surge_recall), 1),
        "latency_ms": round(float(avg_latency_ms), 2),
        "n_test_sequences": int(len(y_test_seq)),
        "seq_len": int(seq_len),
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    print("\n" + "=" * 55)
    print("  LSTM BENCHMARK EVALUATION RESULTS")
    print("=" * 55)
    print(f"  MAE           : {metrics['mae_kw']:.2f} kW")
    print(f"  RMSE          : {metrics['rmse_kw']:.2f} kW")
    print(f"  Surge Recall  : {metrics['surge_recall_pct']:.1f}%")
    print(f"  Avg Latency   : {metrics['latency_ms']:.2f} ms/sample")
    print(f"  Test sequences: {metrics['n_test_sequences']}")
    print(f"  Trained at    : {metrics['trained_at']}")
    print("=" * 55)

    # ── Save artifacts ──
    print("\n[5/5] Saving LSTM artifacts & performing round-trip verification ...")
    SAVED_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_path = SAVED_MODELS_DIR / "lstm_model.pt"
    scaler_path = SAVED_MODELS_DIR / "lstm_scaler.joblib"
    metrics_path = SAVED_MODELS_DIR / "lstm_metrics.joblib"

    # Save weights and scaler to disk
    torch.save(model.state_dict(), model_path)
    joblib.dump(scaler, scaler_path)

    # Round-trip verification from saved disk files
    verify_model = LSTMPredictor(input_size=n_features, hidden_size=64, num_layers=2, dropout=0.2).to(device)
    verify_model.load_state_dict(torch.load(model_path, map_location=device, weights_only=True))
    verify_scaler = joblib.load(scaler_path)

    X_verify_scaled = verify_scaler.transform(X_test_raw)
    X_verify_seq, y_verify_seq = create_sequences(X_verify_scaled, y_test_raw, seq_len)
    v_mae, v_rmse, v_recall, _ = evaluate_lstm(verify_model, X_verify_seq, y_verify_seq, device, batch_size)

    tol = 0.01
    mae_diff = abs(v_mae - mae)
    rmse_diff = abs(v_rmse - rmse)
    recall_diff = abs(v_recall - surge_recall)

    print(f"  Round-trip check: MAE={v_mae:.4f} (diff {mae_diff:.4f}), RMSE={v_rmse:.4f} (diff {rmse_diff:.4f}), Recall={v_recall:.2f}% (diff {recall_diff:.4f}%)")

    if mae_diff > tol or rmse_diff > tol or recall_diff > tol:
        raise RuntimeError(
            f"LSTM round-trip verification FAILED! Discrepancy exceeds tolerance {tol}: "
            f"MAE diff={mae_diff}, RMSE diff={rmse_diff}, Recall diff={recall_diff}"
        )

    print("  [OK] Round-trip verification PASSED. Writing lstm_metrics.joblib ...")
    joblib.dump(metrics, metrics_path)

    model_size_kb = model_path.stat().st_size / 1024
    scaler_size_kb = scaler_path.stat().st_size / 1024
    print(f"  - lstm_model.pt              ({model_size_kb:7.1f} KB)")
    print(f"  - lstm_scaler.joblib         ({scaler_size_kb:7.1f} KB)")
    print(f"  - lstm_metrics.joblib        (    0.2 KB)")
    print("\n[OK] LSTM benchmark artifacts verified and saved successfully.")

    return metrics


# ──────────────────────────────────────────────────────────────
#  4.  Main
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 55)
    print("  EV SURGE PREDICTOR — LSTM BENCHMARK TRAINING")
    print("=" * 55)
    train_lstm()
    print("\n>>> LSTM benchmark complete. Metrics ready for /api/v1/metrics.\n")
