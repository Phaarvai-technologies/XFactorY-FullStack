"""Apply the database schema and the additive migrations.

    PYTHONPATH=. python -m app.migrate            # from the backend folder

- XY_Database_Schema.sql is applied only when the database is empty
  (it uses plain CREATE TABLE, so it cannot run twice).
- database/migrations/*.sql are idempotent and applied every time, in order.
"""
import asyncio
from pathlib import Path

import asyncpg

from app.core.config import get_settings


DATABASE_DIR = Path(__file__).resolve().parents[1] / "database"


async def main() -> None:
    url = get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    connection = await asyncpg.connect(url)
    try:
        has_schema = await connection.fetchval("SELECT to_regclass('public.users') IS NOT NULL")
        if not has_schema:
            schema = DATABASE_DIR / "XY_Database_Schema.sql"
            await connection.execute(schema.read_text(encoding="utf-8-sig"))
            print(f"Applied {schema.name}")
        else:
            print("Schema already present - skipping XY_Database_Schema.sql")
        has_storage = await connection.fetchval("SELECT to_regclass('storage.buckets') IS NOT NULL")
        for migration in sorted((DATABASE_DIR / "migrations").glob("*.sql")):
            sql = migration.read_text(encoding="utf-8-sig")
            if not has_storage and "storage.buckets" in sql:
                # Local Postgres (not Supabase): skip the bucket statement only.
                sql = sql.split("INSERT INTO storage.buckets")[0]
            await connection.execute(sql)
            print(f"Applied {migration.name}")
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(main())
