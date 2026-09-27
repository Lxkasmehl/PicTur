"""Alembic environment: runs on the connection handed over by orgs.db.upgrade_schema."""

from alembic import context

from orgs.models import Base

target_metadata = Base.metadata

connection = context.config.attributes.get('connection')
if connection is None:
    raise RuntimeError('Run migrations through orgs.db.upgrade_schema (needs a bound connection).')

context.configure(
    connection=connection,
    target_metadata=target_metadata,
    render_as_batch=connection.dialect.name == 'sqlite',
)
with context.begin_transaction():
    context.run_migrations()
