# Model v2: Specification, Architecture, and Verification Report

**EV Surge Predictor (Grid Pulse)**  
**Target:** 2-Hour-Ahead EV Charging Station Load Forecasting & Surge Protection (250 kW Transformer)  
**Deployed Model:** Monotonic XGBoost Regressor (`xgb_v2b.joblib`) with TreeSHAP Explainer  
**Benchmark Model:** 2-Layer PyTorch LSTM (`lstm_v2.pt`)

---

## 1. Executive Summary & Why Model v2

The original Model v1 served as an initial proof of concept but possessed structural and statistical limitations:
1. **Short Historical Horizon**: Trained on only 90 days of telemetry, capturing limited seasonal and calendar variability.
2. **Missing Feature Constraints (Monotonicity Deficits)**: Lacked directional constraints, meaning an isolated increase in previous charging load could paradoxically decrease the 2-hour forecast under certain tree partitions.
3. **Feature Set Gaps (15 Features)**: Did not include explicit demand-trend velocity or deviation from regular weekly station schedules.
4. **No Baseline Benchmarks**: Evaluated only against an unverified LSTM reference without simple operational baselines (Persistence, Hour-of-Week mean, AR(1) anomaly multiplier).
5. **Uncalibrated Global Prediction Interval**: Provided a static heuristic error band rather than empirically calibrated confidence bounds partitioned across load regimes.

**Model v2 resolves each of these limitations:**
- **Extended 730-Day Dataset (`generator_v2.py`)**: 70,080 timestamps (2 full calendar years at 15-minute resolution) generated with fixed seed `42`, station-local time (`Asia/Kolkata`, UTC+05:30), diurnal commuting profiles, coupled temperature modulation, and 58 distinct event days.
- **17 Engineered Features**: Introduces `load_anomaly` (departure from a train-only hour-of-week mean lookup) and `lag_trend` (load trend from $t-60\text{m}$ to $t-15\text{m}$).
- **Enforced Monotonic Constraints**: Strict directional positive gradients ($+1$) enforced on all 4 load lags, rolling mean, load anomaly, and lag trend.
- **Rigorous Evaluation Gate**: Compared across 4 operational forecasters and verified via 7 strict numerical gates.
- **Binned Empirical Prediction Intervals**: Calibrated on validation residuals across 3 operational regimes ($<100\text{ kW}$, $100\text{--}160\text{ kW}$, $\ge 160\text{ kW}$) achieving 79.78% test-set coverage for nominal 80% confidence.

---

## 2. Synthetic Data Generation v2

In the absence of open-access, high-resolution commercial EV charging station telemetry from Indian distribution networks, `backend/pipeline/generator_v2.py` synthesizes a 730-day telemetry series (70,080 steps at 15-minute resolution spanning 2025-01-01 to 2026-12-31) parameterized to simulate an 8-bay fast-charging depot in Mumbai:

- **Station Local Time (+05:30 IST)**: All timestamps, calendar cycles, and diurnal patterns are computed in station-local Indian Standard Time (`Asia/Kolkata`), eliminating UTC timezone offset distortions.
- **Diurnal and Day-of-Week Seasonality**: Incorporates distinct morning commute ($08:30\text{--}10:30$) and evening rush ($17:30\text{--}21:00$) peaks, weekday vs. weekend driving profiles, and low nocturnal usage ($01:00\text{--}05:00$).
- **Coupled Meteorological Forcing**: Simulates ambient dry-bulb temperature strictly in the $[20.0, 40.0]^\circ\text{C}$ range aligned with coastal Mumbai climate, adding cooling demand ($+2.0\text{ kW}/^\circ\text{C}$) when ambient temperature exceeds $30.0^\circ\text{C}$.
- **Intra-Day Stochastic Shocks**: Injects an AR(1) shock process ($\phi = 0.97$ per 15-min step, stationary standard deviation $\sigma_s = 20.0\text{ kW}$) to model persistent intra-day demand inertia, with white noise standard deviation $\sigma_\epsilon = 3.5\text{ kW}$.
- **Day-Type Distribution (730 Days Total)**:
  - Normal Days: 614 days (84.1%) with daily demand multiplier drawn from $\mathcal{N}(1.0, 0.08)$ clipped to $[0.85, 1.15]$.
  - Event Days: 58 days (7.9%) where evening peak load (17:00–21:00) is scaled by a factor in $[1.30, 1.60]$.
  - Low-Demand Days: 58 days (7.9%) where whole-day load is scaled by a factor in $[0.70, 0.85]$.
