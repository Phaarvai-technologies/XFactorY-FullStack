"""Import manufacturer companies from a CSV file, without duplicates.

    PYTHONPATH=. python -m app.import_manufacturers companies.csv --dry-run   # report only
    PYTHONPATH=. python -m app.import_manufacturers companies.csv             # import

Columns (header names are case-insensitive; only a company name is required):
    company_name | name | company        country           state | state_province
    city                                 address           category | company_type | industry
    website                              registration_id | gstin | cin
    email                                phone             capacity

Each new company is created with the existing schema exactly like an admin-imported listing:
`organizations` (organization_type 'manufacturer', status 'claim_pending', entry_source
'IMPORTED', no owner), `organization_profiles`, and a headquarters `facilities` row holding the
location. Nobody gets ownership; owners are only ever added through the normal workflow.
Imported companies are NOT approved: they are selectable in onboarding lookup, never visible to
Visionaries until an admin approves them and their profile is 100% complete.

Onboarding source: every company this job inserts gets onboarding_source 'database_import' and
the id of the run's `import_batches` row (file name, content SHA-256, operator / job, time), and
an 'imported' history event. The batch is identified by the file's content, so re-running the same
file reuses its batch. Companies that were already present are left untouched (their original
source is never changed). `--actor` names the operator or job (default: the OS user).

Duplicates: a row is "already present" when it matches an existing listed company (or an
earlier row of the same file) by
  1. the same registration id, or
  2. the same name AND the same website domain, or
  3. the same name AND the same country AND the same city.
A company is never identified by its name alone: a row whose name exists but which has no
location or identifier to compare is reported as AMBIGUOUS and skipped (fix the row and re-run).
Re-running the same file therefore inserts nothing new. Everything runs in one transaction.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import getpass
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import text

from app.core import onboarding_source
from app.repositories.manufacturer import COUNTRY_CODES, LISTED_COMPANY_SQL, normalize_company_name

SOURCE = "database_import"

ALIASES = {
    "name": ("company_name", "name", "company", "manufacturer", "manufacturer_name"),
    "country": ("country", "country_name"),
    "state": ("state", "state_province", "province", "region"),
    "city": ("city", "town"),
    "address": ("address", "address_line1", "street"),
    "category": ("category", "company_type", "industry", "company_category"),
    "website": ("website", "website_domain", "url", "web"),
    "registration_id": ("registration_id", "gstin", "gst", "cin", "company_registration_number"),
    "email": ("email", "contact_email"),
    "phone": ("phone", "contact_phone", "mobile"),
    "capacity": ("capacity", "production_capacity"),
}


def _clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def website_domain(value: str) -> str:
    v = _clean(value).lower()
    v = re.sub(r"^[a-z]+://", "", v).split("/")[0].split("?")[0]
    return v[4:] if v.startswith("www.") else v


def read_rows(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        headers = {(h or "").strip().lower().replace(" ", "_"): h for h in reader.fieldnames or []}
        rows = []
        for raw in reader:
            row = {}
            for key, names in ALIASES.items():
                source = next((headers[n] for n in names if n in headers), None)
                row[key] = _clean(raw.get(source)) if source else ""
            rows.append(row)
        return rows


@dataclass
class Report:
    batch_id: str | None = None
    inserted: list[tuple[int, str, str]] = field(default_factory=list)
    present: list[tuple[int, str, str, str]] = field(default_factory=list)
    ambiguous: list[tuple[int, str, str]] = field(default_factory=list)
    invalid: list[tuple[int, str]] = field(default_factory=list)


EXISTING_SQL = f"""
    SELECT o.id::text AS id, o.display_name,
           lower(regexp_replace(btrim(o.display_name), '\\s+', ' ', 'g')) AS norm,
           lower(btrim(COALESCE(op.registration_id, ''))) AS reg,
           lower(btrim(COALESCE(o.website_domain, ''))) AS web,
           lower(btrim(COALESCE(op.country_name, f.country_name, ''))) AS country,
           lower(btrim(COALESCE(f.city, ''))) AS city
    FROM organizations o
    LEFT JOIN organization_profiles op ON op.organization_id = o.id
    LEFT JOIN LATERAL (SELECT city, country_name FROM facilities
                       WHERE organization_id = o.id AND is_headquarters AND status <> 'suspended' LIMIT 1) f ON true
    WHERE {LISTED_COMPANY_SQL}
      AND (lower(regexp_replace(btrim(o.display_name), '\\s+', ' ', 'g')) = :norm
           OR (:reg <> '' AND lower(btrim(COALESCE(op.registration_id, ''))) = :reg))
