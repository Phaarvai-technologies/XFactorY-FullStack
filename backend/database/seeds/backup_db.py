"""READ-ONLY backup: export every table of the public schema to CSV files (plus a summary).

Usage (PowerShell):
    $env:DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/postgres"
    python database\\seeds\\backup_db.py

Creates folder  backup_<database>_<date-time>\\  with one <table>.csv per table (header row, all
columns, NULL written as empty) and _summary.csv (table, rows). Nothing in the database changes:
the whole export runs in one READ ONLY transaction, so all files are from the same moment.
"""
import csv
import datetime
import os
import sys
from pathlib import Path

import psycopg


def main():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print('DATABASE_URL is not set. Run:  $env:DATABASE_URL="postgresql://..."')
        sys.exit(1)
    sslmode = "disable" if os.environ.get("PGSSL") == "disable" else "prefer"
    with psycopg.connect(dsn, sslmode=sslmode) as conn:
        conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        db = conn.execute("SELECT current_database()").fetchone()[0]
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        out = Path(f"backup_{db}_{stamp}")
        out.mkdir()
        tables = [r[0] for r in conn.execute("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name""")]
        summary = []
        for t in tables:
            path = out / f"{t}.csv"
            rows = 0
            with conn.cursor() as cur, path.open("wb") as f:
                with cur.copy(f'COPY public."{t}" TO STDOUT WITH (FORMAT csv, HEADER true)') as copy:
                    for data in copy:
                        f.write(data)
                rows = conn.execute(f'SELECT count(*) FROM public."{t}"').fetchone()[0]
            summary.append((t, rows))
            print(f"  {t:45} {rows:>8} rows")
        with (out / "_summary.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["table", "rows"])
            w.writerows(summary)
        conn.rollback()
    total = sum(n for _, n in summary)
    print(f"\nBackup complete: {len(summary)} tables, {total} rows -> {out.resolve()}")


if __name__ == "__main__":
    main()
