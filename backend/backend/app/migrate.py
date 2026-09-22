import asyncio
from pathlib import Path

import asyncpg

from app.core.config import get_settings


async def main() -> None:
    schema_path = (
        Path(__file__).resolve().parents[2]
        / "database"
        / "XY_Database_Schema.sql"
    )
    sql = schema_path.read_text(encoding="utf-8-sig")
    database_url = get_settings().database_url.replace(
        "postgresql+asyncpg://", "postgresql://", 1
    )
    connection = await asyncpg.connect(database_url)
    try:
        await connection.execute(sql)
    finally:
        await connection.close()
    print(f"Applied {schema_path.name}")


if __name__ == "__main__":
    asyncio.run(main())
