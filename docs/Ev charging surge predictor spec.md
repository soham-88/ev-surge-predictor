EV Charging Station Smart Load & Surge Predictor

Intelligent Grid Operations, Predictive Load Forecasting & Autonomous Throttling Platform

> **Note:** Metrics shown are from the final trained models; the initial design targets were different.

1. Executive Summary & Product Specification (PRD)
1.1 Problem Statement

The rapid adoption of Electric Vehicles (EVs) introduces acute, localized power demand spikes on commercial and municipal distribution grids. Uncoordinated concurrent charging risks transformer thermal overloading, voltage instability, and expensive peak-demand utility penalties.

1.2 Solution Overview

An end-to-end Machine Learning and Grid Operations Web Application that ingests multi-variable tabular telemetry (environmental weather, localized traffic density, baseline grid frequency, and active plug counts) to:

Predict localized energy load surges (kW) and peak tariff spikes 2 hours in advance (t + 120 min).
Execute automated dynamic load throttling and surge tariff multipliers when predicted load exceeds 85% transformer capacity.
Provide real-time Explainable AI (SHAP Waterfall) visual attributions to make autonomous grid decisions transparent.
1.3 User Personas
Grid Operations Engineer — Monitors substation stability, views real-time 24-hour load timelines, and evaluates automated load-shedding actions.
EV Fleet / Station Operator — Manages bay status, reviews dynamic pricing rules, and stress-tests grid response using interactive simulations.
1.4 Core Key Performance Indicators (KPIs)
Inference Latency: < 50 ms per prediction cycle
Forecast Accuracy: Mean Absolute Error (MAE) < 8.5 kW on test split
Overload Prevention: 100% detection (Recall = 1.0) of critical surge events (> 85% capacity)
2. Technical Requirements & Architecture (TRD)
2.1 System Architecture
┌─────────────────────────────────────────────────────────────┐
│                    React 18 + Vite Frontend                 │
│  • Tailwind CSS + shadcn/ui UI Components                   │
│  • Recharts Time-Series Forecast & SHAP Waterfall Graphs    │
│  • Interactive What-If Simulation Panel & Bay Controller    │
└──────────────────────────────┬──────────────────────────────┘
                                │ JSON REST API
┌──────────────────────────────▼──────────────────────────────┐
│                    FastAPI Backend (Python)                 │
│  • Preprocessing & Lag Feature Engineering Engine            │
│  • Inference Engine: XGBoost Regressor (Primary)             │
│  • Comparative Benchmark Engine: LSTM Sequence Model         │
│  • TreeSHAP Feature Attribution Service                      │
│  • Rule-Based Dynamic Load-Shedding & Tariff Engine           │
└──────────────────────────────┬──────────────────────────────┘
                                │
