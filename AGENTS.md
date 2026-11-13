# Workspace Agent Guidelines — EV Surge Predictor (Grid Pulse)

This repository predicts EV charging station load 2 hours ahead, provides TreeSHAP explainability, and simulates mitigation strategies (bays throttling, dynamic tariffs, load shedding) to protect the 250 kW transformer.

## 🌿 Contribution & Branch Guidelines
- **Active Branch**: Work on feature branches (e.g. `feature/contributions` or `feature/<topic>`).
- **Never push or commit directly** to `main` or `dev`.
- Maintain full compatibility with the existing ML pipelines, database schemas, and UI components.

## 🛠️ Stack & Directory Reference
- **Frontend**: `frontend/` — React 19, TypeScript, Vite, Tailwind CSS, Recharts, Vitest (`npm test`).
- **Backend**: `backend/` — Python, FastAPI, Pydantic v2, SQLite (`backend/app.db`), Pytest (`pytest`).
- **ML Pipeline**: `backend/pipeline/` & `backend/saved_models/` — XGBoost (deployed), PyTorch LSTM (benchmark), TreeSHAP explainer, scikit-learn scalers.
- **Documentation**: `docs/` — Specifications, audit reports, sample CSV datasets.

## 📋 Quality & Testing Gate
Always verify changes across both layers before opening a pull request:
1. **Backend Tests**: Run `pytest` inside `backend/` to ensure all API, batch, explain, and ML artifact tests pass.
2. **Frontend Tests**: Run `npm test` inside `frontend/` to ensure all Vitest unit and component tests pass.
3. **Artifact Integrity**: Run `python backend/pipeline/verify_artifacts.py` if touching model weights, scalers, or telemetry pipelines.

## 🧩 Workspace Customizations (`.agents/`)
- **Skills** (`.agents/skills/`): `fastapi-patterns`, `mle-workflow`, `pytorch-patterns`, `react-patterns`, `react-best-practices`, `react-testing`, `typescript-patterns`, `vite-patterns`, `verification`, `code-review`, `a11y-debugging`, `chrome-devtools`, `graphify`.
- **Rules** (`.agents/rules/`): Coding standards and security constraints for `python/`, `react/`, `typescript/`, and `common/`.
- **Agents** (`.agents/agents/`): Role specifications for `fastapi-reviewer`, `mle-reviewer`, `react-reviewer`, `pytorch-build-resolver`, `security-reviewer`, and `build-error-resolver`.
- **Workflows** (`.agents/workflows/`): Playbooks for `quality-gate.md`, `orch-add-feature.md`, `orch-fix-defect.md`, `fastapi-review.md`, and `security-scan.md`.
