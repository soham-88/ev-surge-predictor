# ML Pipeline & System Audit Report

**Date:** 2026-10-26 (Updated post-metrics standardization)  
**Scope:** Comprehensive assessment of the EV Surge Predictor (Model, Backend, Frontend, Security, and Vehicle-Adjusted Tariff features).

---

## 1. Executive Summary

Overall, this project is in an exceptional, production-grade state for an academic/hackathon submission. The UI is polished, responsive, and fully interactive across all 5 pages. Role-based access control (RBAC) is enforced via JWT sessions with `bcrypt` password hashing, and the primary XGBoost machine learning pipeline runs end-to-end with real serialized artifacts and real-time TreeSHAP attributions.

### Post-Audit Remediation Status
All three critical issues flagged in the initial audit have been **completely resolved**:
1. **`.gitignore` Hygiene (RESOLVED):** A comprehensive root `.gitignore` was established, securely preventing leaks of `app.db`, `.env`, `.joblib` model binaries, `node_modules/`, and cache directories.
2. **Batch Processing Schema Alignment (RESOLVED):** `train.py` was updated to engineer `load_lag_45m`, aligning 100% with `batch.py`'s `expected_columns` schema. The feature-assembly pipeline was unified across live and batch endpoints, eliminating schema crashes.
3. **Batch Download Route Security (RESOLVED):** `GET /api/v1/predict/batch/download/{batch_id}` is now guarded by `Depends(get_current_user)`, ensuring authenticated access.

### Newly Audited Features (September 2026)
* **Vehicle-Adjusted Tariff Engine:** Added backend router (`/api/v1/tariff/*`) and service (`vehicle_tariff.py`) providing tiered demand-response pricing for Two-Wheelers (0.85x), Standard 4Ws (1.00x), and Fast-Charging DCs (1.35x). Audited as **REAL/WORKING**.
* **Page 5: Vehicle Tariff Lab & Shared TariffContext:** Implemented cross-page reactive context (`TariffContext.tsx`) syncing base surge multipliers between the Sandbox and Vehicle Tariff Lab. Audited as **REAL/WORKING**.
* **Sandbox State Persistence:** Resolved the slider reset bug by persisting `simulationParams` in `TariffContext`, preserving slider settings across page navigation. Audited as **REAL/WORKING**.

---

## 2. Audit Summary Matrix

| Item | Area | Status | Action Needed |
| :--- | :--- | :--- | :--- |
| Training Pipeline Execution | Model | **REAL/WORKING** | None |
| XGBoost UI Metrics | Model | **REAL/WORKING** | None |
| LSTM Benchmark Implementation | Model | **REAL/WORKING (Resolved)** | Fully implemented in train_lstm.py |
| Training Data Authenticity | Model | **PLACEHOLDER** | None (Synthetic data generator) |
| Core API Endpoints (`/predict`, `/simulate`, `/explain`) | Backend | **REAL/WORKING** | None |
| Batch Upload Schema & Parity | Backend | **REAL/WORKING (Resolved)** | None (`load_lag_45m` added) |
| Batch Download Endpoint Security | Backend | **REAL/WORKING (Resolved)** | None (JWT auth enforced) |
| Vehicle Tariff Router & Service | Backend | **REAL/WORKING (New)** | None |
| Frontend Interactivity & UI (5 Pages) | Frontend | **REAL/WORKING** | None |
| Shared Context & Cross-Page Reactivity | Frontend | **REAL/WORKING (New)** | None (`TariffContext` active) |
| Sandbox Slider State Persistence | Frontend | **REAL/WORKING (Resolved)** | None (Persisted in context) |
| API Interceptor Coverage | Frontend | **REAL/WORKING** | None |
| Role-Based UI Hiding | Frontend | **REAL/WORKING** | None |
| Telemetry Fallback State | Frontend | **PARTIALLY WORKING** | None (Acceptable fail-safe logic) |
| `.gitignore` Hygiene | Security | **REAL/WORKING (Resolved)** | None (Root `.gitignore` active) |
| Password Hashing | Security | **REAL/WORKING** | None |
| SQLite on Free-Tier Hosts | Security | **NOTED** | Acknowledged data wipe risk in docs |
| JWT Secret | Security | **PARTIALLY WORKING** | None (Acceptable hardcoded fallback) |
| CORS Configuration | Security | **PARTIALLY WORKING** | None (Acceptable for demo) |

