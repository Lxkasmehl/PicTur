"""
Data model of the database-backed research groups.

Every table carries org_id (the organization id from the auth backend; no cross-database foreign
key). All queries go through orgs.tenancy.org_query so a request can only ever see its own group.
File paths are relative to the group's storage root (orgs.storage).
"""

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

JsonType = JSON().with_variant(JSONB(), 'postgresql')

TURTLE_STATUSES = ('active', 'deceased', 'released')
TURTLE_SEXES = ('F', 'M', 'U')
SUBMISSION_STATUSES = ('pending', 'approved', 'rejected')


def utcnow():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Region(Base):
    """Group-defined area (hierarchical: e.g. state > site)."""

    __tablename__ = 'regions'
    __table_args__ = (UniqueConstraint('org_id', 'parent_id', 'name', name='uq_regions_org_parent_name'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey('regions.id', ondelete='RESTRICT'))
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Turtle(Base):
    __tablename__ = 'turtles'
    __table_args__ = (
        UniqueConstraint('org_id', 'primary_id', name='uq_turtles_org_primary_id'),
        UniqueConstraint('org_id', 'bio_id', name='uq_turtles_org_bio_id'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    # Stable, never-reused identifier (same scheme as the main group's Primary ID).
    primary_id: Mapped[str] = mapped_column(String(40))
    # Human-facing biology ID: sex letter + running number per group (F1, M2, U3...).
    bio_id: Mapped[str] = mapped_column(String(40))
    name: Mapped[str | None] = mapped_column(String(120))
    sex: Mapped[str] = mapped_column(String(1), default='U')
    species: Mapped[str | None] = mapped_column(String(120))
    region_id: Mapped[int | None] = mapped_column(ForeignKey('regions.id', ondelete='SET NULL'))
    status: Mapped[str] = mapped_column(String(20), default='active')
    notes: Mapped[str | None] = mapped_column(Text)
    extra: Mapped[dict] = mapped_column(JsonType, default=dict)
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    sightings: Mapped[list['Sighting']] = relationship(
        back_populates='turtle', cascade='all, delete-orphan', order_by='Sighting.observed_at.desc()'
    )
    images: Mapped[list['Image']] = relationship(
        back_populates='turtle', cascade='all, delete-orphan', order_by='Image.created_at'
    )


class Sighting(Base):
    """One encounter with a turtle (first capture or re-sighting)."""

    __tablename__ = 'sightings'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    turtle_id: Mapped[int] = mapped_column(ForeignKey('turtles.id', ondelete='CASCADE'), index=True)
    observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    region_id: Mapped[int | None] = mapped_column(ForeignKey('regions.id', ondelete='SET NULL'))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    observer_user_id: Mapped[int | None] = mapped_column(Integer)
    observer_name: Mapped[str | None] = mapped_column(String(200))
    measurements: Mapped[dict] = mapped_column(JsonType, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    turtle: Mapped[Turtle] = relationship(back_populates='sightings')


class Image(Base):
    """Carapace photo of a turtle. Exactly one per turtle is the matching reference."""

    __tablename__ = 'images'
    __table_args__ = (
        Index(
            'uq_images_one_reference_per_turtle',
            'turtle_id',
            unique=True,
            postgresql_where=text('is_reference'),
            sqlite_where=text('is_reference = 1'),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    turtle_id: Mapped[int] = mapped_column(ForeignKey('turtles.id', ondelete='CASCADE'), index=True)
    sighting_id: Mapped[int | None] = mapped_column(ForeignKey('sightings.id', ondelete='SET NULL'))
    kind: Mapped[str] = mapped_column(String(20), default='carapace')
    path: Mapped[str] = mapped_column(String(500))
    feature_path: Mapped[str | None] = mapped_column(String(500))
    is_reference: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    turtle: Mapped[Turtle] = relationship(back_populates='images')


class Submission(Base):
    """An uploaded photo awaiting review (from staff or the community)."""

    __tablename__ = 'submissions'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    uploader_user_id: Mapped[int | None] = mapped_column(Integer)
    uploader_email: Mapped[str | None] = mapped_column(String(320))
    uploader_is_staff: Mapped[bool] = mapped_column(Boolean, default=False)
    image_path: Mapped[str] = mapped_column(String(500))
    feature_path: Mapped[str | None] = mapped_column(String(500))
    observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    region_id: Mapped[int | None] = mapped_column(ForeignKey('regions.id', ondelete='SET NULL'))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default='pending', index=True)
    # 'pending' | 'done' | 'failed' — background matching state for community uploads
    match_state: Mapped[str] = mapped_column(String(20), default='pending')
    candidates: Mapped[list] = mapped_column(JsonType, default=list)
    resolved_turtle_id: Mapped[int | None] = mapped_column(ForeignKey('turtles.id', ondelete='SET NULL'))
    resolved_by: Mapped[int | None] = mapped_column(Integer)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
