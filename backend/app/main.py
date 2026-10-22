"""
FastAPI Application Entry Point
EV Charging Station Smart Load & Surge Predictor
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api import router as v1_router
from app.routers import tariff
from app.models.ml_engine import engine


def _seed_demo_accounts() -> None:
    """Ensure demo accounts exist in the database (idempotent).

    Runs on every startup. If the SQLite file was wiped (e.g. ephemeral
    filesystem on a free-tier host), the accounts are silently recreated.
    If they already exist, this is a no-op.
    """
    from app.core.database import Base, engine as db_engine, SessionLocal
    from app.models.user import User
    from app.core.security import hash_password
    from app.core import config

    # Create tables if they don't exist yet
    Base.metadata.create_all(bind=db_engine)

    db = SessionLocal()
    try:
        user_count = db.query(User).count()
        if user_count == 0:
            demo_accounts = [
                {"username": "operator", "password": config.DEMO_OPERATOR_PASSWORD, "role": "operator"},
                {"username": "viewer",   "password": config.DEMO_VIEWER_PASSWORD,   "role": "viewer"},
            ]
            for acct in demo_accounts:
                db.add(User(
                    username=acct["username"],
                    password_hash=hash_password(acct["password"]),
                    role=acct["role"],
                ))
                print(f"  Seeded demo account: {acct['username']} ({acct['role']})")
            db.commit()
            print("  Seeded default demo users successfully.")
        else:
            print(f"  User table has {user_count} accounts. Seeding skipped.")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: load ML artifacts and ensure demo accounts exist."""
    print("Loading ML model artifacts ...")
    engine.load()
    print("ML engine ready.")

    print("Checking demo accounts ...")
    _seed_demo_accounts()
    print("Database ready.")

    yield
    print("Shutting down.")


app = FastAPI(
    title="EV Charging Surge Predictor API",
    description=(
        "Predictive Load Forecasting & Autonomous Throttling Platform. "
        "Ingests multi-variable tabular telemetry to predict localized "
        "energy load surges 2 hours in advance."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — configure allowed origins from environment
from app.core import config
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router)
app.include_router(tariff.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ev-surge-predictor"}