"""


def match(row: dict, candidates) -> tuple[str, object | None]:
    """('present', record) | ('ambiguous', None) | ('new', None)."""
    norm = normalize_company_name(row["name"])
    reg = row["registration_id"].lower()
    web = website_domain(row["website"])
    country, city = row["country"].lower(), row["city"].lower()
    for c in candidates:
        if reg and c.reg == reg:
            return "present", c
    same_name = [c for c in candidates if c.norm == norm]
    for c in same_name:
        if web and c.web == web:
            return "present", c
        if country and c.country == country and city == c.city:
            return "present", c
    if same_name and not (country or city or web or reg):
        return "ambiguous", None  # nothing but the name to compare: never guess
    return "new", None


def _default_actor() -> str:
    try:
        return f"os:{getpass.getuser()}"
    except Exception:  # noqa: BLE001 - no login name in some containers
        return "os:unknown"


async def ensure_batch(session, *, reference: str, content_sha256: str, actor: str, row_count: int):
    """The import_batches row for this content (created once; a re-run only updates last_run_at)."""
    return await session.scalar(text("""
        INSERT INTO import_batches (source_reference, content_sha256, imported_by, row_count)
        VALUES (:ref, :sha, :actor, :n)
        ON CONFLICT (content_sha256) DO UPDATE SET last_run_at = now()
        RETURNING id
    """), {"ref": reference, "sha": content_sha256, "actor": actor, "n": row_count})


async def import_rows(session, rows: list[dict], *, reference: str = "(rows passed in code)",
                      content_sha256: str | None = None, actor: str | None = None) -> Report:
    onboarding_source.require(SOURCE)
    report = Report()
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended('xy-import-manufacturers', 0))"))
    if content_sha256 is None:
        content_sha256 = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()
    batch_id = await ensure_batch(session, reference=reference, content_sha256=content_sha256,
                                  actor=actor or _default_actor(), row_count=len(rows))
    report.batch_id = str(batch_id)
    for number, row in enumerate(rows, start=2):  # line 1 is the header
        if not row["name"]:
            report.invalid.append((number, "missing company name"))
            continue
        candidates = (await session.execute(text(EXISTING_SQL), {
            "norm": normalize_company_name(row["name"]), "reg": row["registration_id"].lower()})).all()
        verdict, found = match(row, candidates)
        if verdict == "present":
            report.present.append((number, row["name"], found.id, found.display_name))
            continue
        if verdict == "ambiguous":
            report.ambiguous.append((number, row["name"], "name exists; add country/city, website or registration id"))
            continue
        code = COUNTRY_CODES.get(row["country"].lower())
        if code and not await session.scalar(text("SELECT 1 FROM countries WHERE code=:c"), {"c": code}):
            code = None
        org_id = await session.scalar(text("""
            INSERT INTO organizations (display_name, legal_name, organization_type, status, website_domain,
                                       entry_source, record_type, onboarding_source, import_batch_id)
            VALUES (:name, :name, 'manufacturer', 'claim_pending', NULLIF(:web, ''), 'IMPORTED', 'REAL',
                    :src, :batch)
            RETURNING id
        """), {"name": row["name"], "web": website_domain(row["website"]), "src": SOURCE, "batch": batch_id})
        await session.execute(text("""
            INSERT INTO organization_profiles (organization_id, registration_id, contact_email, contact_phone,
                                               address_line1, country_code, country_name, company_category,
                                               production_capacity_label)
            VALUES (:org, NULLIF(:reg, ''), NULLIF(:email, ''), NULLIF(:phone, ''), NULLIF(:address, ''),
                    :code, NULLIF(:country, ''), NULLIF(:category, ''), NULLIF(:capacity, ''))
        """), {"org": org_id, "reg": row["registration_id"], "email": row["email"], "phone": row["phone"],
                "address": row["address"], "code": code, "country": row["country"],
                "category": row["category"], "capacity": row["capacity"]})
        if row["city"] or row["state"] or row["address"] or row["country"]:
            await session.execute(text("""
                INSERT INTO facilities (organization_id, name, facility_type, is_headquarters, status, visibility,
                                        address, city, state_province, country_name, country_code)
                VALUES (:org, :fname, 'factory', true, 'draft', 'private', NULLIF(:address, ''), NULLIF(:city, ''),
                        NULLIF(:state, ''), NULLIF(:country, ''), :code)
            """), {"org": org_id, "fname": f"{row['name']} Headquarters", "address": row["address"],
                    "city": row["city"], "state": row["state"], "country": row["country"], "code": code})
        from app.manufacturer_approval import record_event
        await record_event(session, event="imported", role="system", source=SOURCE, organization_id=org_id,
                           import_batch_id=batch_id, key=f"imported:{org_id}",
                           details={"line": number, "reference": reference})
        report.inserted.append((number, row["name"], str(org_id)))
    return report


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("csv", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="report what would happen; change nothing")
    parser.add_argument("--actor", help="operator or job name recorded on the import batch (default: OS user)")
    args = parser.parse_args(argv)
    from app.core.database import SessionFactory, engine

    rows = read_rows(args.csv)
    async with SessionFactory() as session:
        report = await import_rows(session, rows, reference=args.csv.name,
                                   content_sha256=hashlib.sha256(args.csv.read_bytes()).hexdigest(),
                                   actor=args.actor)
        if args.dry_run:
            await session.rollback()
        else:
            await session.commit()
    await engine.dispose()
    label = "would insert" if args.dry_run else "inserted"
    print(f"rows: {len(rows)}  {label}: {len(report.inserted)}  already present: {len(report.present)}  "
          f"ambiguous (skipped): {len(report.ambiguous)}  invalid: {len(report.invalid)}  "
          f"batch: {'(not saved)' if args.dry_run else report.batch_id}")
    for n, name, why in report.ambiguous:
        print(f"  AMBIGUOUS line {n}: {name} - {why}")
    for n, why in report.invalid:
        print(f"  INVALID line {n}: {why}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
