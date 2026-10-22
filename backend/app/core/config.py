"""
Core configuration for the EV Charging Surge Predictor backend.
"""

from __future__ import annotations

import os
from pathlib import Path

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
JWT_SECRET: str = os.getenv("JWT_SECRET", os.getenv("JWT_SECRET_KEY", "fallback_demo_secret_key_12345"))
JWT_EXPIRE_HOURS: int = int(os.getenv("JWT_EXPIRE_HOURS", "12"))

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