┌──────────────────────────────▼──────────────────────────────┐
│                     Data & Model Storage                    │
│  • Serialized Artifacts (xgboost_model.joblib, scaler.joblib)│
│  • Boulder / Open-Meteo Historical Telemetry Store           │
└─────────────────────────────────────────────────────────────┘
2.2 Tech Stack Matrix

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend UI** | React 18, Vite, TypeScript | Fast, typed client-side single-page application |
| **Styling & Components** | Tailwind CSS v4, Lucide Icons | Accessible, responsive dark-mode "Grid Pulse" dashboard |
| **Data Visualization** | Recharts, Framer Motion | Real-time time-series, waterfall charts, and animated transitions |
| **Backend Framework** | FastAPI, Uvicorn, Pydantic | High-performance asynchronous REST API with OpenAPI contracts |
| **ML & Data Processing** | Python 3.10+, Pandas, NumPy, Scikit-Learn | Data synthesis, feature engineering, and evaluation pipeline |
| **Predictive Algorithms** | XGBoost (Primary) & PyTorch LSTM (Benchmark) | Tabular gradient-boosted regression and sequence benchmarking |
| **Model Explainability** | SHAP (`shap.TreeExplainer`) | Fast local feature attribution for real-time transparency |
| **Persistence & Auth** | SQLite, SQLAlchemy, JWT (`bcrypt`) | User sessions, role-based access control, and telemetry state |
| **Deployment Targets** | Vercel (Frontend), Render / Railway (Backend) | Cloud PaaS containerized deployment |
2.3 Directory Structure
ev-surge-predictor/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   └── v1/
│   │   │       └── endpoints/
│   │   │           ├── auth.py
│   │   │           ├── batch.py
│   │   │           ├── explain.py
│   │   │           ├── metrics.py
│   │   │           ├── predict.py
│   │   │           ├── simulate.py
│   │   │           └── weather.py
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   └── security.py
│   │   ├── models/
│   │   │   ├── ml_engine.py
│   │   │   ├── optimizer.py
│   │   │   └── user.py
│   │   ├── routers/
│   │   │   └── tariff.py
│   │   ├── schemas/
│   │   │   ├── telemetry.py
│   │   │   └── user.py
│   │   ├── services/
│   │   │   └── vehicle_tariff.py
│   │   ├── db.py
│   │   └── main.py
│   ├── pipeline/
│   │   ├── ingest.py
│   │   ├── feature_engineer.py
│   │   └── train.py
│   ├── saved_models/
│   │   ├── xgboost_model.joblib
│   │   ├── scaler.joblib
│   │   ├── shap_explainer.joblib
│   │   ├── feature_names.joblib
│   │   └── training_metrics.joblib
│   ├── requirements.txt
│   └── seed_users.py
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard/
│   │   │   │   ├── ForecastTimeline.tsx
│   │   │   │   ├── HeaderKPIs.tsx
│   │   │   │   ├── ModelComparison.tsx
│   │   │   │   ├── ReportTemplate.tsx
│   │   │   │   ├── SettingsPanel.tsx
│   │   │   │   ├── ShapWaterfall.tsx
│   │   │   │   ├── SideNavBar.tsx
│   │   │   │   ├── StallGrid.tsx
│   │   │   │   └── StressSandbox.tsx
│   │   │   └── ui/
│   │   ├── context/
│   │   │   ├── AuthContext.tsx
│   │   │   ├── DataContext.tsx
│   │   │   └── TariffContext.tsx
│   │   ├── pages/
│   │   │   ├── BatchAnalysis.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   ├── SandboxPage.tsx
│   │   │   ├── ShapPage.tsx
│   │   │   └── VehicleTariffLab.tsx
│   │   ├── services/
│   │   │   └── api.ts
│   │   ├── types/
│   │   │   └── telemetry.ts
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── main.tsx
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.ts
├── docs/
│   ├── AUDIT_REPORT.md
│   ├── debugging_notes.md
│   └── Ev charging surge predictor spec.md
├── .gitignore
└── README.md
3. Machine Learning & Feature Engineering Specification
3.1 Mathematical Formulation

The core predictive objective is to forecast total charging station power demand $\hat{y}_{t+2h} \in \mathbb{R}^+$ two hours into the future ($t + 120\text{ min}$):

$$\hat{y}_{t+2h} = f(X_t, X_{t-\Delta t}, W_t, T_t, G_t)$$

Where:
* $X_t$ — Current station charging state (active plug count $p_t \in [0, 8]$, instantaneous load draw in kW)
* $X_{t-\Delta t}$ — Historical station load lags ($t-15\text{m}$, $t-30\text{m}$, $t-45\text{m}$, $t-60\text{m}$)
* $W_t$ — Environmental weather telemetry (ambient temperature in $^\circ\text{C}$, humidity)
* $T_t$ — Local traffic inflow index ($0 - 100$) and corridor vehicle density
* $G_t$ — Baseline electrical grid stability metrics (grid frequency in Hz, nominal 60.0 Hz)

3.2 Feature Pipeline

**Cyclical Time Transformations:**
To avoid artificial boundary discontinuities between 23:59 and 00:00, temporal coordinates are projected onto continuous orthogonal trigonometric dimensions:

$$\text{Hour}_{\sin} = \sin\left(\frac{2\pi \cdot \text{hour}}{24}\right), \quad \text{Hour}_{\cos} = \cos\left(\frac{2\pi \cdot \text{hour}}{24}\right)$$

$$\text{Day}_{\sin} = \sin\left(\frac{2\pi \cdot \text{day}}{7}\right), \quad \text{Day}_{\cos} = \cos\left(\frac{2\pi \cdot \text{day}}{7}\right)$$

