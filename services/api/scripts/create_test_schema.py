"""Build the test schema directly from the SQLAlchemy models.

`scripts/local-db.sh` (Docker + `alembic upgrade head`) is the real path and stays the source of truth. This is
the fallback for a machine where Docker cannot run — on Windows that needs WSL, which needs a reboot — so the
database-backed tests can still be exercised against a plain PostgreSQL binary with no admin rights and no
container.

Two deliberate differences from a migrated database, both stated rather than hidden:

  * The schema comes from the models, not from the migration chain, so this does not catch migration drift.
    `alembic check` is what does that, and it needs a database of its own.
  * `embeddings` is skipped when the `vector` extension is unavailable. pgvector is not part of a stock
    PostgreSQL distribution and cannot be installed without a compiler. No database-backed test touches
    embeddings — they cover the ledger, access rules, rewards and purchase settlement — so their coverage is
    unaffected, and semantic search is exercised against a real pgvector instance in CI.

Usage:
    KATHA_TEST_DATABASE_URL=postgresql+asyncpg://... uv run python scripts/create_test_schema.py
"""

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.core.db import Base  # noqa: E402
from app.models import catalog, engagement, identity, ops, wallet  # noqa: E402,F401 - registers every mapper

VECTOR_TABLES = {"embeddings"}


async def main(url: str) -> None:
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        has_vector = bool(
            await conn.scalar(text("select 1 from pg_available_extensions where name = 'vector'"))
        )
        for extension in ("pg_trgm", *(("vector",) if has_vector else ())):
            await conn.execute(text(f"CREATE EXTENSION IF NOT EXISTS {extension}"))

        tables = [t for name, t in Base.metadata.tables.items() if has_vector or name not in VECTOR_TABLES]
        await conn.run_sync(Base.metadata.drop_all, tables=tables, checkfirst=True)
        await conn.run_sync(Base.metadata.create_all, tables=tables)

    await engine.dispose()
    skipped = "" if has_vector else f" (skipped {', '.join(sorted(VECTOR_TABLES))}: no pgvector)"
    print(f"created {len(tables)} tables{skipped}")


if __name__ == "__main__":
    target = os.environ.get("KATHA_TEST_DATABASE_URL")
    if not target:
        raise SystemExit("KATHA_TEST_DATABASE_URL is not set")
    asyncio.run(main(target))
