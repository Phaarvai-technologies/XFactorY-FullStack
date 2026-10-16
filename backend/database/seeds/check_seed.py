"""Check whether the India manufacturer seed data is in the database.

Usage (PowerShell):
    $env:DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE"
    python database\\seeds\\check_seed.py
"""
import os
import sys

import psycopg

dsn = os.environ.get("DATABASE_URL")
if not dsn:
    print("DATABASE_URL is not set. Run:  $env:DATABASE_URL=\"postgresql://...\"")
    sys.exit(1)

sslmode = "disable" if os.environ.get("PGSSL") == "disable" else "prefer"
with psycopg.connect(dsn, sslmode=sslmode) as conn:
    db, user, host = conn.execute("SELECT current_database(), current_user, inet_server_addr()::text").fetchone()
    print(f"Connected to database: {db}  (user: {user}, server: {host})")

    total = conn.execute("SELECT count(*) FROM organizations").fetchone()[0]
    imported = conn.execute(
        "SELECT count(*) FROM organizations WHERE source_ref LIKE 'india_mfr_research:%'"
    ).fetchone()[0]
    print(f"All organizations:          {total}")
    print(f"Imported India manufacturers: {imported}   (expected about 22427)")

    if imported:
        print("\nBy status:")
        for status, verification, n in conn.execute(
            "SELECT status, verification_status, count(*) FROM organizations "
            "WHERE source_ref LIKE 'india_mfr_research:%' GROUP BY 1, 2 ORDER BY 3 DESC"
        ):
            print(f"  {status:15} {verification:12} {n}")
        print("\nSample rows:")
        for name, geo in conn.execute(
            "SELECT display_name, primary_geography FROM organizations "
            "WHERE source_ref LIKE 'india_mfr_research:%' ORDER BY created_at LIMIT 5"
        ):
            print(f"  {name}  |  {geo}")
        print("\nRESULT: seed data IS in this database.")
    else:
        print("\nRESULT: seed data is NOT in this database. Run run_seed.py (without SEED_DRY_RUN) and paste its output.")
