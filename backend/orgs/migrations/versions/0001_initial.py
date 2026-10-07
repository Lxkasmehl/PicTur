"""Research-group tables: regions, turtles, sightings, images, submissions

Revision ID: 0001_initial
Revises:
Create Date: 2026-09-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None

Json = sa.JSON().with_variant(JSONB(), 'postgresql')
TS = sa.DateTime(timezone=True)


def upgrade():
    op.create_table(
        'regions',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('org_id', sa.Integer, nullable=False, index=True),
        sa.Column('parent_id', sa.Integer, sa.ForeignKey('regions.id', ondelete='RESTRICT')),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('created_at', TS, nullable=False),
        sa.UniqueConstraint('org_id', 'parent_id', 'name', name='uq_regions_org_parent_name'),
    )
    op.create_table(
        'turtles',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('org_id', sa.Integer, nullable=False, index=True),
        sa.Column('primary_id', sa.String(40), nullable=False),
        sa.Column('bio_id', sa.String(40), nullable=False),
        sa.Column('name', sa.String(120)),
        sa.Column('sex', sa.String(1), nullable=False),
        sa.Column('species', sa.String(120)),
        sa.Column('region_id', sa.Integer, sa.ForeignKey('regions.id', ondelete='SET NULL')),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('notes', sa.Text),
        sa.Column('extra', Json, nullable=False),
        sa.Column('created_by', sa.Integer),
        sa.Column('created_at', TS, nullable=False),
        sa.Column('updated_at', TS, nullable=False),
        sa.UniqueConstraint('org_id', 'primary_id', name='uq_turtles_org_primary_id'),
        sa.UniqueConstraint('org_id', 'bio_id', name='uq_turtles_org_bio_id'),
    )
    op.create_table(
        'sightings',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('org_id', sa.Integer, nullable=False, index=True),
        sa.Column(
            'turtle_id', sa.Integer, sa.ForeignKey('turtles.id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        sa.Column('observed_at', TS),
        sa.Column('region_id', sa.Integer, sa.ForeignKey('regions.id', ondelete='SET NULL')),
        sa.Column('lat', sa.Float),
        sa.Column('lon', sa.Float),
        sa.Column('observer_user_id', sa.Integer),
        sa.Column('observer_name', sa.String(200)),
        sa.Column('measurements', Json, nullable=False),
        sa.Column('notes', sa.Text),
        sa.Column('created_at', TS, nullable=False),
    )
    op.create_table(
        'images',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('org_id', sa.Integer, nullable=False, index=True),
        sa.Column(
            'turtle_id', sa.Integer, sa.ForeignKey('turtles.id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        sa.Column('sighting_id', sa.Integer, sa.ForeignKey('sightings.id', ondelete='SET NULL')),
        sa.Column('kind', sa.String(20), nullable=False),
        sa.Column('path', sa.String(500), nullable=False),
        sa.Column('feature_path', sa.String(500)),
        sa.Column('is_reference', sa.Boolean, nullable=False),
        sa.Column('created_at', TS, nullable=False),
    )
    op.create_index(
        'uq_images_one_reference_per_turtle',
        'images',
        ['turtle_id'],
        unique=True,
        postgresql_where=sa.text('is_reference'),
        sqlite_where=sa.text('is_reference = 1'),
    )
    op.create_table(
        'submissions',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('org_id', sa.Integer, nullable=False, index=True),
        sa.Column('uploader_user_id', sa.Integer),
        sa.Column('uploader_email', sa.String(320)),
        sa.Column('uploader_is_staff', sa.Boolean, nullable=False),
        sa.Column('image_path', sa.String(500), nullable=False),
        sa.Column('feature_path', sa.String(500)),
        sa.Column('observed_at', TS),
        sa.Column('region_id', sa.Integer, sa.ForeignKey('regions.id', ondelete='SET NULL')),
        sa.Column('lat', sa.Float),
        sa.Column('lon', sa.Float),
        sa.Column('notes', sa.Text),
        sa.Column('status', sa.String(20), nullable=False, index=True),
        sa.Column('match_state', sa.String(20), nullable=False),
        sa.Column('candidates', Json, nullable=False),
        sa.Column(
            'resolved_turtle_id', sa.Integer, sa.ForeignKey('turtles.id', ondelete='SET NULL'),
        ),
        sa.Column('resolved_by', sa.Integer),
        sa.Column('resolved_at', TS),
        sa.Column('created_at', TS, nullable=False),
    )


def downgrade():
    op.drop_table('submissions')
    op.drop_index('uq_images_one_reference_per_turtle', table_name='images')
    op.drop_table('images')
    op.drop_table('sightings')
    op.drop_table('turtles')
    op.drop_table('regions')
