import os
import tempfile
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext

from app.core.database import Base, SessionLocal
from app.core.migration import get_alembic_config, get_current_revision, run_migrations
from app.core.security import hash_password
from app.models.user import User


def test_upgrade_head_on_empty_db_creates_all_tables_and_default_station():
    """(a) upgrade head on an empty DB creates all tables and the default station."""
    temp_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    temp_file.close()
    db_url = f"sqlite:///{temp_file.name}"
    try:
        run_migrations(db_url)
        engine = create_engine(db_url)
        with engine.connect() as conn:
            inspector = inspect(conn)
            tables = set(inspector.get_table_names())
            assert {"users", "incidents", "stations", "alembic_version"}.issubset(tables)

            # Verify default station
            station = conn.execute(
                text("SELECT id, name, code, capacity_kw, warning_pct, critical_pct, latitude, longitude, timezone, is_active FROM stations WHERE code = 'MUM-01'")
            ).mappings().first()
            assert station is not None
            assert station["name"] == "Default Station (Mumbai)"
            assert station["capacity_kw"] == 250.0
            assert station["warning_pct"] == 65.0
            assert station["critical_pct"] == 80.0
            assert station["latitude"] == 19.0760
            assert station["longitude"] == 72.8777
            assert station["timezone"] == "Asia/Kolkata"
            assert bool(station["is_active"]) is True
        engine.dispose()
    finally:
        if os.path.exists(temp_file.name):
            try:
                os.unlink(temp_file.name)
            except Exception:
                pass


def test_downgrade_base_then_upgrade_head():
    """(b) downgrade base then upgrade head works."""
    temp_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    temp_file.close()
    db_url = f"sqlite:///{temp_file.name}"
    try:
        cfg = get_alembic_config(db_url)
        # 1. Upgrade to head
        command.upgrade(cfg, "head")
        assert get_current_revision(db_url) == "0002_stations_and_roles"

        # 2. Downgrade to base
        command.downgrade(cfg, "base")
        assert get_current_revision(db_url) is None

        engine = create_engine(db_url)
        with engine.connect() as conn:
            inspector = inspect(conn)
            tables = set(inspector.get_table_names())
            assert "stations" not in tables
            assert "incidents" not in tables
            assert "users" not in tables
        engine.dispose()

        # 3. Re-upgrade to head
        command.upgrade(cfg, "head")
        assert get_current_revision(db_url) == "0002_stations_and_roles"
        engine2 = create_engine(db_url)
        with engine2.connect() as conn:
            inspector = inspect(conn)
            tables = set(inspector.get_table_names())
            assert {"users", "incidents", "stations"}.issubset(tables)
        engine2.dispose()
    finally:
        if os.path.exists(temp_file.name):
            try:
                os.unlink(temp_file.name)
            except Exception:
                pass


def test_alembic_autogenerate_compare_reports_no_diff():
    """(c) alembic autogenerate compare against the models reports no differences (models and migrations are in sync)."""
    temp_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    temp_file.close()
    db_url = f"sqlite:///{temp_file.name}"
    try:
        run_migrations(db_url)
        engine = create_engine(db_url)
        with engine.connect() as conn:
            mc = MigrationContext.configure(conn, opts={"compare_type": True, "render_as_batch": True})
            diff = compare_metadata(mc, Base.metadata)
            assert diff == [], f"Autogenerate found schema drift: {diff}"
        engine.dispose()
    finally:
        if os.path.exists(temp_file.name):
            try:
                os.unlink(temp_file.name)
            except Exception:
                pass


