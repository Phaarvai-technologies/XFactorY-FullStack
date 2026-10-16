#!/usr/bin/env python3
"""
Run the India manufacturer seed files against Postgres from the backend.

Setup (one time):
    pip install "psycopg[binary]"

Usage:
    DATABASE_URL="postgresql://user:pass@host:5432/db" python run_seed.py seed_part1.sql seed_part2.sql

Optional environment variables:
    SEED_DRY_RUN=1   run everything, then ROLLBACK instead of COMMIT (nothing saved)
    PGSSL=disable    turn off SSL (e.g. local database). Default: sslmode=require

Each file contains its own BEGIN ... COMMIT, so each file is all-or-nothing.
Run it as a one-off command — do not expose it as an API endpoint.
"""
import os
import re
import sys
import time

import psycopg


def print_rows(cur):
    if cur.description is None:
        return
    rows = cur.fetchall()
    if not rows:
        return
    cols = [d.name for d in cur.description]
    widths = [max(len(str(c)), *(len(str(r[i])) for r in rows)) for i, c in enumerate(cols)]
    print("  " + " | ".join(str(c).ljust(w) for c, w in zip(cols, widths)))
    print("  " + "-+-".join("-" * w for w in widths))
    for r in rows[:50]:
        print("  " + " | ".join(str(v).ljust(w) for v, w in zip(r, widths)))
    if len(rows) > 50:
        print(f"  ... {len(rows) - 50} more rows")
    print()


def run_file(path, dsn, dry_run, sslmode):
    with open(path, encoding="utf-8") as f:
        sql = f.read()
    if dry_run:
        n = len(re.findall(r"^COMMIT;$", sql, flags=re.M))
        if n != 1:
            raise RuntimeError(f'{path}: expected exactly one "COMMIT;" line, found {n}')
        sql = re.sub(r"^COMMIT;$", "ROLLBACK;", sql, count=1, flags=re.M)

    print(f"\n=== {path}{' (dry run - will ROLLBACK)' if dry_run else ''} ===")
    started = time.time()
    # autocommit=True: the file's own BEGIN/COMMIT controls the transaction.
    with psycopg.connect(dsn, autocommit=True, sslmode=sslmode) as conn:
        conn.add_notice_handler(lambda d: print(f"  NOTICE: {d.message_primary}"))
        try:
            with conn.cursor() as cur:
                # No parameters => the whole multi-statement file runs in one call.
                cur.execute(sql)
                while True:
                    print_rows(cur)
                    if not cur.nextset():
                        break
        except Exception as e:
            try:
                conn.execute("ROLLBACK")
            except Exception:
                pass
            raise RuntimeError(f"{path} failed and was rolled back: {e}") from None
    print(f"=== {path}: done in {time.time() - started:.1f}s ===")


def main():
    files = sys.argv[1:]
    dsn = os.environ.get("DATABASE_URL")
    if not dsn or not files:
        print("Usage: DATABASE_URL=... python run_seed.py seed_part1.sql [seed_part2.sql ...]", file=sys.stderr)
        sys.exit(1)
    dry_run = os.environ.get("SEED_DRY_RUN") == "1"
    sslmode = "disable" if os.environ.get("PGSSL") == "disable" else "require"
    try:
        for f in files:
            run_file(f, dsn, dry_run, sslmode)
    except Exception as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        sys.exit(1)
    print("\nAll seed files finished.")


if __name__ == "__main__":
    main()