**Lag & Rolling Statistical Features:**
* **Historical Station Lags:** $\text{Load}_{t-15m}, \text{Load}_{t-30m}, \text{Load}_{t-45m}, \text{Load}_{t-60m}$
* **Rolling Mean (60 min):**
  $$\mu_{60} = \frac{1}{4} \sum_{i=0}^{3} \text{Load}_{t-15i\text{m}}$$
* **Rolling Standard Deviation (60 min):**
  $$\sigma_{60} = \sqrt{\frac{1}{4} \sum_{i=0}^{3} (\text{Load}_{t-15i\text{m}} - \mu_{60})^2}$$
* **Plug-in Rate of Change (15 min):**
  $$\Delta \text{Plugs}_{15m} = \text{Plugs}_t - \text{Plugs}_{t-15m}$$

3.3 Comparative Model Evaluation Framework

| Metric | Primary Model (XGBoost) | Secondary Model (LSTM Sequence) |
| :--- | :--- | :--- |
| **Model Architecture** | Gradient Boosted Decision Trees | 2-Layer LSTM (64 hidden units) + Dense |
| **Target Function** | Regressor (RMSE Loss) | Sequential MSE Loss |
| **Inference Latency** | ~0.48 ms | ~0.59 ms |
| **Mean Absolute Error (MAE)** | 8.81 kW | 7.23 kW |
| **Root Mean Squared Error (RMSE)** | 11.11 kW | 9.06 kW |
| **Surge Recall (> 85% Capacity)** | 91.5% | 100.0% |
| **Explainability Engine** | Exact Shapley Values (TreeSHAP) | Integrated Gradients |
4. REST API & Data Contracts Specification
4.1 POST /api/v1/predict

Calculates predicted load and recommended grid mitigation policies.

Request Body:

json
{
  "timestamp": "2026-08-19T14:00:00Z",
  "ambient_temp_c": 36.5,
  "traffic_inflow_index": 82,
  "active_plugs": 7,
  "grid_frequency_hz": 59.92,
  "load_lags_kw": [142.0, 158.5, 175.0, 192.0]
}

Response (200 OK):

json
{
  "predicted_load_kw": 224.6,
  "transformer_capacity_kw": 250.0,
  "capacity_utilization_pct": 89.84,
  "surge_status": "CRITICAL",
  "recommended_actions": {
    "dynamic_tariff_multiplier": 1.45,
    "throttle_active": true,
    "per_stall_cap_kw": 60.0,
    "shed_stalls": [4, 7]
  },
  "inference_latency_ms": 0.48
}
4.2 POST /api/v1/explain

Returns real-time local feature attribution for the current prediction.

Response (200 OK):

json
{
  "base_value_kw": 120.0,
  "predicted_value_kw": 224.6,
  "attributions": [
    { "feature": "ambient_temp_c", "value": 36.5, "shap_delta_kw": 42.1 },
    { "feature": "traffic_inflow_index", "value": 82, "shap_delta_kw": 31.5 },
    { "feature": "load_lag_15m", "value": 192.0, "shap_delta_kw": 24.2 },
    { "feature": "grid_frequency_hz", "value": 59.92, "shap_delta_kw": 6.8 }
  ]
}
4.3 POST /api/v1/simulate

Executes user-driven stress tests by perturbing input vectors.

Request Body:

json
{
  "temp_delta_c": 5.0,
  "traffic_surge_pct": 25.0,
  "forced_outage_stalls": [2, 5]
}

Response (200 OK):

json
{
  "simulation_id": "sim_98234",
  "baseline_peak_kw": 185.0,
  "simulated_peak_kw": 238.4,
  "peak_time_delta_min": 120,
  "surge_risk": "CRITICAL",
  "timeline": [
    { "timestamp": "14:00", "baseline_kw": 140, "simulated_kw": 140 },
    { "timestamp": "15:00", "baseline_kw": 165, "simulated_kw": 195 },
    { "timestamp": "16:00", "baseline_kw": 185, "simulated_kw": 238 }
  ],
  "dispatched_mitigations": {
    "dynamic_tariff_multiplier": 1.6,
    "throttled_stalls": [1, 3, 4]
  }
}
4.4 GET /api/v1/metrics

Returns comparative benchmark metrics for the primary and secondary models (powers the Model Comparison utility tile).

Response (200 OK):

