from __future__ import annotations

import os
from dataclasses import dataclass

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.migrations import ensure_sqlite_schema
from app.db.models import Base

DEFAULT_DATABASE_URL = "sqlite:///./app.db"


def _get_database_url(database_url: str | None = None) -> str:
    return database_url or os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


def create_engine_from_url(database_url: str | None = None) -> Engine:
    url = _get_database_url(database_url)
    connect_args: dict[str, object] = {}
    if url.startswith("sqlite"):
        # Needed for FastAPI + SQLite usage with multiple threads.
        connect_args = {"check_same_thread": False}
    # If we are using an in-memory SQLite database for tests, make sure the
    # same connection is reused (otherwise each session gets a fresh empty DB).
    if url in {"sqlite://", "sqlite:///:memory:"} or ":memory:" in url:
        return create_engine(
            url,
            connect_args=connect_args,
            poolclass=StaticPool,
            pool_pre_ping=True,
        )
    return create_engine(url, connect_args=connect_args, pool_pre_ping=True)


@dataclass
class Database:
    engine: Engine
    SessionLocal: sessionmaker

    @classmethod
    def from_url(cls, database_url: str | None = None) -> "Database":
        engine = create_engine_from_url(database_url)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
        return cls(engine=engine, SessionLocal=SessionLocal)

    def create_tables(self) -> None:
        # Create missing tables (first-time run)
        Base.metadata.create_all(bind=self.engine)
        # Apply small, SQLite-friendly migrations (existing DB)
        ensure_sqlite_schema(self.engine)
