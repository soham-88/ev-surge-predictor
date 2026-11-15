import os
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool
from alembic import context

# Ensure backend directory is in sys.path
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core import config as app_config
from app.core.database import Base
# Import all models so Base.metadata is fully populated for autogenerate
from app.models import User, Incident, Station  # noqa: F401

# Alembic Config object
alembic_config = context.config

# Interpret the config file for Python logging
if alembic_config.config_file_name is not None:
    fileConfig(alembic_config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def get_url() -> str:
    url = os.getenv("DATABASE_URL") or alembic_config.get_main_option("sqlalchemy.url")
    if not url or url == "sqlite:///app.db":
        url = app_config.DATABASE_URL
    return url


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = get_url()
    is_sqlite = url.startswith("sqlite")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=is_sqlite,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    url = get_url()
    configuration = alembic_config.get_section(alembic_config.config_ini_section, {})
    configuration["sqlalchemy.url"] = url

    connectable = alembic_config.attributes.get("connection", None)

    if connectable is None:
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        connectable = engine_from_config(
            configuration,
            prefix="sqlalchemy.",
            poolclass=pool.NullPool,
            connect_args=connect_args,
        )

    with connectable.connect() as connection:
        is_sqlite = connection.dialect.name == "sqlite"
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=is_sqlite,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