json
{
  "models": [
    {
      "name": "XGBoost Regressor (Primary)",
      "mae_kw": 8.81,
      "rmse_kw": 11.11,
      "surge_recall_pct": 91.5,
      "latency_ms": 0.48
    },
    {
      "name": "PyTorch LSTM Sequence (Benchmark)",
      "mae_kw": 7.23,
      "rmse_kw": 9.06,
      "surge_recall_pct": 100.0,
      "latency_ms": 0.59
    }
  ]
}
4.5 POST /api/v1/predict/batch

Accepts a CSV of historical telemetry rows and runs the model across all of them — powers the new Batch Analysis view (CSV upload → bulk predictions → actual-vs-predicted chart + downloadable results).

Request: multipart/form-data, field name file, a CSV with columns matching the live telemetry schema, plus an optional actual_kw column (which must represent the target load 2 hours ahead, i.e., at t+2h):

timestamp,ambient_temp_c,traffic_inflow_index,active_plugs,grid_frequency_hz,load_lag_15m,load_lag_30m,load_lag_45m,load_lag_60m,actual_kw
2026-08-19T14:00:00Z,36.5,82,7,59.92,142.0,158.5,170.0,175.0,175.0
2026-08-19T14:15:00Z,36.8,79,7,59.91,148.0,142.0,158.5,170.0,236.0
...

Response (200 OK):

```json
{
  "batch_id": "batch_5521",
  "rows_processed": 288,
  "rows_failed": 0,
  "summary": {
    "peak_predicted_kw": 241.7,
    "peak_timestamp": "2026-08-19T18:15:00Z",
    "critical_events_count": 6,
    "avg_mae_vs_actual_kw": 6.9
  },
  "predictions": [
    { "timestamp": "2026-08-19T14:00:00Z", "actual_kw": 175.0, "predicted_kw": 181.2, "surge_status": "NORMAL" },
    { "timestamp": "2026-08-19T18:15:00Z", "actual_kw": 236.0, "predicted_kw": 241.7, "surge_status": "CRITICAL" }
  ],
  "download_url": "/api/v1/predict/batch/download/batch_5521"
}
```

Error (422) — schema mismatch:

```json
{
  "detail": {
    "message": "Missing required columns",
    "expected_columns": ["load_lag_45m"]
  }
}
```

4.6 GET /api/v1/tariff/vehicle-options

Returns the catalog of supported vehicle categories with baseline power draw (kW), demand-response pricing multipliers, and display labels.

Response (200 OK):

```json
{
  "vehicle_options": [
    {
      "vehicle_type": "two_wheeler",
      "label": "Two-Wheeler EV (e.g., Ola S1)",
      "avg_power_kw": 1.2,
      "multiplier": 0.85
    },
    {
      "vehicle_type": "standard_4w",
      "label": "Standard 4W EV (e.g., Tata Nexon EV)",
      "avg_power_kw": 7.2,
      "multiplier": 1.00
    },
    {
      "vehicle_type": "fast_charging",
      "label": "Fast-Charging EV (e.g., MG ZS EV DC)",
      "avg_power_kw": 45.0,
      "multiplier": 1.35
    }
  ]
}
```

4.7 POST /api/v1/tariff/vehicle-adjusted

Calculates the final effective surge tariff multiplier for a specific vehicle class given the station's base surge tariff multiplier. Safely falls back to `standard_4w` if `vehicle_type` is invalid or missing.

Request Body:

```json
{
  "base_surge_multiplier": 1.45,
  "vehicle_type": "fast_charging"
}
```

Response (200 OK):

```json
{
  "vehicle_type": "fast_charging",
  "vehicle_label": "Fast-Charging EV (e.g., MG ZS EV DC)",
  "avg_power_kw": 45.0,
  "base_surge_multiplier": 1.45,
  "vehicle_multiplier": 1.35,
  "final_effective_multiplier": 1.96,
  "applied_rule": "Base multiplier (1.45x) scaled by Fast-Charging EV factor (1.35x) = 1.96x"
}
```
5. UI/UX & Component Hierarchy Specification
5.1 Design Concept — "Grid Pulse"

A dark, control-room / mission-control aesthetic built for 24×7 monitoring — the same visual language used by NOC dashboards, trading terminals, and EV telemetry cockpits, but softened with a bento-grid layout and glassmorphism cards so it reads as a modern SaaS product rather than a raw industrial panel. The theme should feel like electricity itself: near-black surfaces, electric-cyan/violet glow accents, and live pulsing motion tied to real grid state — not decorative animation.