- **Evening Peak Load Characterization (Measured on Test Split, 17:00–21:00 Local Time)**:
  - Event-Day Evening Mean Load: **201.17 kW** ($n = 153$ steps across 9 test event days).
  - Normal-Day Evening Mean Load: **171.48 kW** ($n = 1,564$ steps across 92 test normal days).
  - Event / Normal Evening Ratio: **1.173** ($+17.3\%$ load uplift).

---

## 3. Feature Engineering & The 17-Feature Pipeline

The feature pipeline ingests telemetry snapshots and extracts 17 tabular features:

| Index | Feature Name | Category | Description | Monotone Constraint |
|:---:|---|---|---|:---:|
| 0 | `ambient_temp_c` | Exogenous | Outdoor dry-bulb temperature from Open-Meteo API | None |
| 1 | `traffic_inflow_index` | Exogenous | Arterial feeder road traffic density (0 to 100) | None |
| 2 | `active_plugs` | Station State | Currently connected vehicles at $t$ (0 to 8 bays) | None |
| 3 | `grid_frequency_hz` | Exogenous | Local AC grid frequency (centered at 50.0 Hz nominal) | None |
| 4 | `load_lag_15m` | Historical | Station charging load at $t - 15\text{ min}$ (kW) | $+1$ (Monotone Increasing) |
| 5 | `load_lag_30m` | Historical | Station charging load at $t - 30\text{ min}$ (kW) | $+1$ (Monotone Increasing) |
| 6 | `load_lag_45m` | Historical | Station charging load at $t - 45\text{ min}$ (kW) | $+1$ (Monotone Increasing) |
| 7 | `load_lag_60m` | Historical | Station charging load at $t - 60\text{ min}$ (kW) | $+1$ (Monotone Increasing) |
| 8 | `rolling_mean_60m` | Historical | Mean load over prior 4 steps $[t-60\text{m}, t-15\text{m}]$ | $+1$ (Monotone Increasing) |
| 9 | `rolling_std_60m` | Historical | Load standard deviation over prior 4 steps | None (Unconstrained) |
| 10 | `plug_delta_15m` | Station State | Connection change: $\text{active\_plugs}(t) - \text{active\_plugs}(t-15\text{m})$ | None |
| 11 | `hour_sin` | Calendar | Diurnal cycle: $\sin(2\pi \cdot \text{hour} / 24)$ | None |
| 12 | `hour_cos` | Calendar | Diurnal cycle: $\cos(2\pi \cdot \text{hour} / 24)$ | None |
| 13 | `day_sin` | Calendar | Weekly cycle: $\sin(2\pi \cdot \text{day\_of\_week} / 7)$ | None |
| 14 | `day_cos` | Calendar | Weekly cycle: $\cos(2\pi \cdot \text{day\_of\_week} / 7)$ | None |
| 15 | `load_anomaly` | Historical / HoW | $\text{load\_lag\_15m} - \text{HoW\_Mean}(\text{day}, \text{hour})$ | $+1$ (Monotone Increasing) |
| 16 | `lag_trend` | Historical | Velocity: $\text{load\_lag\_15m} - \text{load\_lag\_60m}$ | $+1$ (Monotone Increasing) |

### Train-Only Hour-of-Week Mean Table (`hour_of_week_mean.joblib`)
To compute `load_anomaly` without data leakage, an empirical $7 \times 24 = 168$-cell Hour-of-Week (HoW) lookup table is calculated **exclusively on the 510 days of the training split**. During test evaluation and live inference, the historical mean for that specific day of week and hour is extracted from this frozen lookup artifact.

---

## 4. Monotone Constraints & Verification Scope

In power systems operations, an ML model must behave predictably when load surges. If an operator observes that load across all bays has risen by 50 kW in the past hour, the model's 2-hour-ahead forecast must not drop.

### Monotonicity Specification
XGBoost's tree construction enforces monotonic splits:
$$\frac{\partial \hat{y}}{\partial x_i} \ge 0 \quad \text{for } x_i \in \{\text{lags}_{15,30,45,60}, \text{rolling\_mean}_{60}, \text{load\_anomaly}, \text{lag_trend}\}$$

