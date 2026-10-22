# EV Surge Predictor (Grid Pulse)

> **Predictive Load Forecasting & Autonomous Demand-Response Throttling Platform for Commercial EV Charging Stations**

[![React](https://img.shields.io/badge/React-19.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.141-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![XGBoost](https://img.shields.io/badge/XGBoost-3.4-EB4034?style=for-the-badge&logo=xgboost&logoColor=white)](https://xgboost.readthedocs.io/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

---

## ⚡ 30-Second Overview

**Grid Pulse** is a full-stack smart load forecasting and autonomous grid protection system for commercial EV charging plazas. Ingesting multi-variable tabular telemetry (past load lags, corridor traffic inflow, grid frequency, and live ambient temperature), Grid Pulse predicts localized energy surges **2 hours in advance**, adjusts dynamic tariffs, and autonomously dispatches bay throttling and load shedding before transformer capacity (250 kW) is breached.

---

## 🌐 Live Demo & Demo Credentials

🔗 **Live Deployment:** [[LIVE_DEMO_URL]](https://github.com/souls-29/ev-surge-predictor) *(Configure via `VITE_API_URL`)*

The system automatically initializes an SQLite database and seeds default accounts on first startup:

| Role | Username | Password | Access Level & Permissions |
| :--- | :--- | :--- | :--- |
| **Station Operator** | `operator` | `operatorpassword123` | **Full Read/Write:** Run stress simulations, adjust throttling parameters, trigger automated load shedding, export audit reports |
| **Station Viewer** | `viewer` | `viewerpassword123` | **Read-Only:** View live KPIs, load forecast curves, SHAP explainability waterfall, model benchmarks, and tariff matrices |

---

## 📸 Dashboard Preview

### 1. Control Center (Operational Overview & 24h Forecast)
![](docs/screenshots/control-center.png)

### 2. Live TreeSHAP Waterfall (Explainability & Feature Attribution)
![](docs/screenshots/shap.png)

### 3. Stress Testing Sandbox (What-If Grid Telemetry Simulation)
![](docs/screenshots/sandbox.png)

### 4. Batch Analysis (Historical CSV Ingestion & 2h Ahead Inference)
![](docs/screenshots/batch.png)

### 5. Vehicle Tariff Lab (Category-Calibrated Demand-Response Pricing)
![](docs/screenshots/tariff-lab.png)

---

## 🚀 Key Features

### 1. Real-Time Surge Prediction & Control Center (`/`)
* **2-Hour Lookahead Forecasting:** Continuous prediction of station aggregate power demand ($\text{kW}$) compared against the 250 kW transformer physical limit.
* **Radial Utilization KPIs:** Live visual capacity gauge with automated threshold banding: **Normal** (<65%), **Warning** (65–80%), and **Critical Surge** (≥80% / 200 kW).
* **Autonomous Grid Safeguards:** Prescriptive operator guidance recommending power throttling ($60.0\text{ kW}$ stall caps) and non-critical bay shedding when overload is imminent.

### 2. Transparent TreeSHAP Explainability (`/shap`)
* **Local Feature Attribution:** Every prediction is decomposed in real-time into exact additive contributions across 15 temporal, grid, and weather features.
* **Provable Mathematical Additivity:** Live card footer verifies TreeSHAP's efficiency property:
  $$\text{Base Value } (E[f(x)]) + \sum_{i=1}^{15} \phi_i = \text{Final Model Prediction } (f(x))$$
* **Dynamic Contributing Driver Identification:** Automatic detection and natural language synthesis of the top contributing drivers behind every prediction spike.

### 3. What-If Stress Simulation Sandbox (`/sandbox`)
* **Operator Scenario Modeling:** Interactive control sliders for ambient temperature ($\Delta T$), traffic corridor surge ($\% \text{ increase}$), and forced stall outages ($0\text{--}8\text{ bays}$).
* **Dynamic Bay Status Matrix:** Live 8-bay physical stall matrix visualizing real-time load distribution, automated throttling flags, and load-shedding states.
* **Cross-Session Persistence:** Sliders and scenario multipliers persist across route navigation through a dedicated `TariffContext`.

### 4. Batch Telemetry Ingestion (`/batch`)
* **Drag-and-Drop CSV Processing:** High-throughput batch pipeline calculating 15 engineered features across multi-day telemetry logs.
* **Surge Anomaly Tagging:** Immediate categorization of future high-risk timestamps exceeding the 200 kW safety ceiling.
* **Audit CSV Export:** Downloadable annotated CSV reports with predicted loads, capacity utilization percentages, and surge trigger flags.

### 5. Vehicle-Adjusted Tariff Lab (`/tariff-lab`)
* **Vehicle Category Calibration:** Tiered demand-response dynamic pricing adjusted by vehicle power draw:
  * **Tier 1 (Two-Wheeler EV):** $0.85\times$ base multiplier ($1.2\text{ kW}$ avg draw)
  * **Tier 2 (Standard 4W EV):** $1.00\times$ base multiplier ($7.2\text{ kW}$ avg draw)
  * **Tier 3 (DC Fast Charger):** $1.35\times$ base multiplier ($45.0\text{ kW}$ avg draw)
* **Real-Time Synchronized Rates:** Real-time synchronization between Sandbox stress multipliers and individual vehicle charging tariffs.

### 6. Role-Based Access Control (RBAC) & PDF Report Generation
* **Enterprise Security:** JWT sessions (HS256) with `bcrypt` password hashing, token expiration, and permission-gated controls.
* **Single-Click Audit PDF:** Comprehensive client-rendered PDF report export with 10 structured sections, live bay matrices, tariff tiers, and authenticated operator audit stamps.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph Client["Frontend Client (React 19 + TypeScript + Vite)"]
        UI["Tailwind CSS + Glassmorphism UI"]
        Pages["5 Interactive Views: Control Center | SHAP | Sandbox | Batch | Tariff Lab"]
        State["TariffContext + DataContext + AuthContext"]
        PDF["Report Generator (html2canvas + jsPDF)"]
    end

    subgraph Server["Backend API (FastAPI + Uvicorn)"]
        Router["API v1 Endpoints & Auth Gate"]
        Security["JWT RBAC + bcrypt CryptContext"]
        Engine["ML Inference Engine (Singleton)"]
        TariffSvc["Vehicle Tariff Engine"]
    end

    subgraph ML["Machine Learning Pipeline"]
        XGB["XGBoost Regressor (Primary: 15 Features)"]
        SHAP["TreeSHAP Explainer"]
        LSTM["PyTorch 2-Layer LSTM (Benchmark)"]
    end

    subgraph DataSources["External Data & Storage"]
        WeatherAPI["Open-Meteo REST API (Live Mumbai Temp)"]
        SQLite[("SQLite Database (app.db - Users & Sessions)")]
        SyntheticGen["synthesize_telemetry() (90-day multi-corridor data)"]
    end

    UI --> State
    State -->|Authenticated Requests (Bearer JWT)| Router
    PDF -.->|Exports Canvas Snapshot| Client

    Router --> Security
    Security --> SQLite
    Router --> TariffSvc
    Router --> Engine
    Router --> WeatherAPI

    Engine --> XGB
    Engine --> SHAP
    Engine -.->|Benchmarking| LSTM
    SyntheticGen -->|Precomputes Artifacts| XGB
```

---

## 🛠️ Tech Stack

| Domain | Technologies & Libraries | Purpose & Implementation Details |
| :--- | :--- | :--- |
| **Frontend** | React 19, TypeScript 5.7, Vite 8.2 | Component architecture, strict type contracts, hot-module reload |
| **Styling & Icons** | Tailwind CSS 4, Lucide React, Google Material Icons | Responsive dark telemetry dashboard, custom design tokens, glassmorphism |
| **Data Viz** | Recharts, html2canvas, jsPDF | Interactive time-series timelines, horizontal waterfall charts, PDF export |
| **Backend** | Python 3.11+, FastAPI 0.141, Uvicorn | Asynchronous REST APIs, dependency injection, OpenAPI documentation |
| **ML & Analytics** | XGBoost 3.4, SHAP 0.52, PyTorch 2.14, Scikit-Learn | Extreme Gradient Boosting regression, TreeSHAP explainer, LSTM sequence model |
| **Data Science** | Pandas, NumPy, Joblib | 15-feature lag/rolling engineering, artifact serialization |
| **Auth & Security** | Python-Jose, Passlib (`bcrypt`), OAuth2 Bearer | JWT token signing, salted password hashing, role-based route guards |
| **Database** | SQLite, SQLAlchemy 2.0 | Lightweight ACID user persistence, automatic schema creation & demo seeding |
| **Telemetry** | Open-Meteo Weather API | Live ambient temperature ingestion for Mumbai coordinates (`19.0760, 72.8777`) |

---

## 📊 Machine Learning Model Benchmarks

Evaluation results measured directly on an identical test split ($N = 1,726$ holdout samples) from the 90-day feature pipeline (`backend/saved_models/`):

| Metric | XGBoost Regressor (Deployed Primary) | PyTorch LSTM Sequence (Benchmark) | Operational Advantage / Analysis |
| :--- | :--- | :--- | :--- |
| **MAE ($\text{kW}$)** | **8.81 kW** | **7.23 kW** | Both models achieve sub-10 kW error on a 250 kW transformer |
| **RMSE ($\text{kW}$)** | **11.11 kW** | **9.06 kW** | Low variance under volatile charging events |
| **Surge Recall ($\%$)** | **91.5%** | **100.0%** | Captures dangerous spikes over the 200 kW (80%) safety ceiling |
| **Inference Latency** | **0.3 ms / sample** | **0.2 ms / sample** | Ultra-low sub-millisecond execution for real-time edge microgrids |
| **Interpretability** | **Full (TreeSHAP exact additivity)** | Black-Box (Neural attention required) | **XGBoost selected as deployed model for regulatory explainability** |

> **Model Selection Rationale:** While PyTorch LSTM leads raw metrics on the synthetic split, **XGBoost is deployed as the active production model** to provide exact mathematical TreeSHAP attributions required for energy utility audits. Promotion of the LSTM model is deferred pending multi-split temporal validation.

---

## 🔍 Data Transparency & Engineering

* **Live Weather Telemetry:** Real-time ambient temperature is fetched from the **Open-Meteo API** for Mumbai (`19.0760° N, 72.8777° E`) with a 10-minute in-memory cache and a operating range of 20°C to 40°C.
* **Synthetic Load & Traffic Corridor Data:** Because commercial EV charging network telemetry in India is proprietary, 90 days ($8,640$ timestamps at 15-minute intervals) of charging load ($25.5\text{--}274.0\text{ kW}$), traffic inflow indices ($0\text{--}100$), grid frequency ($59.8\text{--}60.2\text{ Hz}$), and active plug occupancy are synthetically modeled via `synthesize_telemetry()` using real-world diurnal commuting distributions.
* **15 Engineered Features:**
  * **Environmental:** `ambient_temp_c`
  * **Corridor Traffic & Plugs:** `traffic_inflow_index`, `active_plugs`, `plug_delta_15m`
  * **Grid Electricals:** `grid_frequency_hz`
  * **Historical Load Lags:** `load_lag_15m`, `load_lag_30m`, `load_lag_45m`, `load_lag_60m`
  * **Rolling Windows:** `rolling_mean_60m`, `rolling_std_60m`
  * **Cyclical Trigonometric Time:** `hour_sin`, `hour_cos`, `day_sin`, `day_cos`

---

## 💻 Local Setup & Installation

### Prerequisites
* **Python 3.11+**
* **Node.js 18+ & npm**

### 1. Clone Repository & Setup Environment
```bash
git clone https://github.com/souls-29/ev-surge-predictor.git
cd ev-surge-predictor
```

### 2. Backend Setup
```bash
cd backend

# Create and activate virtual environment
python -m venv venv

# Windows:
.\venv\Scripts\activate
# macOS/Linux:
# source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# (Optional) Re-train models or verify pipeline
python pipeline/train.py

# Setup environment variables
cp .env.example .env

# Start FastAPI server on port 8000
python -m uvicorn app.main:app --port 8000 --reload
```
The API Swagger documentation will be available at: **http://127.0.0.1:8000/docs**

### 3. Frontend Setup
In a new terminal window:
```bash
cd frontend

# Install node dependencies
npm install

# Setup environment variables
cp .env.example .env

# Start Vite dev server on port 5173
npm run dev
```
Open **http://localhost:5173** in your browser and sign in with the Operator or Viewer credentials.

---

## 📡 API Overview

| Method | Endpoint | Access Level | Description | Key Request / Response Parameters |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | Public | System health check & service verification | `{ "status": "ok", "service": "ev-surge-predictor" }` |
| `POST` | `/api/v1/auth/login` | Public | Authenticate user credentials and issue JWT | `username`, `password` $\rightarrow$ `{ "access_token", "role" }` |
| `GET` | `/api/v1/auth/me` | Authenticated | Fetch authenticated user profile & role | Requires Bearer token $\rightarrow$ `{ "username", "role" }` |
| `POST` | `/api/v1/predict` | Authenticated | 2-hour ahead power load forecasting | Telemetry vector $\rightarrow$ `predicted_load_kw`, `surge_risk` |
| `POST` | `/api/v1/explain` | Authenticated | Real-time TreeSHAP feature attributions | Telemetry vector $\rightarrow$ `attributions`, `base_value_kw` |
| `POST` | `/api/v1/simulate` | **Operator Only** | Grid stress what-if simulation | `temp_delta_c`, `traffic_surge_pct`, `outage_stalls` |
| `GET` | `/api/v1/metrics` | Authenticated | Model evaluation benchmark results | `{ "models": [XGBoost metrics, LSTM metrics] }` |
| `POST` | `/api/v1/predict/batch`| Authenticated | Batch CSV telemetry upload & prediction | Multipart CSV $\rightarrow$ Table of predictions & flags |
| `GET` | `/api/v1/predict/batch/download/{batch_id}` | Authenticated | Download annotated batch results CSV | `batch_id` $\rightarrow$ Downloadable CSV file |
| `GET` | `/api/v1/tariff/vehicle-options` | Authenticated | Fetch supported EV categories & specs | Returns 2W, Standard 4W, Fast-Charging definitions |
| `POST` | `/api/v1/tariff/vehicle-adjusted` | Authenticated | Calculate demand-response tariff rate | `base_surge_multiplier`, `vehicle_type` $\rightarrow$ rate |
| `GET` | `/api/v1/weather/current` | Authenticated | Fetch live ambient temperature | Open-Meteo cache $\rightarrow$ `{ "temp_c", "source" }` |

---

## 📂 Repository Structure

```text
ev-surge-predictor/
├── LICENSE                                # MIT Open Source License
├── README.md                              # Project documentation
├── requirements.txt                       # Root python dependencies
│
├── backend/
│   ├── .env.example                       # Backend environment variable template
│   ├── requirements.txt                   # Trimmed, pinned backend dependencies
│   ├── app/
│   │   ├── main.py                        # FastAPI entry point, CORS, startup seeding
│   │   ├── api/v1/                        # API routes (predict, explain, simulate, auth, batch)
│   │   ├── core/                          # Config, SQLite connection, JWT security, weather service
│   │   ├── models/                        # ML inference engine, User model, optimizer logic
│   │   ├── routers/tariff.py              # Dynamic vehicle-adjusted tariff router
│   │   ├── schemas/telemetry.py           # Pydantic request/response validation schemas
│   │   └── services/vehicle_tariff.py     # Vehicle power tiers & demand-response logic
│   ├── pipeline/
│   │   ├── train.py                       # Telemetry synthesizer, feature engineering, XGBoost training
│   │   ├── train_lstm.py                  # PyTorch LSTM 2-layer sequence benchmark trainer
│   │   └── benchmark_models.py            # Comparative evaluation & validation utilities
│   └── saved_models/                      # Tracked ML artifacts (<5 MB: weights, scalers, metrics)
│
├── frontend/
│   ├── .env.example                       # Frontend environment variable template
│   ├── package.json                       # Vite, React 19, Tailwind, Recharts dependencies
│   ├── vite.config.ts                     # Vite build configuration
│   └── src/
│       ├── App.tsx                        # React Router layout & authentication guards
│       ├── components/Dashboard/          # ForecastTimeline, ShapWaterfall, StressSandbox, StallGrid, ReportTemplate
│       ├── context/                       # AuthContext, DataContext, TariffContext
│       ├── pages/                         # ControlCenter, ShapPage, SandboxPage, BatchAnalysis, VehicleTariffLab
│       ├── services/api.ts                # API client with JWT interceptor coverage
│       └── types/telemetry.ts             # TypeScript domain models & interfaces
│
└── docs/
    ├── screenshots/                       # High-resolution dashboard page previews
    ├── AUDIT_REPORT.md                    # Deep-dive system audit & security verification
    └── Ev charging surge predictor spec.md# Mathematical specifications & feature pipeline docs
```

---

## 🗺️ Roadmap & Future Enhancements

- [ ] **Hardware In-the-Loop (HIL) Integration:** Connect OCPP 2.0.1 (Open Charge Point Protocol) handlers for direct physical charger throttles.
- [ ] **Real-Time WebSockets:** Replace 5-second polling intervals with persistent WebSocket connections for sub-second telemetry streaming.
- [ ] **Temporal Cross-Validation Benchmark:** Run rolling walk-forward cross-validation on the PyTorch LSTM sequence model before production promotion.
- [ ] **Prometheus & Grafana Exporters:** Export real-time prediction accuracy, drift metrics, and API latency metrics to standard observability stacks.

---

## 👥 Team & Academic Context

* **Project Lead & Full-Stack / ML Architecture:** **Soham Pawar** ([@souls-29](https://github.com/souls-29))
* **Teammate Contributions:**
  * **Collaborator 1:** Frontend UI/UX, Component Architecture & Glassmorphism System
  * **Collaborator 2:** Telemetry Synthesis, XGBoost Pipeline & TreeSHAP Integration
  * **Collaborator 3:** Database Architecture, SQLite Persistence & JWT RBAC Security
  * **Collaborator 4:** Benchmarking, Evaluation Metrics & Documentation

**Academic Coursework:** Developed for **Bhavan's College — Continuous Internal Assessment 2 (CIA-2)** in Data Science & Machine Learning Applications.
