from __future__ import annotations

"""Very small, SQLite-friendly migrations.

This project intentionally avoids a full migration framework (Alembic) for
simplicity, because the "step" builds are designed to be run locally.

When deployed to a managed Postgres (e.g. Supabase), you'd typically switch to
Alembic and run real migrations.

For local SQLite, we just ensure newly introduced columns/tables exist.
"""

from sqlalchemy import text
from sqlalchemy.engine import Engine


def _has_table(conn, name: str) -> bool:
    q = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"), {"n": name}).fetchone()
    return q is not None


def _columns(conn, table: str) -> set[str]:
    cols = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    # PRAGMA returns: cid, name, type, notnull, dflt_value, pk
    return {str(c[1]) for c in cols}


def ensure_sqlite_schema(engine: Engine) -> None:
    """Apply small schema fixes for SQLite databases."""

    if engine.url.get_backend_name() != "sqlite":
        return

    with engine.begin() as conn:
        # Users table
        if not _has_table(conn, "users"):
            conn.execute(
                text(
                    """
                    CREATE TABLE users (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      user_id VARCHAR(36) NOT NULL UNIQUE,
                      display_name VARCHAR(120) NOT NULL,
                      email VARCHAR(220),
                      created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
                      updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL
                    );
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_user_id ON users(user_id);"))

        # Runs: add user_id
        if _has_table(conn, "runs"):
            cols = _columns(conn, "runs")
            if "user_id" not in cols:
                conn.execute(text("ALTER TABLE runs ADD COLUMN user_id VARCHAR(36);"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_runs_user_id ON runs(user_id);"))

        # Portfolios: add user_id
        if _has_table(conn, "portfolios"):
            cols = _columns(conn, "portfolios")
            if "user_id" not in cols:
                conn.execute(text("ALTER TABLE portfolios ADD COLUMN user_id VARCHAR(36);"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_portfolios_user_id ON portfolios(user_id);"))

        # Stress packs table
        if not _has_table(conn, "stress_packs"):
            conn.execute(
                text(
                    """
                    CREATE TABLE stress_packs (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      pack_id VARCHAR(36) NOT NULL UNIQUE,
                      user_id VARCHAR(36),
                      name VARCHAR(160) NOT NULL,
                      description VARCHAR(400) NOT NULL DEFAULT '',
                      short_rate_shock_bps FLOAT NOT NULL,
                      long_rate_shock_bps FLOAT NOT NULL,
                      fx_spot_shock_pct FLOAT NOT NULL,
                      inflation_shock_pp FLOAT NOT NULL,
                      tags_json TEXT NOT NULL DEFAULT '[]',
                      created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
                      updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL
                    );
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_stress_packs_pack_id ON stress_packs(pack_id);"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_stress_packs_user_id ON stress_packs(user_id);"))
