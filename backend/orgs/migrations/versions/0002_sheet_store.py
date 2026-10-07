"""Research groups use the same spreadsheet structure as the main group: sheet tabs + rows.
Drops the first-draft data model (regions/turtles/sightings/images/submissions; never in production).

Revision ID: 0002_sheet_store
Revises: 0001_initial
Create Date: 2026-09-28
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0002_sheet_store'
down_revision = '0001_initial'
branch_labels = None
depends_on = None

Json = sa.JSON().with_variant(JSONB(), 'postgresql')


def upgrade():
    op.drop_table('submissions')
    op.drop_index('uq_images_one_reference_per_turtle', table_name='images')
    op.drop_table('images')
    op.drop_table('sightings')
    op.drop_table('turtles')
    op.drop_table('regions')

    op.create_table(
        'sheet_tabs',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('org_id', sa.Integer, nullable=False, index=True),
        sa.Column('book', sa.String(20), nullable=False),
        sa.Column('sheet_id', sa.Integer, nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('position', sa.Integer, nullable=False),
        sa.UniqueConstraint('org_id', 'book', 'title', name='uq_sheet_tabs_title'),
        sa.UniqueConstraint('org_id', 'book', 'sheet_id', name='uq_sheet_tabs_sheet_id'),
    )
    op.create_table(
        'sheet_rows',
        sa.Column('org_id', sa.Integer, primary_key=True),
        sa.Column('book', sa.String(20), primary_key=True),
        sa.Column('sheet_id', sa.Integer, primary_key=True),
        sa.Column('row_index', sa.Integer, primary_key=True),
        sa.Column('cells', Json, nullable=False),
    )


def downgrade():
    op.drop_table('sheet_rows')
    op.drop_table('sheet_tabs')
