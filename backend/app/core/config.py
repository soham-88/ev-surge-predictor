"""
Core configuration for the EV Charging Surge Predictor backend.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
import warnings

logger = logging.getLogger(__name__)

# ── Paths ──
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
SAVED_MODELS_DIR = BACKEND_DIR / "saved_models"

# ── Environment Variable Loader (.env support without external dependencies) ──
def _load_env_file(filepath: Path) -> None:
    if not filepath.is_file():
        return
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip()
                if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                    v = v[1:-1]
                if k not in os.environ:
                    os.environ[k] = v
    except Exception:
        pass

# Attempt loading from backend/.env or root .env
_load_env_file(BACKEND_DIR / ".env")
_load_env_file(BACKEND_DIR.parent / ".env")

# ── Security & Authentication ──
INSECURE_DEFAULT_JWT_SECRETS: set[str] = {
    "dev-only-insecure-change-me",
    "ev_surge_production_jwt_secret_grid_pulse_2026",
    "fallback_demo_secret_key_12345",
    "your_super_secret_jwt_key_change_in_production_32chars",
}

JWT_SECRET: str = os.getenv("JWT_SECRET", os.getenv("JWT_SECRET_KEY", "dev-only-insecure-change-me"))
JWT_EXPIRE_HOURS: int = int(os.getenv("JWT_EXPIRE_HOURS", "12"))


def check_jwt_secret_warning(secret: str | None = None) -> bool:
    """Check if JWT_SECRET is an insecure development default and emit a warning.

    Logs a clear startup WARNING and issues a UserWarning when a default is detected.
    Does NOT raise an exception or abort startup, so local demos and CI keep functioning.
    Returns True if an insecure default was detected and warned, False otherwise.
    """
    target = secret if secret is not None else JWT_SECRET
    if target in INSECURE_DEFAULT_JWT_SECRETS:
        msg = (
            f"SECURITY WARNING: JWT_SECRET is set to a development default ('{target}'). "
            "This is insecure for production. You must set a unique, strong secret through "
            "the JWT_SECRET environment variable for any real deployment."
        )
        logger.warning(msg)
        warnings.warn(msg, UserWarning, stacklevel=2)
        return True
    return False


# Check on configuration module load
check_jwt_secret_warning()

# ── Database ──
DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{BACKEND_DIR}/app.db")

# ── CORS ──
CORS_ORIGINS: list[str] = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,*").split(",")
    if o.strip()
]

# ── Seed Account Passwords ──
DEMO_OPERATOR_PASSWORD: str = os.getenv("DEMO_OPERATOR_PASSWORD", "operatorpassword123")
DEMO_VIEWER_PASSWORD: str = os.getenv("DEMO_VIEWER_PASSWORD", "viewerpassword123")

# ── Grid Constants ──
TRANSFORMER_CAPACITY_KW: float = 250.0
SURGE_THRESHOLD_PCT: float = 0.80  # 80% capacity triggers CRITICAL (safety margin)
WARNING_THRESHOLD_PCT: float = 0.65  # 65% capacity triggers WARNING
NUM_STALLS: int = 8

# ── Tariff Rules ──
BASE_TARIFF_MULTIPLIER: float = 1.0
WARNING_TARIFF_MULTIPLIER: float = 1.20
CRITICAL_TARIFF_MULTIPLIER: float = 1.45
SEVERE_TARIFF_MULTIPLIER: float = 1.80

# ── Throttling Rules ──
THROTTLE_PER_STALL_CAP_KW: float = 60.0  # per-stall cap when throttling

# ── Weather ──
CITY_NAME: str = "Mumbai"
CITY_LAT: float = 19.0760
CITY_LON: float = 72.8777