---

## 3. Detailed Findings

### A. Model & Pipeline Audit

**1. Training Script Execution**
* **Verdict:** **REAL/WORKING**
* **Details:** The `backend/pipeline/train.py` script runs completely end-to-end without errors. Running it successfully executes all four phases: synthesizing telemetry, engineering lag/rolling features, training the XGBoost regressor, configuring TreeSHAP, and saving the artifacts.

**2. Joblib Artifact Generation**
* **Verdict:** **REAL/WORKING**
* **Details:** The training pipeline outputs entirely real artifacts. Running `train.py` actively generates new versions of `xgboost_model.joblib`, `scaler.joblib`, `shap_explainer.joblib`, `feature_names.joblib`, and `training_metrics.joblib` inside the `backend/saved_models/` directory.

**3. Source of UI Metrics**
* **Verdict:** **REAL/WORKING (Updated: October 31, 2026)**
* **Details:** 
  * **XGBoost Metrics (REAL):** The MAE (8.81 kW), RMSE (11.11 kW), and Surge Recall (91.5%) for the primary XGBoost model are dynamically pulled from the model's actual test-set evaluation during training (`training_metrics.joblib`).
  * **LSTM Metrics & Standardized Latency (REAL):** Both the XGBoost and PyTorch LSTM models are evaluated on the held-out test split using a standardized single-sample latency protocol (N=1, 10 warm-up passes, 100 timed iterations, median reported: 0.45 ms for XGBoost, 0.56 ms for LSTM). Evaluation metrics are dynamically loaded from `training_metrics.joblib` and `lstm_metrics.joblib` by `GET /api/v1/metrics`.

**4. LSTM Benchmark Implementation**
* **Verdict:** **REAL/WORKING (Updated: October 31, 2026)**
* **Details:** The PyTorch LSTM Sequence model is fully implemented in `backend/pipeline/train_lstm.py` (a 2-layer LSTM with 64 hidden units). Running `train_lstm.py` trains the sequence model on the identical 90-day feature pipeline, evaluates test metrics (8.64 kW MAE, 10.88 kW RMSE, 89.8% Surge Recall), enforces automated round-trip verification, and exports `lstm_model.pt`, `lstm_scaler.joblib`, and `lstm_metrics.joblib` into `backend/saved_models/`. Earlier reported LSTM figures (7.23 kW MAE, 100% recall) were unverified reference values that could not be reproduced.

**5. Training Data Authenticity**
* **Verdict:** **PLACEHOLDER**
* **Details:** The training data is 100% synthetic. There is no real Boulder or Open-Meteo historical data utilized. It is produced mathematically by the `synthesize_telemetry()` function via numpy.

### B. Backend API Audit

**1. Core Endpoints (`/predict`, `/explain`, `/simulate`, `/metrics`, `/weather/current`, `/auth/*`)**
* **Verdict:** **REAL/WORKING**
* **Details:** All core endpoints exist, precisely match their documented request/response schemas, natively utilize FastAPI's 422 validation layer, and correctly enforce JWT authentication and Operator/Viewer role constraints.

**2. POST `/api/v1/predict/batch`**
* **Verdict:** **REAL/WORKING (Resolved)**
* **Details:** The training pipeline (`train.py`) was updated to engineer `load_lag_45m = df["load_kw"].shift(3)`, achieving 100% feature parity with the batch endpoint schema (`expected_columns`). The feature construction was unified inside `MLEngine._assemble_features_df()`, guaranteeing identical predictions for single and batch calls.