### Property Testing Verification
Evaluated across 300 randomly sampled test instances ($x \in \mathcal{D}_{\text{test}}$ where $\max(\text{lags}) \le 190\text{ kW}$) swept continuously with perturbations $\Delta \in [0, +100\text{ kW}]$:
1. **Coupled Sweep (All 4 Lags Perturbed Simultaneously)**:
   - Evaluates operational surge response where load systematically builds up.
   - **Violations: 0 across all 300 test profiles (Max drop: 0.0000 kW) $\to$ PASS**.
2. **Single Lag Sweep (`load_lag_15m` Alone)**:
   - Informational diagnostic: Sweeping `load_lag_15m` alone while holding `load_lag_30m..60m` fixed alters the unconstrained feature `rolling_std_60m`.
   - Results in 27 minor non-monotonic deviations across 26 rows (max drop: 3.4866 kW).
   - This slight variance is expected because sample standard deviation is non-monotonic with respect to a single boundary element.

---

## 5. Evaluation Protocol & Results

### Stratified Day Splitting & Boundary Purge
To prevent cross-split leakage, dataset partitioning follows a stratified day assignment with boundary purging:
- **Total Dataset**: 730 calendar days (70,080 raw timestamps).
- **Split Ratios**: 70% Train (510 days) / 15% Validation (110 days) / 15% Test (110 days), preserving identical proportions of normal, event, and low days across splits.
- **Boundary Purge Rule**: Drops any row whose lag window ($t-60\text{m}$, 4 steps back) or target ($t+2\text{h}$, 8 steps ahead) falls on a day assigned to a different split than the row's own day, plus drops rows with NaN target/lags at the series endpoints. This ensures no row's lag window or target crosses into another split's day.
  - **Train Set**: 510 days $\to$ 48,960 raw rows $\to$ **47,076 post-purge rows** (1,884 boundary rows dropped).
  - **Validation Set**: 110 days $\to$ 10,560 raw rows $\to$ **9,420 post-purge rows** (1,140 boundary rows dropped).
  - **Test Set**: 110 days $\to$ 10,560 raw rows $\to$ **9,480 post-purge rows** (1,080 boundary rows dropped; 9,210 sequence-aligned rows).