def test_baseline_incidents_kept_after_upgrade_with_station_and_source():
    """(d) a DB created with the baseline revision and a few incident rows keeps those rows after upgrade, with station_id and source filled."""
    temp_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    temp_file.close()
    db_url = f"sqlite:///{temp_file.name}"
    try:
        cfg = get_alembic_config(db_url)
        # Create baseline
        command.upgrade(cfg, "0001_baseline")

        # Insert baseline incidents without station_id or source
        engine = create_engine(db_url)
        with engine.connect() as conn:
            conn.execute(
                text(
                    "INSERT INTO incidents (timestamp, surge_status, predicted_load_kw, capacity_utilization_pct, tariff_multiplier, throttled_bays_count, shed_bays_count, operator_username) "
                    "VALUES (:ts, :ss, :pl, :cu, :tm, :tb, :sb, :op)"
                ),
                [
                    {
                        "ts": "2026-10-25 14:00:00",
                        "ss": "CRITICAL",
                        "pl": 220.0,
                        "cu": 88.0,
                        "tm": 1.45,
                        "tb": 2,
                        "sb": 1,
                        "op": "operator",
                    },
                    {
                        "ts": "2026-10-26 15:30:00",
                        "ss": "WARNING",
                        "pl": 175.5,
                        "cu": 70.2,
                        "tm": 1.20,
                        "tb": 1,
                        "sb": 0,
                        "op": "operator",
                    },
                ],
            )
            conn.commit()
        engine.dispose()

        # Upgrade to head (0002_stations_and_roles)
        command.upgrade(cfg, "head")

        # Verify incident rows still exist, with station_id and source properly backfilled
        engine2 = create_engine(db_url)
        with engine2.connect() as conn:
            rows = conn.execute(
                text("SELECT id, surge_status, predicted_load_kw, station_id, source FROM incidents ORDER BY id ASC")
            ).mappings().all()
            assert len(rows) == 2
            row1, row2 = rows[0], rows[1]
            assert row1["surge_status"] == "CRITICAL"
            assert row1["predicted_load_kw"] == 220.0
            assert row1["station_id"] == 1
            assert row1["source"] == "LIVE"

            assert row2["surge_status"] == "WARNING"
            assert row2["predicted_load_kw"] == 175.5
            assert row2["station_id"] == 1
            assert row2["source"] == "LIVE"
        engine2.dispose()
    finally:
        if os.path.exists(temp_file.name):
            try:
                os.unlink(temp_file.name)
            except Exception:
                pass


def test_health_reports_database_ok_and_revision(client: TestClient):
    """(e) /health reports database ok and a revision."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "ev-surge-predictor"
    assert data["database"] == "ok"
    assert data["migration_revision"] == "0002_stations_and_roles"


def test_rbac_admin_allowed_operator_actions_viewer_denied(client: TestClient, viewer_headers: dict[str, str]):
    """(f) RBAC: admin can do operator actions, viewer cannot."""
    # Seed an admin user
    db = SessionLocal()
    try:
        admin_user = db.query(User).filter(User.username == "test_admin").first()
        if not admin_user:
            admin_user = User(
                username="test_admin",
                password_hash=hash_password("adminpassword123"),
                role="admin",
            )
            db.add(admin_user)
            db.commit()
    finally:
        db.close()

    # Get admin token
    resp_login = client.post(
        "/api/v1/auth/login",
        data={"username": "test_admin", "password": "adminpassword123"},
    )
    assert resp_login.status_code == 200, resp_login.text
    admin_token = resp_login.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Action: Clear incidents (DELETE /api/v1/incidents requires operator)
    # Viewer should be forbidden (403)
    resp_viewer_del = client.delete("/api/v1/incidents", headers=viewer_headers)
    assert resp_viewer_del.status_code == 403

    # Admin should succeed (200)
    resp_admin_del = client.delete("/api/v1/incidents", headers=admin_headers)
    assert resp_admin_del.status_code == 200

    # 2. Action: Run simulation (POST /api/v1/simulate requires operator)
    sim_payload = {
        "temp_delta_c": 5.0,
        "traffic_surge_pct": 20.0,
        "forced_outage_stalls": [1],
    }
    # Viewer should be forbidden (403)
    resp_viewer_sim = client.post("/api/v1/simulate", json=sim_payload, headers=viewer_headers)
    assert resp_viewer_sim.status_code == 403

    # Admin should succeed (200)
    resp_admin_sim = client.post("/api/v1/simulate", json=sim_payload, headers=admin_headers)
    assert resp_admin_sim.status_code == 200