Guiding principles (from current dashboard design practice):

Dark-first, not inverted-light: dedicated dark palette with its own shadows, borders, and elevation — not a light theme with colors flipped.
Bento-grid composition: the dashboard is built from modular tiles of 3 sizes (Hero, Utility, Micro) rather than a rigid table layout — easy to scan, easy to demo, easy to extend for a viva walkthrough.
Status via color + icon + motion, never color alone (accessibility — colorblind-safe).
Progressive disclosure: the grid shows the signal (KPI + trend), a click/hover reveals the noise (full detail).
5.2 Color System

| Token | Hex / Value | Usage |
| :--- | :--- | :--- |
| `--bg-base` | `#07080c` | App canvas background |
| `--bg-surface` | `#0f1117` | Bento card and tile background |
| `--bg-glass` | `rgba(255,255,255,0.04)` + `backdrop-blur(16px)` | Glassmorphic panels (sandbox, modals) |
| `--border-subtle` | `rgba(255,255,255,0.08)` | Card borders and tile dividers |
| `--text-primary` | `#f4f6fb` | Headings, hero KPI numbers |
| `--text-secondary` | `#9aa4b8` | Metric labels, subcaptions, timestamps |
| `--accent-electric` | `#22d3ee` (cyan) | Primary accent — active states, links, live data lines |
| `--accent-violet` | `#8b5cf6` (violet) | Secondary accent — forecast/predicted series, AI/SHAP elements |
| `--status-normal` | `#10b981` (emerald) | Safe load utilization (< 65%) |
| `--status-warning` | `#f59e0b` (amber) | Elevated load warning (65–85%) |
| `--status-critical` | `#f43f5e` (rose, glow `0 0 24px rgba(244,63,94,0.45)`) | Critical surge overload (> 85%) — pulsing glow |

Gradients: use subtle cyan→violet linear gradients on the Hero forecast tile and chart fills (`linear-gradient(135deg, rgba(34,211,238,0.08), rgba(139,92,246,0.08))`) to avoid a flat look.

5.3 Typography
Headings / KPI numbers: Space Grotesk or Sora (geometric, technical feel) — tabular-nums for all numeric KPIs so digits don't jitter on live updates.
Body / labels: Inter — 13–14px for labels, 24–32px bold for hero numbers.
Monospace accents (optional, for timestamps/latency figures): JetBrains Mono — reinforces the "terminal" feel without overusing it.
5.4 Bento-Grid Layout Architecture
┌──────────────────────────────────────────────────────────────────────────┐
│ Top Bar (sticky, glass): ⚡ Live Grid Freq | Ambient Temp | Auto/Manual   │
│                           toggle | Connection status dot (pulsing)       │
├───────────────────────────────────────────┬──────────────────────────────┤
│ HERO TILE (span 2×2, glow border)         │ UTILITY: Capacity Gauge       │
│ 24-Hour Load Timeline                     │ (radial dial 0–100%,          │
│ Actual (solid cyan) vs. 2h Forecast       │ animated needle, color zones) │
│ (dashed violet, animated draw-in)         │──────────────────────────────│
│ + inline surge-threshold band overlay     │ UTILITY: Surge Status Card    │
│                                            │ (big status pill + pulsing   │
│                                            │  ring; CRITICAL = shake+glow)│
├───────────────────────────────────────────┼──────────────────────────────┤
│ UTILITY: Model Comparison                 │ UTILITY: Dynamic Tariff Card  │
│ (XGBoost vs LSTM toggle chips,            │ (multiplier as animated       │
│  overlaid line chart)                     │  counter, e.g. ×1.00 → ×1.45) │
├───────────────────────────────────────────┴──────────────────────────────┤
│ HERO TILE: Live SHAP Waterfall (span full width)                         │
│ Horizontal animated bars building left→right from base value to          │
│ predicted value; hover a bar → tooltip with exact contribution           │
├────────────────────────────────────────────────────────────────────────┤
│ HERO TILE: What-If Stress Sandbox (glass panel)                          │
│ Sliders: Temp Δ / Traffic Surge % / Forced Outage (multi-select stalls)  │
│ → live-recalculates every tile above on drag (debounced)                 │
├────────────────────────────────────────────────────────────────────────┤
│ MICRO GRID: 8-Bay Charging Stall Matrix (responsive card grid)           │
│ Each stall = mini card: bay #, kW draw, animated fill bar, state badge   │
│ (Active / Throttled / Idle / Shed) — throttled/shed stalls pulse amber/red│
└────────────────────────────────────────────────────────────────────────┘

