"""Seed English UI strings from a JSON file exported by the web app (apps/web/src/i18n/en.json).

Usage: uv run python scripts/seed_translations.py ../../apps/web/src/i18n/en.json
Keys already present are updated only if their source is 'human' (this file is the human source of truth).
"""

import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models.ops import Language, UiTranslation  # noqa: E402


def flatten(obj: dict, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in obj.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, key))
        else:
            out[key] = str(v)
    return out


async def main(path: Path) -> None:
    messages = flatten(json.loads(path.read_text(encoding="utf-8")))  # noqa: ASYNC240 - one-off CLI read
    async with SessionLocal() as db:
        if await db.get(Language, "en") is None:
            db.add(Language(code="en", name="English", native_name="English", sort_order=0))
        existing = {r.key: r for r in (await db.scalars(select(UiTranslation).where(UiTranslation.lang == "en"))).all()}
        now = datetime.now(UTC)
        n = 0
        for key, value in messages.items():
            row = existing.get(key)
            if row is None:
                db.add(UiTranslation(lang="en", key=key, value=value, source="human", updated_at=now))
                n += 1
            elif row.value != value:
                row.value, row.updated_at = value, now
                n += 1
        await db.commit()
    print(f"seeded {n} of {len(messages)} keys")


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