### Alert Rule Definitions
- **Rule A (Critical Surge Alert)**: Actual or predicted load $\ge 200.0\text{ kW}$ ($80\%$ of transformer's 250 kW capacity). High precision is essential to avoid unnecessary breaker trips and battery shedding.
- **Rule B (Early Warning Advisory)**: Predicted load $\ge 162.5\text{ kW}$ ($65\%$ of transformer capacity). High recall is essential to give the operator 2 hours advance notice to schedule dynamic tariff escalations and prepare bay throttling.

### Comparative Results Table (Full Test Set, 9,480 Timestamps)

| Forecaster | MAE (kW) | RMSE (kW) | Rule A Recall ($\ge 200\text{ kW}$) | Rule A Precision | Rule A False Positives | Rule B Recall ($\ge 162.5\text{ kW}$) | Rule B Precision | Rule B False Positives |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **1. Persistence** ($\text{lag}_{15\text{m}}$) | 40.30 | 49.24 | 30.9% | 30.9% | 511 | 57.0% | 26.9% | 1,143 |
| **2. Plain HoW Mean** | 20.28 | 25.38 | 71.4% | 75.0% | 176 | 93.2% | 55.8% | 545 |
| **3. Baseline 3** (AR(1) Anomaly) | 14.51 | 18.17 | 63.7% | **89.5%** | **55** | 97.8% | **57.2%** | **540** |
| **4. XGBoost** (`xgb_v2b`, deployed) | **12.65** | **15.90** | **81.9%** | 84.7% | 109 | **99.6%** | 49.7% | 746 |

### Performance Breakdown by Day Type (9,480 Timestamps)

| Day Type | Rows | Forecaster | MAE (kW) | RMSE (kW) | Rule A Recall | Rule A Precision | Rule B Recall | Rule B Precision |
|---|:---:|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Normal Days** | 7,928 | Persistence | 40.62 | 49.34 | 29.8% | 29.8% | 56.7% | 26.5% |
| | | Plain HoW Mean | 19.43 | 24.04 | 75.2% | 78.4% | 96.5% | 57.3% |
| | | Baseline 3 | 14.21 | 17.71 | 66.0% | 89.3% | 98.2% | 57.6% |
| | | **XGBoost (v2b)** | **12.40** | **15.54** | **84.4%** | **85.5%** | **99.7%** | 49.4% |
| **Event Days** | 772 | Persistence | 45.44 | 56.50 | 41.7% | 41.7% | 59.2% | 34.9% |
| | | Plain HoW Mean | 26.43 | 32.88 | 48.5% | 96.2% | 72.8% | 86.2% |
| | | Baseline 3 | 16.27 | 20.78 | 55.3% | **100.0%** | 96.1% | **74.4%** |
| | | **XGBoost (v2b)** | **13.73** | **17.55** | **71.8%** | 96.1% | **99.0%** | 66.7% |
| **Low-Demand Days** | 780 | Persistence | 32.01 | 39.55 | 0.0% | 0.0% | 53.3% | 13.6% |
| | | Plain HoW Mean | 22.87 | 29.77 | 73.3% | 19.6% | 100.0% | 14.7% |
| | | Baseline 3 | 15.84 | 19.91 | 26.7% | 40.0% | 93.3% | 19.7% |
| | | **XGBoost (v2b)** | **14.05** | **17.75** | 46.7% | 29.2% | 100.0% | 19.5% |

---

## 6. Prediction Interval Calibration

Rather than assuming symmetric Gaussian residuals, prediction intervals are constructed using **empirical quantile calibration** ($q_{10}$ and $q_{90}$) on validation set residuals ($e_t = y_t - \hat{y}_t$).

Because load variance expands at higher utilization levels (heteroscedasticity), residuals are calibrated across three load regimes:

| Regime Bin | Predicted Load Range | $q_{10}$ Offset (kW) | $q_{90}$ Offset (kW) | Interval Width | Test-Set Empirical Coverage |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **Bin 1** | $\hat{y} < 100\text{ kW}$ | $-19.689$ | $+18.710$ | $38.40\text{ kW}$ | **80.34%** |
| **Bin 2** | $100\text{ kW} \le \hat{y} < 160\text{ kW}$ | $-19.668$ | $+20.705$ | $40.37\text{ kW}$ | **78.97%** |
| **Bin 3** | $\hat{y} \ge 160\text{ kW}$ | $-23.001$ | $+22.316$ | $45.32\text{ kW}$ | **79.51%** |
| **Overall** | Full Test Set ($n=9,480$) | — | — | $40.14\text{ kW}$ | **79.78%** |

*Gate Criterion:* Nominal target is $80.0\% \pm 3.0\text{ pp}$ ($[77.0\%, 83.0\%]$). The binned model achieves **79.78% overall coverage** and maintains tight coverage across each bin.

---

## 7. Offline PyTorch LSTM Benchmark (`lstm_v2.pt`)

An offline sequence model was built to benchmark XGBoost against recurrent deep learning:
- **Architecture**: 2-layer LSTM, `hidden_size = 64`, input dimensions: 17 features, sequence length: 8 steps (120-minute rolling span, 105-minute lookback), dropout: 0.2.
- **Training**: Standardized via `StandardScaler` (`lstm_scaler.joblib`), trained with Adam optimizer ($\text{lr} = 10^{-3}$), MSE loss, batch size 64, and early stopping on validation loss (patience = 12 epochs).

### XGBoost vs. LSTM Benchmark Comparison (9,210 Aligned Test Sequences)

Evaluated on the exact same 9,210 sequence-aligned test instances from `backend/saved_models/training_metrics.joblib` and `lstm_metrics.joblib`:

| Metric | XGBoost (`xgb_v2b`) | PyTorch LSTM (`lstm_v2`) | Operational Impact |
|---|:---:|:---:|---|
| **MAE** | **12.67 kW** | 12.94 kW | XGBoost error is 0.27 kW lower |
| **RMSE** | **15.93 kW** | 16.32 kW | XGBoost has lower peak dispersion |
| **Rule A Recall ($\ge 200\text{ kW}$)** | **81.9%** | 78.8% | XGBoost captures 3.1 pp more true surges |
| **Rule A Precision** | 84.7% | **86.4%** | Comparable precision ($< 2\text{ pp}$ delta) |
| **Rule B Recall ($\ge 162.5\text{ kW}$)** | 99.6% | **99.7%** | Both achieve near-perfect advisory recall |
| **Rule B Precision** | **49.3%** | 48.7% | Early warning flag catches surges with ~50% precision |
| **Model-Only Latency** | 1.15 ms | 0.20 ms | Both execute in single-digit ms / sub-ms |
| **End-to-End Latency** | 6.3 ms | 0.44 ms | Both well within any operational requirement |
| **Explainability** | **Exact TreeSHAP** | Black-box / Permutation | TreeSHAP provides exact additivity in real time |
| **Monotonicity** | **Mathematically Enforced** | Unconstrained | LSTM cannot guarantee monotonic surge response |

> **Why XGBoost is Deployed for Live Inference:**  
> While the LSTM delivers competitive accuracy, XGBoost offers three critical operational advantages:
> 1. Exact real-time TreeSHAP attributions with local additivity ($\sum \phi_j = \hat{y} - \phi_0$).
> 2. Enforced monotonic constraints preventing counter-intuitive prediction dips during sudden charging surges.
> 3. Zero dependency on past sequence buffering in stateless HTTP API invocations.

---

## 8. TreeSHAP Global Feature Attributions

Global feature importance is calculated as the mean absolute SHAP value across the evaluation dataset:
$$I_j = \frac{1}{N}\sum_{i=1}^N |\phi_{i,j}|$$

| Rank | Feature | Mean Absolute SHAP ($E[\|\phi\|]$) | Relative Importance (%) | Functional Category |
|:---:|---|:---:|:---:|---|
| 1 | `hour_cos` | 25.442 kW | 29.4% | Time / Diurnal |
| 2 | `hour_sin` | 18.158 kW | 21.0% | Time / Diurnal |
| 3 | `lag_trend` | 8.812 kW | 10.2% | Historical / Trend |
| 4 | `day_sin` | 8.454 kW | 9.8% | Time / Diurnal |
| 5 | `load_anomaly` | 6.690 kW | 7.7% | Historical / HoW |
| 6 | `load_lag_60m` | 4.253 kW | 4.9% | Historical / Autoregressive |
| 7 | `load_lag_15m` | 4.079 kW | 4.7% | Historical / Autoregressive |
| 8 | `rolling_mean_60m` | 2.049 kW | 2.4% | Historical / Smoothing |
| 9 | `traffic_inflow_index` | 1.772 kW | 2.0% | Exogenous Telemetry |
| 10 | `load_lag_30m` | 1.716 kW | 2.0% | Historical / Autoregressive |
| 11 | `ambient_temp_c` | 1.472 kW | 1.7% | Exogenous Meteorological |
| 12 | `rolling_std_60m` | 1.147 kW | 1.3% | Historical / Volatility |
| 13 | `load_lag_45m` | 0.775 kW | 0.9% | Historical / Autoregressive |
| 14 | `active_plugs` | 0.725 kW | 0.8% | Station Utilization |
| 15 | `day_cos` | 0.502 kW | 0.6% | Time / Diurnal |
| 16 | `plug_delta_15m` | 0.291 kW | 0.3% | Station Dynamics |
| 17 | `grid_frequency_hz` | 0.242 kW | 0.3% | Exogenous Power Quality |

### Categorical Grouping
- **Diurnal & Weekly Time Drivers (60.8%)**: `hour_cos`, `hour_sin`, `day_sin`, `day_cos`. Dominates baseline load shapes due to regular human commuting schedules.
- **Historical & Trend Drivers (34.1%)**: `lag_trend`, `load_anomaly`, lags 15–60m, rolling statistics. Governs real-time momentum and deviations from normal profiles.
- **Exogenous & Station Telemetry (5.1%)**: `traffic_inflow_index`, `ambient_temp_c`, `active_plugs`, `plug_delta_15m`, `grid_frequency_hz`. Provides localized fine-tuning.

### Local Additivity Verification
For every row $i$, TreeSHAP guarantees:
$$\phi_0 + \sum_{j=1}^{17} \phi_{i,j} = \hat{y}_i$$
The model's expected value (base value) is $\phi_0 = 105.5596\text{ kW}$. Tested on held-out samples, the maximum absolute additivity error is **$2.136 \times 10^{-4}\text{ kW}$**, well beneath the $1.0 \times 10^{-3}\text{ kW}$ verification threshold.

---

## 9. Verification & Sanity Gates

`backend/pipeline/evaluate_v2.py` enforces 7 strict automated pass/fail verification gates:

| Gate | Description | Required Threshold | Observed Value | Verdict |
|:---:|---|---|:---:|:---:|
| **Gate 1** | Model Accuracy vs Baselines | $\text{MAE} < \text{B3 } (14.51) \text{ \& } < \text{HoW } (20.28)$ | **12.65 kW** | **PASS** |
| **Gate 2** | Overall Rule B Advisory Recall | $\text{Recall} > \text{B3 } (97.8\%) \text{ \& } > \text{HoW } (93.2\%)$ | **99.6%** | **PASS** |
| **Gate 3** | Event-Day Rule B Recall | $\text{Recall} > \text{B3 } (96.1\%) \text{ \& } > \text{HoW } (72.8\%)$ | **99.0%** | **PASS** |
| **Gate 4** | Sanity Check (a): Surge Responsiveness at 18:00 | Increase $\ge +30.0\text{ kW}$ on $+100\text{ kW}$ lag surge | **+54.47 kW** | **PASS** |
| **Gate 5** | Sanity Check (b): Off-Peak Night Baseline at 03:00 | Max prediction $< 200.0\text{ kW}$ across test set | **124.23 kW** ($0.0\%$ breaches) | **PASS** |
| **Gate 6** | Sanity Check (c): Monotonicity Property Test | $0\text{ violations}$ over 300 test profiles swept $+100\text{ kW}$ | **0 violations** ($0.0000\text{ kW}$ drop) | **PASS** |
| **Gate 7** | Sanity Check (d): TreeSHAP Local Additivity | Max $\|(\phi_0 + \sum \phi_j) - \hat{y}\| < 10^{-3}\text{ kW}$ | **$2.14 \times 10^{-4}\text{ kW}$** | **PASS** |

---

## 10. Operational Sandbox vs. Scenario Feeds

To ensure architectural transparency, the system maintains a clear separation between operational stress testing and statistical forecasting:
- **Scenario Presets (Control Center)**: Feeds canonical station payloads (Nominal Midday, Evening Rush, Summer Heatwave, Monsoon Lull) directly into the deployed XGBoost model (`/api/v1/predict` and `/api/v1/explain`). Predictions, intervals, and SHAP waterfalls reflect actual model inferences.
- **Sandbox (What-If Simulator)**: Designed as an operational stress-testing tool (`/api/v1/simulate`). It applies explicit physical heuristics ($+2.0\text{ kW}/^\circ\text{C}$ temperature sensitivity, $+0.8\text{ kW}/\%$ traffic surge, and hard capacity caps from bay outages) to demonstrate automated load shedding, stall throttling (capped at 60 kW per stall), and dynamic tariff escalation (1.00x, 1.20x, 1.45x, 1.80x).

---

## 11. Reproduction Commands

To replicate all Model v2 artifacts, metrics, and verification tests from scratch, execute the following commands from the repository root:

```bash
# 1. Activate backend environment
cd backend
source venv/bin/activate  # Or .\venv\Scripts\Activate on Windows

# 2. Generate 730-day telemetry with seed 42
python pipeline/generator_v2.py

# 3. Build purged train, val, test datasets with boundary purge
python pipeline/build_dataset_v2.py

# 4. Train monotonic XGBoost regressor (xgb_v2b)
python pipeline/train.py

# 5. Calibrate binned empirical prediction intervals
python pipeline/calibrate_interval_v2b.py

# 6. Train PyTorch LSTM benchmark
python pipeline/train_lstm_v2.py

# 7. Package and verify all artifacts
python pipeline/package_v2_artifacts.py
python pipeline/verify_artifacts.py

# 8. Run full evaluation and 7-gate verification report
python pipeline/evaluate_v2.py
```

---

## 12. Engineering Limitations & Future Work

While Model v2 establishes a robust, explainable forecasting baseline, several engineering limitations remain:
1. **Synthetic Telemetry Dependency**: Validation was conducted on physically parameterized synthetic data. Real-world validation against utility smart meter feeds and physical charger logs is necessary when commercial datasets become available in India.
2. **Event-Day Sample**: The held-out test split contains 9 event days (153 evening peak steps). While event-day Rule B recall reached 99.0%, broader multi-year empirical sampling would strengthen confidence.
3. **OCPP Actuation**: The current system outputs recommended bay throttling and dynamic tariff multipliers; automated breaker actuation via OCPP 2.0.1 or OpenADR 2.0b smart charging profiles is slated for future work.
4. **Temporal Cross-Validation**: Future revisions will evaluate walk-forward temporal cross-validation across rolling calendar windows.