Grid mechanics: CSS Grid, 12-column desktop template, tiles span 2×2 (Hero), 1×1 or 2×1 (Utility), 1×1 (Micro). Collapses to single-column stacked cards on tablet/mobile, sandbox sliders become a bottom sheet.

5.5 Signature Interactive Elements

| Element | Behavior |
| :--- | :--- |
| **Pulsing Status Ring** | A soft radial glow around the Surge Status card pulses at a rate tied to `capacity_utilization_pct` — slow pulse when Normal, fast pulse when Critical. Pure CSS `@keyframes` animation. |
| **Animated Forecast Line** | The 2-hour projected segment draws itself in (`stroke-dashoffset` animation) each time a new prediction lands, visually extending the curve. |
| **Live SHAP Waterfall** | Bars animate from 0 to their `shap_delta_kw` width on load/update; color-coded green (pulls load down) vs. rose (pushes load up); clicking a bar pins its tooltip. |
| **Stress Sandbox Sliders** | Interactive slider inputs for Temp Δ, Traffic Surge %, and Forced Outages; dynamically recalculates metrics and persists values across navigation. |
| **Stall Matrix Micro-Cards** | Each charging stall displays live kW draw, animated fill bar, and state badge (Active, Throttled, Idle, Shed) with amber/red glow on throttled or shed stalls. |
| **Connection / Latency Dot** | Small pulsing dot in the top bar (green = live, amber = degraded) displaying `inference_latency_ms` on hover. |
5.6 Motion & Micro-interaction Guidelines
Use Framer Motion (React) for tile entrance (staggered fade+slide-up on load) and value transitions (animate on number changes via a useSpring/count-up hook).
Hover on any tile: transform: scale(1.015) + border brightens to --accent-electric — signals interactivity per current bento-grid best practice.
Keep backdrop-filter: blur() glass effects only on 2–3 tiles (Hero panels), not the whole grid — heavy blur across many tiles causes frame drops on low-end laptops (a real risk for a viva demo machine).
Respect prefers-reduced-motion: fall back to instant value updates, no pulsing.
5.7 Accessibility Checklist
Every tile has an aria-label describing the metric, not just a bare number (e.g. aria-label="Predicted load: 224.6 kilowatts, Critical").
Color contrast ≥ 4.5:1 for body text on dark surfaces — avoid light-grey-on-dark-grey glass text; test with the Chrome DevTools contrast checker.
Status is always paired with text/icon (⚠ Warning / ⛔ Critical), never color alone.
All interactive tiles (sliders, toggles, stall cards) have visible keyboard focus rings in --accent-electric.
5.8 New View — Batch Analysis (CSV Upload & Predict)

A 4th sidebar item alongside Control Center / SHAP Explainability / Sandbox, powered by /api/v1/predict/batch.

┌──────────────────────────────────────────────────────────────────────────┐
│  📁  Batch Analysis                                                       │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │   Drag & drop a CSV, or click to browse                              │  │
│  │   (dashed border, glows cyan on drag-over)                           │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│  Sample columns required: timestamp, ambient_temp_c, traffic_inflow_...  │
├──────────────────────────────────────────────────────────────────────────┤
│  Summary strip (appears after upload):                                   │
│  [ Rows: 288 ]  [ Peak Predicted: 241.7 kW ]  [ Critical Events: 6 ]     │
├──────────────────────────────────────────────────────────────────────────┤
│  Actual vs Predicted overlay chart (full width, cyan=actual,             │
│  violet dashed=predicted, red dots mark CRITICAL rows)                   │
├──────────────────────────────────────────────────────────────────────────┤
│  Results table (virtualized/paginated) + "Download Results CSV" button   │
└──────────────────────────────────────────────────────────────────────────┘
Upload states: idle → uploading (progress bar) → processing (skeleton chart) → results.
Failed rows or schema errors surface as an inline red banner listing the missing columns (matches the 422 error shape in Section 4.5), not a silent failure.
"Download Results CSV" hits download_url from the response — lets operators hand back an annotated CSV as a deliverable, useful for a report/viva appendix.

