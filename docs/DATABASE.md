# Database & Migration Guide

This document describes the database architecture, schema migrations with Alembic, and database operations for the EV Charging Surge Predictor (Grid Pulse) platform.

---

## 1. Architecture Overview

* **Local Development & Automated Tests**: Uses SQLite (`sqlite:///backend/app.db` or temporary SQLite databases for tests).
* **Containerized Production & CI**: Uses PostgreSQL 16 (`postgresql+psycopg://...`) managed via Docker Compose and GitHub Actions.
* **Migration Tooling**: [Alembic](https://alembic.sqlalchemy.org/) manages relational schemas, revisions, and constraint naming conventions.

### Constraint Naming Convention
To ensure batch schema modifications succeed on SQLite without constraint lockups, all models inherit constraint naming conventions defined in `backend/app/core/database.py`:
* Index: `ix_%(column_0_label)s`
* Unique Constraint: `uq_%(table_name)s_%(column_0_name)s`
* Check Constraint: `ck_%(table_name)s_%(constraint_name)s`
* Foreign Key: `fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s`
* Primary Key: `pk_%(table_name)s`

Alembic's `env.py` is configured with `render_as_batch=True` when connecting to SQLite.

---

## 2. Directory Layout

```text
backend/
├── alembic.ini                   # Alembic configuration
├── migrations/
│   ├── env.py                    # Alembic environment and connection runner
│   ├── script.py.mako            # Migration template
│   └── versions/
│       ├── 0001_baseline.py      # Baseline schema (users, incidents)
│       └── 0002_stations_and_roles.py  # Stations table, station_id FK, source, admin role
└── app/
    ├── core/
    │   ├── database.py           # Engine, SessionLocal, naming conventions
    │   └── migration.py          # Programmatic migration runner on startup
    └── models/
        ├── user.py               # User model (viewer, operator, admin)
        ├── station.py            # Station model (MUM-01 default)
        └── incident.py           # Incident log model (station_id FK, source)
```

---

## 3. How to Run Migrations

All commands should be executed from within the `backend/` directory:

```bash
cd backend
```

### Apply Migrations (Upgrade to Head)
```bash
alembic upgrade head
```

### Roll Back Migrations (Downgrade)
Roll back a single revision:
```bash
alembic downgrade -1
```
Roll back all migrations to initial clean state:
```bash
alembic downgrade base
```

### View Migration History & Current Revision
```bash
alembic history --verbose
alembic current
```

---

## 4. How to Create a New Migration

1. Add or modify SQLAlchemy models in `backend/app/models/`.
2. Generate an autodetected migration script:
   ```bash
   cd backend
   alembic revision --autogenerate -m "describe_changes_here"
   ```
3. Inspect the newly generated script inside `backend/migrations/versions/`.
4. Ensure SQLite batch safety (`with op.batch_alter_table(...) as batch_op:`) is used for schema alterations.
5. Apply the migration:
   ```bash
   alembic upgrade head
   ```

---

## 5. How to Reset the Local Database

To reset your local SQLite database:

1. Stop the running backend server.
2. Delete the SQLite file:
   * **Windows PowerShell**:
     ```powershell
     Remove-Item backend\app.db -Force
     ```
   * **Linux / macOS**:
     ```bash
     rm backend/app.db
     ```
3. Apply the migrations to re-create the schema and default station:
   ```bash
   cd backend
   alembic upgrade head
   ```
4. Start the backend (`uvicorn app.main:app --reload`), which will idempotently seed demo users (`operator`, `viewer`).

---

## 6. Docker & PostgreSQL Development Defaults

When running with Docker Compose (`docker compose up -d`), a PostgreSQL 16 container (`ev-surge-postgres`) is launched automatically.

> [!WARNING]
> The credentials below are **development-only defaults** intended solely for local testing and CI demonstration. Never use these credentials in public staging or production deployments.

| Environment Variable | Development Default | Description |
| :--- | :--- | :--- |
| `POSTGRES_USER` | `grid_pulse` | PostgreSQL user account |
| `POSTGRES_PASSWORD` | `grid_pulse_dev_password` | PostgreSQL account password |
| `POSTGRES_DB` | `ev_surge_db` | Primary database name |
| `DATABASE_URL` | `postgresql+psycopg://grid_pulse:grid_pulse_dev_password@postgres:5432/ev_surge_db` | SQLAlchemy connection URI |

To override these in a real deployment, supply strong secrets via environment variables or a secure `.env` file.
