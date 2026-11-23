"""baseline schema with users and incidents

Revision ID: 0001_baseline
Revises: 
Create Date: 2026-11-15 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0001_baseline'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Table: users ──
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(), nullable=False),
        sa.Column('password_hash', sa.String(), nullable=False),
        sa.Column('role', sa.String(), server_default='viewer', nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_users'))
    )
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)
    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)

    # ── Table: incidents ──
    op.create_table(
        'incidents',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('surge_status', sa.String(), nullable=False),
        sa.Column('predicted_load_kw', sa.Float(), nullable=False),
        sa.Column('capacity_utilization_pct', sa.Float(), nullable=False),
        sa.Column('tariff_multiplier', sa.Float(), nullable=False),
        sa.Column('throttled_bays_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('shed_bays_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('operator_username', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_incidents'))
    )
    op.create_index(op.f('ix_incidents_id'), 'incidents', ['id'], unique=False)
    op.create_index(op.f('ix_incidents_surge_status'), 'incidents', ['surge_status'], unique=False)
    op.create_index(op.f('ix_incidents_timestamp'), 'incidents', ['timestamp'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_incidents_timestamp'), table_name='incidents')
    op.drop_index(op.f('ix_incidents_surge_status'), table_name='incidents')
    op.drop_index(op.f('ix_incidents_id'), table_name='incidents')
    op.drop_table('incidents')
    op.drop_index(op.f('ix_users_username'), table_name='users')
    op.drop_index(op.f('ix_users_id'), table_name='users')
    op.drop_table('users')