5.9 Page 5 — Vehicle Tariff Lab (Multi-Class Dynamic Billing)

A 5th navigation item (`/tariff-lab`) linked via `SideNavBar.tsx`, integrating socio-economic and fleet charging equity with real-time surge pricing:

┌──────────────────────────────────────────────────────────────────────────┐
│  ⚡ Vehicle-Adjusted Tariff Lab                                           │
│  [ SIMULATION ACTIVE / LIVE BADGE ]  Base Multiplier: 1.45x              │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────┐ ┌────────────────────┐ ┌──────────────────────┐  │
│  │ Two-Wheeler EV     │ │ Standard 4W EV     │ │ Fast-Charging DC     │  │
│  │ (e.g. Ola S1)      │ │ (e.g. Nexon EV)    │ │ (e.g. MG ZS EV)      │  │
│  │ Avg Power: 1.2 kW  │ │ Avg Power: 7.2 kW  │ │ Avg Power: 45.0 kW   │  │
│  │ Factor: 0.85x      │ │ Factor: 1.00x      │ │ Factor: 1.35x        │  │
│  │ Effective: 1.23x   │ │ Effective: 1.45x   │ │ Effective: 1.96x     │  │
│  └────────────────────┘ └────────────────────┘ └──────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────┤
│  Formula Breakdown: Base Surge Multiplier × Vehicle Factor               │
│  Dynamic Comparison Cards with color-coded severity & animation          │
└──────────────────────────────────────────────────────────────────────────┘

- **State Reactivity:** Connected to `TariffContext.tsx`. When a simulation is applied in the Sandbox, the amber pulsing "SIMULATION ACTIVE" badge activates, and all 3 vehicle category rates recompute in real-time.
- **Graceful Fallback:** Backend endpoint `/api/v1/tariff/vehicle-adjusted` falls back safely to `standard_4w` if an unknown category is submitted.

6. AI Agent Guidelines & Execution Roadmap (CLAUDE.md)
6.1 Agent Execution Protocol
Strict Schema Compliance: All backend endpoints must strictly validate input/output using Pydantic models matching Section 4.
Deterministic Fallback: Always include offline mock responses inside services/api.ts to prevent UI breakage during live presentations.
No Dead Code: Implement all UI controls to trigger active state modifications or API recalculations.
6.2 Agent Execution Roadmap & Commands
Environment & Dependency Initialization

```bash
# Backend Setup
python -m venv venv && source venv/bin/activate  # or .venv\Scripts\Activate.ps1 on Windows
pip install -r requirements.txt
python seed_users.py

# Frontend Setup
cd frontend && npm install
npm run dev
```

Phase Breakdown for Agent Tasks
Phase 1 — ML Engine: Build pipeline/train.py to synthesize telemetry, train the XGBoost model, compute TreeSHAP values, and export .joblib artifacts (xgboost_model.joblib, scaler.joblib).
Phase 2 — FastAPI Routes: Implement app/main.py with the /predict, /explain, /simulate, /metrics, and /auth routes, each validated against the Pydantic schemas in Section 4.
Phase 3 — Bento React Dashboard: Build the dark-mode "Grid Pulse" layout (Section 5) using Recharts for the timeline/waterfall charts and Framer Motion for tile transitions and the What-If sandbox sliders.
Phase 4 — Offline Fallback & Test: Add static demo fixtures inside frontend/src/services/mockData.ts so the dashboard runs off mock data with zero backend dependency — critical for 100% uptime during live judging or a viva demo.
Phase 5 — Batch Analysis (CSV Upload & Predict): Implement POST /api/v1/predict/batch (pandas CSV parsing → bulk model inference → summary stats) and the corresponding BatchAnalysis.tsx view (dropzone, upload/processing states, actual-vs-predicted chart, results table, CSV export).
Phase 6 — Vehicle-Adjusted Tariff & Cross-Page State Persistence: Implement app/routers/tariff.py and app/services/vehicle_tariff.py for tiered pricing; wrap frontend in TariffContext.tsx; build VehicleTariffLab.tsx (Page 5); and persist Sandbox slider parameters across navigation transitions.