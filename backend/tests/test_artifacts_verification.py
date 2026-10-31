from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PIPELINE_DIR = BACKEND_DIR / "pipeline"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from pipeline.verify_artifacts import verify_artifacts


def test_model_artifacts_reproducibility():
    """Verify that stored metrics in .joblib artifacts exactly match fresh re-evaluation on both XGBoost and LSTM."""
    success = verify_artifacts()
    assert success is True, "Artifact verification failed: re-evaluated metrics differed from stored metrics."

