from __future__ import annotations

import sys
import os
import sys
import tempfile
from pathlib import Path
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app
from app.core import config as app_config
from app.core.database import SessionLocal as AppSessionLocal
from app.core.migration import run_migrations
from app.core.security import get_db, hash_password
from app.models.user import User
from app.models.ml_engine import engine as ml_engine

# Temporary SQLite file created by running migrations
_temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_temp_db.close()
TEST_DB_PATH = _temp_db.name
SQLALCHEMY_DATABASE_URL = f"sqlite:///{TEST_DB_PATH}"

test_engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    # Update app configuration to point to test database
    app_config.DATABASE_URL = SQLALCHEMY_DATABASE_URL
    AppSessionLocal.configure(bind=test_engine)

    # Initialize schema strictly via Alembic migrations (no create_all)
    run_migrations(SQLALCHEMY_DATABASE_URL)

    db = TestingSessionLocal()
    try:
        # Seed test users
        operator = User(
            username="operator",
            password_hash=hash_password("operatorpassword123"),
            role="operator",
        )
        viewer = User(
            username="viewer",
            password_hash=hash_password("viewerpassword123"),
            role="viewer",
        )
        db.add(operator)
        db.add(viewer)
        db.commit()
    finally:
        db.close()

    # Pre-load ML engine
    ml_engine.load()

    def override_get_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    test_engine.dispose()
    try:
        if os.path.exists(TEST_DB_PATH):
            os.unlink(TEST_DB_PATH)
    except Exception:
        pass


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def operator_headers(client: TestClient) -> dict[str, str]:
    resp = client.post(
        "/api/v1/auth/login",
        data={"username": "operator", "password": "operatorpassword123"},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def viewer_headers(client: TestClient) -> dict[str, str]:
    resp = client.post(
        "/api/v1/auth/login",
        data={"username": "viewer", "password": "viewerpassword123"},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

