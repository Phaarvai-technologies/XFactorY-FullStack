"""Detects a database that is missing the migrations this backend needs.

A missing column otherwise only shows up as a failed request, so the check runs
at startup (logged) and at GET /health/ready.
"""
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

log = logging.getLogger("xy.schema")

MIGRATION_HINT = (
    "Run `python -m app.migrate` in the backend folder (with PYTHONPATH=.), or run "
    "database/migrations/004_*.sql, 005_*.sql and 006_*.sql in the Supabase SQL editor."
)

# (table, column or None for "table must exist", migration that adds it)
REQUIRED = [
    ("manufacturer_onboarding", None, "XY_Database_Schema.sql"),
    ("manufacturer_availability_preferences", None, "004_manufacturer_api_support.sql"),
    ("facilities", "sez_status", "004_manufacturer_api_support.sql"),
    ("facilities", "serviceable_areas", "004_manufacturer_api_support.sql"),
    ("organization_profiles", "country_name", "006_frontend_field_support.sql"),
    ("organization_profiles", "production_capacity_label", "006_frontend_field_support.sql"),
    ("facilities", "country_name", "006_frontend_field_support.sql"),
    ("facilities", "map_pin", "006_frontend_field_support.sql"),
    ("organization_certifications", "document_file_name", "006_frontend_field_support.sql"),
    ("manufacturer_faq_answers", "display_order", "006_frontend_field_support.sql"),
    ("manufacturer_form_progress", None, "007_form_progress.sql"),
]


async def missing_schema(engine: AsyncEngine) -> list[str]:
    async with engine.connect() as conn:
        rows = await conn.execute(text("""
            SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public'
        """))
        columns = {(r.table_name, r.column_name) for r in rows}
    tables = {t for t, _ in columns}
    problems = []
    for table, column, migration in REQUIRED:
        if column is None and table not in tables:
            problems.append(f"table {table} (from {migration})")
        elif column is not None and (table, column) not in columns:
            problems.append(f"column {table}.{column} (from {migration})")
    return problems


async def log_schema_status(engine: AsyncEngine) -> list[str] | None:
    try:
        problems = await missing_schema(engine)
    except Exception as exc:  # noqa: BLE001 - startup must not crash on DB trouble
        log.error("Could not check the database schema: %s", exc)
        return None
    if problems:
        log.error("DATABASE IS MISSING MIGRATIONS - API calls will fail.\n  Missing: %s\n  Fix: %s",
                  "\n           ".join(problems), MIGRATION_HINT)
    else:
        log.info("Database schema OK")
    return problems
