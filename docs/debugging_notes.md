# Debugging & Diagnostic Notes

During the development and debugging of the EV Surge Predictor, several standalone scripts were created to diagnose pipeline issues, evaluate model behavior, and verify feature parity. They have been deleted to clean up the repository, but their purposes and findings are recorded here for historical context.

### Feature Assembly & Batch Bias Debugging
These scripts were instrumental in identifying and fixing a systematic ~45-50% negative bias in the Batch Analysis predictions.

* **`backend/test_bias.py`** & **`backend/scripts/debug_batch_bias.py`**
  * *Purpose:* Investigated why batch predictions were consistently producing output values roughly half the magnitude of the actual load, despite the model having low MAE during training.
  * *Findings:* Isolated the issue to the feature construction logic used in the batch endpoint, specifically how lag features (`load_lag_15m`, etc.) were being computed differently (or failing to compute due to NaN rows) compared to the live prediction route.

* **`backend/scripts/debug_features.py`**
  * *Purpose:* Dumped and compared the exact 15-dimensional feature vectors produced by `/predict` (single row) vs `/predict/batch` (dataframe).
  * *Findings:* Confirmed that the batch route was using an entirely duplicated and stale feature-assembly implementation. Revealed critical divergences in how `plug_delta_15m` and rolling statistics were calculated.

* **`backend/test_compare.py`** & **`backend/test_pred_match.py`**
  * *Purpose:* Used to verify that `/predict` and `/predict/batch` produce absolutely identical results after the backend was refactored to use a single, unified `assemble_features()` function.
  * *Findings:* Confirmed exact parity between the two endpoints on identical inputs.

### Model Evaluation & Extrapolation Testing
These scripts were used to test the model's behavior under extreme edge cases and different thresholds.

* **`analyze_test_b.py`** & **`compare_tests.py`**
  * *Purpose:* Compared prediction MAE between an internally generated test dataset ("Test A") and a heavily skewed external stress-test dataset ("Test B", `batch_test_data_2h_aligned.csv`) that simulated extreme multi-day heatwaves and traffic.
  * *Findings:* Demonstrated that the tree-based XGBoost model failed to extrapolate to 300+ kW loads because the training data distribution was capped at 26.2°C ambient temperature. Led to the widening of the synthetic training data distributions.

* **`test_thresholds.py`**
  * *Purpose:* Evaluated the classification performance (Surge Recall, False Positives, False Negatives) of predicting critical surges >85% capacity.
  * *Findings:* Calculated that setting a **Safety Margin** (triggering CRITICAL at an 80% prediction threshold) recovered Surge Recall to ~100% without excessively increasing false-alarm alerts, compensating for the inherent MAE noise of the regressors.

* **`backend/test_pred.py`**
  * *Purpose:* Initial scaffolding script used early on to hit the prediction engine directly and verify that model loading and inference latency were operating within parameters.

---

### Sandbox Slider State Persistence & Cross-Page Reactivity
* **Issue:** Applying a simulation in the Sandbox, navigating away to another page (e.g., Control Center or Vehicle Tariff Lab), and navigating back caused the three sliders (Temperature Δ, Traffic Surge %, Forced Outage Stalls) to visually reset to 0/defaults, even though the simulation was still active globally.
* **Root Cause:** Slider state was stored exclusively in local component `useState` inside `StressSandbox.tsx`. When React Router swapped views, the component unmounted, dropping local state.
* **Resolution:**
  1. Extended `TariffContext.tsx` to store `simulationParams: { tempDelta, trafficSurgePct, outageStalls }`.
  2. Updated `setSimulationTariff(multiplier, params)` to store applied slider parameters in context on simulation apply.
  3. Changed `StressSandbox` slider `useState` initializers to read initial values directly from `useTariff().simulationParams` on mount.
  4. Updated `resetToLive()` in `TariffContext` to reset `simulationParams` to zero defaults, and updated `StressSandbox`'s effect to sync sliders to 0 when simulation is inactive.
  5. Verified with Playwright end-to-end test (`6°C`, `35%`, `2 bays` retained across navigation; reset to `0` on Reset to Live).

---

### TypeScript Union Type-Narrowing & CSS Lint Resolution
* **Issue:** In `frontend/src/pages/SandboxPage.tsx:18`, TypeScript flagged `Property 'dispatched_mitigations' does not exist on type 'void | SimulateResponse'`. Additionally, `VehicleTariffLab.tsx:290` triggered an IDE CSS warning for conflicting font families.
* **Root Cause:**
  1. `handleSimulate` in `DataContext.tsx` was typed as `Promise<SimulateResponse | void>` (from legacy code when it did not return values), even though runtime code returned `SimulateResponse`. Optional chaining on `void` is disallowed by strict TypeScript checking.
  2. In `VehicleTariffLab.tsx`, both `font-kpi-large` and `font-label-mono` classes were applied to the same metric component.
* **Resolution:**
  1. Corrected `handleSimulate`'s return type signature in `DataContextType` to `Promise<SimulateResponse>`.
  2. Added an explicit type-narrowing guard `(res && 'dispatched_mitigations' in res)` in `SandboxPage.tsx`.
  3. Removed `font-kpi-large` from the `AnimatedNumber` in `VehicleTariffLab.tsx`, retaining `text-kpi-large font-label-mono font-bold tracking-tight`.
  4. Verified full compilation with `npm run build` (`tsc -b && vite build` passing with 0 errors).

---

### Batch Analysis Schema Alignment & Secure Download Route
* **Issue:** CSV uploads to `/api/v1/predict/batch` failed with 422 Unprocessable Entity on organic datasets because `expected_columns` demanded `load_lag_45m`, which `train.py` initially skipped. Furthermore, the batch CSV download endpoint was public without JWT authentication.
* **Resolution:**
  1. Updated `engineer_features()` in `backend/pipeline/train.py` to generate `load_lag_45m = df["load_kw"].shift(3)`.
  2. Unified feature construction inside `MLEngine._assemble_features_df()` so that both single-row live inference and multi-row batch inference share the same deterministic pipeline.
  3. Added `Depends(get_current_user)` to `GET /api/v1/predict/batch/download/{batch_id}` to enforce role-based access control.
