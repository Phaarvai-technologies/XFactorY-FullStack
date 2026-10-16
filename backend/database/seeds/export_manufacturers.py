"""READ-ONLY: export every manufacturer company (Real and Demo) to one CSV file you can open in Excel.

Usage (PowerShell):
    $env:DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/postgres"
    python database\\seeds\\export_manufacturers.py

Creates manufacturers_<date-time>.csv in the current folder. Nothing in the database changes.
"""
import datetime
import os
import sys

import psycopg

QUERY = """
COPY (
  SELECT o.record_type,
         CASE WHEN o.source_ref LIKE 'india_mfr_research:TN-%' THEN 'Tamil Nadu import'
              WHEN o.source_ref LIKE 'india_mfr_research:%'    THEN 'India import'
              ELSE 'existing company' END                                         AS origin,
         o.display_name, f.city, f.state_province, f.country_name,
         (SELECT mo.status FROM manufacturer_onboarding mo WHERE mo.organization_id = o.id) AS approval,
         o.onboarding_source, o.source_ref, o.created_at, o.id
  FROM organizations o
  LEFT JOIN facilities f ON f.organization_id = o.id AND f.is_headquarters
  WHERE o.organization_type = 'manufacturer'
  ORDER BY o.record_type, o.display_name
) TO STDOUT WITH (FORMAT csv, HEADER true)
"""


def main():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print('DATABASE_URL is not set. Run:  $env:DATABASE_URL="postgresql://..."')
        sys.exit(1)
    out = f"manufacturers_{datetime.datetime.now():%Y%m%d_%H%M%S}.csv"
    with psycopg.connect(dsn) as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        with conn.cursor() as cur, open(out, "wb") as f:
            f.write("﻿".encode("utf-8"))  # so Excel opens Tamil / special characters correctly
            with cur.copy(QUERY) as copy:
                for data in copy:
                    f.write(data)
        conn.rollback()
    with open(out, encoding="utf-8-sig") as f:
        rows = sum(1 for _ in f) - 1
    print(f"Exported {rows} manufacturer companies (Real + Demo) -> {os.path.abspath(out)}")


if __name__ == "__main__":
    main()