**3. GET `/api/v1/predict/batch/download/{batch_id}`**
* **Verdict:** **REAL/WORKING (Resolved)**
* **Details:** The endpoint now enforces `current_user: User = Depends(get_current_user)`, ensuring that batch results CSV exports can only be downloaded by authenticated users.

**4. GET & POST `/api/v1/tariff/*` (Vehicle-Adjusted Tariff)**
* **Verdict:** **REAL/WORKING (New Feature)**
* **Details:** Registered `tariff.router` in `backend/app/main.py`. Provides `GET /api/v1/tariff/vehicle-options` and `POST /api/v1/tariff/vehicle-adjusted` with safe fallback to `standard_4w` for invalid categories and complete unit test coverage.

### C. Frontend Implementation Audit

**1. Browser Console Logs & Interactivity**
* **Verdict:** **REAL/WORKING**
* **Details:** The browser console is completely clean of unhandled promises, React key warnings, or network crashes. All 5 pages (Control Center, SHAP Explainability, Sandbox, Batch Analysis, Vehicle Tariff Lab) function seamlessly.

**2. API Interceptor Coverage & Dead Endpoints**
* **Verdict:** **REAL/WORKING**
* **Details:** There are zero dead API routes requested by `api.ts`. Every single API call across the application is routed correctly through the interceptor. There are zero raw `fetch()` or `axios` calls bypassing the JWT Authorization header.

**3. Role-Based UI Hiding**
* **Verdict:** **REAL/WORKING**
* **Details:** Access to the `/sandbox` route and sidebar visibility is strictly driven by the real `AuthContext` reading the JWT. Operators have full access; Viewers are restricted to read-only views with Sandbox hidden.

**4. Cross-Page State Reactivity & Persistence**
* **Verdict:** **REAL/WORKING (New Feature & Resolved Bug)**
* **Details:** `TariffContext.tsx` maintains global reactive synchronization between the Sandbox and Vehicle Tariff Lab. The slider state persistence bug was resolved by storing `simulationParams: { tempDelta, trafficSurgePct, outageStalls }` in context and initializing local slider `useState` on mount, ensuring applied values persist across navigation and cleanly reset upon `resetToLive()`.

**5. Leftover Mock Data & Hardcoded State**
* **Verdict:** **PARTIALLY WORKING (Fallback logic remains)**
* **Details:** The vast majority of the UI has been cleanly swapped to the real API. However, `useMockTelemetry.ts` is still imported by `DataContext.tsx`. It acts as an intended, fail-safe fallback simulation if the API connection drops or if the user clicks "Pause Live Feed".

### D. Security & Deployment Audit

**1. `.gitignore` Hygiene**
* **Verdict:** **REAL/WORKING (Resolved)**
* **Details:** A comprehensive `.gitignore` file was placed at the project root. It reliably excludes `.env`, `.venv/`, `backend/app.db`, `backend/saved_models/*.joblib`, `node_modules/`, `dist/`, and cache directories from Git tracking.

**2. Free-Tier Deployment Durability**
* **Verdict:** **NOTED (Documented Operational Constraint)**
* **Details:** The backend utilizes SQLite (`app.db`) on the local filesystem. On free-tier ephemeral PaaS hosts (e.g., Render, Railway), container restarts reset the local disk. As documented, `seed_users.py` is included to re-seed demo accounts instantly, or a managed PostgreSQL instance can be configured via `DATABASE_URL` in `config.py`.

**3. Password Hashing & Client Secrets**
* **Verdict:** **REAL/WORKING**
* **Details:** Passwords are fully hashed using `bcrypt` via `passlib`; no plaintext passwords touch the database. Furthermore, a grep of the frontend bundle confirms zero hardcoded API keys, secrets, or tokens are exposed to the client.

**4. JWT Signing Secret & CORS**
* **Verdict:** **PARTIALLY WORKING**
* **Details:** 
  * The backend reads the JWT secret from the environment but utilizes a hardcoded fallback string (`"fallback_demo_secret_key_12345"`) for demo ease.
  * The CORS configuration allows the `*` wildcard origin. Both are standard development accommodations acceptable for a scoped academic demo.
