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


def test_dockerfile_and_dockerignore_include_migrations_and_alembic_ini():
    """Assert backend/Dockerfile copies migrations and alembic.ini, and .dockerignore does not exclude them."""
    from pathlib import Path
    import fnmatch

    backend_dir = Path(__file__).resolve().parent.parent
    dockerfile_path = backend_dir / "Dockerfile"
    dockerignore_path = backend_dir / ".dockerignore"

    assert dockerfile_path.is_file(), f"Dockerfile not found at {dockerfile_path}"
    dockerfile_content = dockerfile_path.read_text(encoding="utf-8")

    # Assert COPY lines for alembic.ini and migrations exist
    copy_lines = [
        line.strip()
        for line in dockerfile_content.splitlines()
        if line.strip().startswith("COPY ")
    ]
    has_alembic_ini_copy = any("alembic.ini" in line for line in copy_lines)
    has_migrations_copy = any("migrations" in line for line in copy_lines)

    assert has_alembic_ini_copy, f"Dockerfile missing COPY instruction for alembic.ini. Found: {copy_lines}"
    assert has_migrations_copy, f"Dockerfile missing COPY instruction for migrations/. Found: {copy_lines}"

    # Assert .dockerignore does not exclude migrations or alembic.ini
    if dockerignore_path.is_file():
        patterns = [
            line.strip()
            for line in dockerignore_path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        files_to_check = [
            "alembic.ini",
            "migrations",
            "migrations/",
            "migrations/env.py",
            "migrations/script.py.mako",
            "migrations/versions",
            "migrations/versions/0001_baseline.py",
            "migrations/versions/0002_stations_and_roles.py",
        ]
        for f in files_to_check:
            for pat in patterns:
                # Normalize directory matching
                clean_pat = pat.rstrip("/")
                clean_f = f.rstrip("/")
                is_match = (
                    fnmatch.fnmatch(clean_f, clean_pat)
                    or fnmatch.fnmatch(clean_f, pat)
                    or fnmatch.fnmatch(f, pat)
                )
                assert not is_match, f"File '{f}' is erroneously ignored by .dockerignore pattern '{pat}'"


def test_run_migrations_from_arbitrary_cwd(monkeypatch, tmp_path):
    """Assert run_migrations resolves paths and succeeds when process CWD is an arbitrary temporary directory."""
    monkeypatch.chdir(tmp_path)
    temp_db_file = tmp_path / "arbitrary_cwd.db"
    db_url = f"sqlite:///{temp_db_file}"

    run_migrations(db_url)
    assert get_current_revision(db_url) == "0002_stations_and_roles"


def test_get_alembic_config_raises_clear_error_if_paths_missing(monkeypatch, tmp_path):
    """Assert get_alembic_config raises FileNotFoundError with clear searched directory and missing path info."""
    from app.core import migration

    # Point __file__ resolution to an empty directory
    fake_migration_file = tmp_path / "app" / "core" / "migration.py"
    fake_migration_file.parent.mkdir(parents=True, exist_ok=True)
    fake_migration_file.write_text("# fake", encoding="utf-8")

    monkeypatch.setattr(migration, "__file__", str(fake_migration_file))

    with pytest.raises(FileNotFoundError) as exc_info:
        migration.get_alembic_config()

    err_msg = str(exc_info.value)
    assert "Alembic configuration file not found at" in err_msg
    assert "Searched directory" in err_msg

