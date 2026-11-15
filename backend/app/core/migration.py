import logging
from pathlib import Path
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.core import config as app_config

logger = logging.getLogger(__name__)


def get_alembic_config(db_url: str | None = None) -> Config:
    backend_dir = Path(__file__).resolve().parent.parent.parent
    ini_path = (backend_dir / "alembic.ini").resolve()
    migrations_dir = (backend_dir / "migrations").resolve()

    if not ini_path.is_file():
        raise FileNotFoundError(
            f"Alembic configuration file not found at: '{ini_path}'. "
            f"Searched directory: '{backend_dir}'."
        )

    if not migrations_dir.is_dir():
        raise FileNotFoundError(
            f"Alembic migrations directory not found at: '{migrations_dir}'. "
            f"Searched directory: '{backend_dir}'."
        )

    alembic_cfg = Config(str(ini_path))
    alembic_cfg.set_main_option("script_location", str(migrations_dir))
    target_url = db_url or app_config.DATABASE_URL
    alembic_cfg.set_main_option("sqlalchemy.url", target_url)
    return alembic_cfg


def get_current_revision(db_url: str | None = None) -> str | None:
    """Read the current migration revision from alembic_version table."""
    target_url = db_url or app_config.DATABASE_URL
    connect_args = {"check_same_thread": False} if target_url.startswith("sqlite") else {}
    chk_engine = create_engine(target_url, connect_args=connect_args)
    try:
        with chk_engine.connect() as conn:
            inspector = inspect(conn)
            if "alembic_version" not in inspector.get_table_names():
                return None
            res = conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).scalar()
            return str(res) if res else None
    except Exception as e:
        logger.warning(f"Could not read alembic_version: {e}")
        return None
    finally:
        chk_engine.dispose()


def run_migrations(db_url: str | None = None) -> None:
    """Run database migrations programmatically.

    If the database already has users/incidents tables but no alembic_version table,
    stamp the baseline revision (0001_baseline) first and then upgrade to head.
    """
    target_url = db_url or app_config.DATABASE_URL
    alembic_cfg = get_alembic_config(target_url)

    connect_args = {"check_same_thread": False} if target_url.startswith("sqlite") else {}
    chk_engine = create_engine(target_url, connect_args=connect_args)
    try:
        with chk_engine.connect() as conn:
            inspector = inspect(conn)
            tables = inspector.get_table_names()

            has_alembic_version = "alembic_version" in tables
            has_existing_legacy_tables = "users" in tables or "incidents" in tables

            if not has_alembic_version and has_existing_legacy_tables:
                logger.info("Existing database without alembic_version detected; stamping 0001_baseline...")
                command.stamp(alembic_cfg, "0001_baseline")

            logger.info("Applying alembic upgrade head...")
            command.upgrade(alembic_cfg, "head")
    finally:
        chk_engine.dispose()
