"""stations and roles

Revision ID: 0002_stations_and_roles
Revises: 0001_baseline
Create Date: 2026-11-15 12:30:00.000000

"""
from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0002_stations_and_roles'
down_revision: Union[str, None] = '0001_baseline'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Create stations table ──
    op.create_table(
        'stations',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('code', sa.String(), nullable=False),
        sa.Column('capacity_kw', sa.Float(), server_default='250.0', nullable=False),
        sa.Column('warning_pct', sa.Float(), server_default='65.0', nullable=False),
        sa.Column('critical_pct', sa.Float(), server_default='80.0', nullable=False),
        sa.Column('latitude', sa.Float(), nullable=False),
        sa.Column('longitude', sa.Float(), nullable=False),
        sa.Column('timezone', sa.String(), server_default='Asia/Kolkata', nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_stations'))
    )
    op.create_index(op.f('ix_stations_code'), 'stations', ['code'], unique=True)

    # ── 2. Insert default station ──
    stations_table = sa.table(
        'stations',
        sa.column('id', sa.Integer),
        sa.column('name', sa.String),
        sa.column('code', sa.String),
        sa.column('capacity_kw', sa.Float),
        sa.column('warning_pct', sa.Float),
        sa.column('critical_pct', sa.Float),
        sa.column('latitude', sa.Float),
        sa.column('longitude', sa.Float),
        sa.column('timezone', sa.String),
        sa.column('is_active', sa.Boolean),
        sa.column('created_at', sa.DateTime),
    )
    op.bulk_insert(
        stations_table,
        [
            {
                'id': 1,
                'name': 'Default Station (Mumbai)',
                'code': 'MUM-01',
                'capacity_kw': 250.0,
                'warning_pct': 65.0,
                'critical_pct': 80.0,
                'latitude': 19.0760,
                'longitude': 72.8777,
                'timezone': 'Asia/Kolkata',
                'is_active': True,
                'created_at': datetime.now(timezone.utc),
            }
        ]
    )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("SELECT setval(pg_get_serial_sequence('stations', 'id'), coalesce(max(id), 1), true) FROM stations")

    # ── 3. Alter incidents table: add station_id and source ──
    with op.batch_alter_table('incidents', schema=None) as batch_op:
        batch_op.add_column(sa.Column('station_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('source', sa.String(), server_default='LIVE', nullable=False))
        batch_op.create_foreign_key(
            batch_op.f('fk_incidents_station_id_stations'),
            'stations',
            ['station_id'],
            ['id'],
        )
        batch_op.create_index(batch_op.f('ix_incidents_station_id'), ['station_id'], unique=False)

    # Backfill existing incident rows with default station
    op.execute(
        "UPDATE incidents SET station_id = ("
        "  SELECT id FROM stations WHERE code = 'MUM-01' LIMIT 1"
        ") WHERE station_id IS NULL"
    )

    # Enforce NOT NULL on station_id
    with op.batch_alter_table('incidents', schema=None) as batch_op:
        batch_op.alter_column('station_id', existing_type=sa.Integer(), nullable=False)


def downgrade() -> None:
    # ── 1. Revert incidents table changes ──
    with op.batch_alter_table('incidents', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_incidents_station_id'))
        batch_op.drop_constraint(batch_op.f('fk_incidents_station_id_stations'), type_='foreignkey')
        batch_op.drop_column('source')
        batch_op.drop_column('station_id')

    # ── 2. Drop stations table ──
    op.drop_index(op.f('ix_stations_code'), table_name='stations')
    op.drop_table('stations')
