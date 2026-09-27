"""
Database engine and sessions for the database-backed research groups.

DATABASE_URL is optional: without it the app still starts and serves the main group; the
research-group API answers 503.
"""

import logging
import os
import threading
import time
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import scoped_session, sessionmaker

logger = logging.getLogger(__name__)

_engine = None
_init_lock = threading.Lock()

Session = scoped_session(sessionmaker(expire_on_commit=False))


def normalize_database_url(url: str) -> str:
    """postgres:// and postgresql:// URLs use the psycopg (v3) driver."""
    if url.startswith('postgres://'):
        url = 'postgresql://' + url[len('postgres://'):]
    if url.startswith('postgresql://'):
        url = 'postgresql+psycopg://' + url[len('postgresql://'):]
    return url


def database_url() -> str:
    return normalize_database_url(os.environ.get('DATABASE_URL', '').strip())


def is_configured() -> bool:
    return _engine is not None


_RETRY_SECONDS = 30
_last_attempt = 0.0


def ensure_engine() -> bool:
    """True when the database is usable. If DATABASE_URL is set but the database was unreachable at
    start-up (e.g. PostgreSQL still booting), retry at most every 30 seconds."""
    global _last_attempt
    if _engine is not None:
        return True
    if not database_url():
        return False
    now = time.monotonic()
    if now - _last_attempt < _RETRY_SECONDS:
        return False
    _last_attempt = now
    try:
        return init_engine() is not None
    except Exception as exc:
        logger.warning('Research-group database still unavailable: %s', exc)
        return False


def init_engine(url: str | None = None, *, run_migrations: bool = True):
    """Create the engine (idempotent) and bring the schema to the latest revision."""
    global _engine
    with _init_lock:
        if _engine is not None:
            return _engine
        url = normalize_database_url(url) if url else database_url()
        if not url:
            logger.info('DATABASE_URL not set; research-group database disabled.')
            return None
        kwargs = {'pool_pre_ping': True, 'future': True}
        if url.startswith('sqlite'):
            kwargs['connect_args'] = {'check_same_thread': False}
        engine = create_engine(url, **kwargs)
        if url.startswith('sqlite'):
            @event.listens_for(engine, 'connect')
            def _sqlite_fk(dbapi_conn, _record):
                dbapi_conn.execute('PRAGMA foreign_keys=ON')
        if run_migrations:
            upgrade_schema(engine)
        Session.configure(bind=engine)
        _engine = engine
        logger.info('Research-group database ready.')
        return engine


def upgrade_schema(engine):
    """Run Alembic migrations up to head on the given engine."""
    from alembic import command
    from alembic.config import Config

    cfg = Config()
    cfg.set_main_option('script_location', str(Path(__file__).parent / 'migrations'))
    with engine.begin() as connection:
        cfg.attributes['connection'] = connection
        command.upgrade(cfg, 'head')


def reset_for_tests():
    """Dispose the engine so tests can bind a fresh database."""
    global _engine
    with _init_lock:
        Session.remove()
        if _engine is not None:
            _engine.dispose()
        _engine = None
