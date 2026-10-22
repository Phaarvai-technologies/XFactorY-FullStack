"""Evidence-based backfill of company onboarding sources and user registration channels.

    PYTHONPATH=. python -m app.backfill_onboarding_source                         # dry run (default)
    PYTHONPATH=. python -m app.backfill_onboarding_source --report report.csv     # dry run + CSV
    PYTHONPATH=. python -m app.backfill_onboarding_source --apply                 # write (one transaction)
    options: --evidence-ids imported_ids.csv   organization ids (or registration ids) from import logs
             --accept-direct-load              also assign database_import to rows loaded directly
                                               into the database (rule D1, see below)

Only records whose value is missing are examined; a value that is already set is never changed.
Nothing else is touched: approval status, reviewers, owners, memberships, claims and ids stay as
they are. Every examined record is written to onboarding_source_backfill_log (applied /
unresolved / conflict, rule, evidence, time of the run); applied companies also get a
'source_backfilled' history event. Running again finds nothing new and adds no duplicate rows.

Company rules (manufacturer organizations with onboarding_source NULL), first match wins:
  E1 database_import  id (or unique registration id) listed in the --evidence-ids file
  I1 database_import  an 'imported' history event exists for the company
  I2 database_import  entry_source 'IMPORTED' (written only by app.import_manufacturers), no app
                      user created it, and no admin ever edited its entry source
  A1 admin_entry      an admin 'created' history event (admin dashboard Add company, admin recorded)
  W1 web_dashboard    created by an app user for themselves and its dashboard 'new company'
                      submission was approved (a pending / rejected one keeps its source on the
                      submission; approval copies it automatically)
  W2 web_dashboard    created by an app user, the dashboard details form was submitted for it
                      (manufacturer_onboarding.personal_information_completed) and the form's
                      company category was saved on it, and it never served as a placeholder
                      for a claim / update request of another company (accounts from before
                      admin approval existed, which have no submission row)
  D1 database_import  no creating user and no Clerk organization: no application workflow
                      creates such a row, so it was loaded straight into the database (seed /
                      SQL import). Applied only with --accept-direct-load, because a row typed in
                      by hand in the database editor looks the same.
  Conflicts (import evidence AND app-user creation evidence) are reported, never assigned.
  admin_entry is assigned only from an admin creation event (A1), never from approvals or edits.

User rules (users.registration_channel NULL):
  U1 admin_portal     staff admin account (clerk_user_id 'local-admin:...', created by the admin tool)
  U2 web_signup       registration_method 'manual' / 'google' (set only by website Sign-up)
  U3 legacy_account   registration_method 'legacy...' (pre-registration account recognised from evidence)
  otherwise unresolved (e.g. not registered yet).
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import text
from app.core.cli import run as run_cli

COMPANY_FACTS_SQL = """
    SELECT o.id, o.display_name, o.created_by_user_id IS NOT NULL AS app_created,
           o.clerk_organization_id IS NOT NULL AS clerk_org, o.entry_source, o.record_type, o.is_archived,
           o.created_at, op.registration_id,
           EXISTS (SELECT 1 FROM admin_change_history h WHERE h.manufacturer_id = o.id
                   AND h.field_changed = 'Entry source') AS entry_source_admin_edited,
           EXISTS (SELECT 1 FROM manufacturer_submission_events e WHERE e.organization_id = o.id
                   AND e.event = 'imported') AS imported_event,
           EXISTS (SELECT 1 FROM manufacturer_submissions s WHERE s.target_organization_id = o.id
                   AND s.organization_id = o.id AND s.kind = 'new_company' AND s.status = 'approved')
             AS new_company_submission,
           EXISTS (SELECT 1 FROM manufacturer_submissions s WHERE s.target_organization_id = o.id
                   AND s.organization_id = o.id AND s.kind = 'new_company' AND s.status <> 'approved')
             AS unapproved_new_company_submission,
           EXISTS (SELECT 1 FROM manufacturer_submission_events e WHERE e.organization_id = o.id
                   AND e.event = 'created' AND e.source = 'admin_entry' AND e.actor_role = 'admin'
                   AND e.actor_user_id IS NOT NULL) AS admin_created_event,
           coalesce(mo.personal_information_completed, false) AS details_form_submitted,
           btrim(coalesce(op.company_category, '')) <> '' AS category_saved,
           EXISTS (SELECT 1 FROM manufacturer_submissions s WHERE s.organization_id = o.id
                   AND s.target_organization_id <> o.id) AS workspace_for_other_company,
           EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = o.created_by_user_id
                   AND m.membership_role IN ('owner', 'admin')) AS creator_is_owner
    FROM organizations o
    LEFT JOIN organization_profiles op ON op.organization_id = o.id
    LEFT JOIN manufacturer_onboarding mo ON mo.organization_id = o.id
    WHERE o.organization_type = 'manufacturer' AND o.onboarding_source IS NULL
      AND (CAST(:only AS uuid[]) IS NULL OR o.id = ANY(CAST(:only AS uuid[])))
    ORDER BY o.created_at, o.id
"""

USER_FACTS_SQL = """
    SELECT u.id, u.email::text AS email, u.clerk_user_id LIKE 'local-admin:%' AS staff_account,
           u.registration_method, u.registration_completed_at IS NOT NULL AS registered
    FROM users u WHERE u.registration_channel IS NULL
      AND (CAST(:only AS uuid[]) IS NULL OR u.id = ANY(CAST(:only AS uuid[])))
    ORDER BY u.created_at, u.id
"""


@dataclass
class Decision:
    record_type: str           # company | user
    record_id: str
    name: str
    field: str                 # onboarding_source | registration_channel
    proposed: str | None
    outcome: str               # assign | needs_confirmation | unresolved | conflict
    rule: str
    evidence: dict = field(default_factory=dict)


def classify_company(f: dict, evidence_ids: set[str], evidence_regs: dict[str, int],
                     accept_direct_load: bool) -> Decision:
    oid = str(f["id"])
    name = f["display_name"] or ""
    reg = (f.get("registration_id") or "").strip().lower()
    listed = oid in evidence_ids
    reg_listed = bool(reg) and reg in evidence_regs
    import_evidence = []
    if listed:
        import_evidence.append("id listed in the import evidence file")
    elif reg_listed:
        if evidence_regs[reg] > 1:
            return Decision("company", oid, name, "onboarding_source", None, "conflict", "E1",
                            {"why": "registration id appears more than once in the evidence file"})
        import_evidence.append("registration id listed in the import evidence file")
    if f["imported_event"]:
        import_evidence.append("'imported' history event")
    if f["entry_source"] == "IMPORTED" and not f["entry_source_admin_edited"]:
        import_evidence.append("entry_source IMPORTED set by the importer (never edited by an admin)")
    if f.get("admin_created_event"):
        if import_evidence or f["app_created"]:
            return Decision("company", oid, name, "onboarding_source", None, "conflict", "X1",
                            {"why": "admin creation event for a company with import or app-user creation evidence"})
        return Decision("company", oid, name, "onboarding_source", "admin_entry", "assign", "A1",
                        {"evidence": ["admin 'created' history event (Add company)"]})
    web_evidence = []
    if f["app_created"] and f["new_company_submission"]:
        web_evidence.append("dashboard 'new company' submission for this company")
    if (f["app_created"] and f["details_form_submitted"] and f["category_saved"]
            and not f["workspace_for_other_company"] and f["creator_is_owner"]):
        web_evidence.append("dashboard details form submitted for this company by the user who created it")

    facts = {k: (str(v) if k == "created_at" else v) for k, v in f.items() if k not in ("id", "display_name")}
    if import_evidence and (web_evidence or f["app_created"]):
        return Decision("company", oid, name, "onboarding_source", None, "conflict", "X1",
                        {"why": "import evidence for a company that an app user created",
                         "import": import_evidence, "web": web_evidence, "facts": facts})
    if import_evidence:
        rule = "E1" if (listed or reg_listed) else ("I1" if f["imported_event"] else "I2")
        return Decision("company", oid, name, "onboarding_source", "database_import", "assign", rule,
                        {"evidence": import_evidence, "facts": facts})
    if web_evidence:
        rule = "W1" if f["new_company_submission"] else "W2"
        return Decision("company", oid, name, "onboarding_source", "web_dashboard", "assign", rule,
                        {"evidence": web_evidence, "facts": facts})
    if f["entry_source"] == "IMPORTED" and f["entry_source_admin_edited"]:
        return Decision("company", oid, name, "onboarding_source", None, "unresolved", "U-ADMIN-EDIT",
                        {"why": "entry_source IMPORTED was set or changed by an admin edit, which is not "
                                "evidence of an import; add the id to an --evidence-ids file if it was imported",
                         "facts": facts})
    if f["app_created"] and f.get("unapproved_new_company_submission"):
        return Decision("company", oid, name, "onboarding_source", None, "unresolved", "U-NOT-APPROVED",
                        {"why": "new-company submission not approved: its source stays on the submission and is "
                                "copied to the company automatically when it is approved", "facts": facts})
    if f["app_created"]:
        why = ("placeholder workspace used while its user claimed / requested changes to another company; "
               "it is not a company of its own") if f["workspace_for_other_company"] else \
              "placeholder created for a user at sign-in; no company details were ever submitted for it"
        return Decision("company", oid, name, "onboarding_source", None, "unresolved", "U-PLACEHOLDER",
                        {"why": why, "facts": facts})
    if f["clerk_org"]:
        return Decision("company", oid, name, "onboarding_source", None, "unresolved", "U-CLERK-ORG",
                        {"why": "created from a Clerk organization event; that is not a company "
                                "onboarding channel and records nothing about the company's origin",
                         "facts": facts})
    # no creating user, no Clerk organization: loaded straight into the database
    direct = {"evidence": ["no creating user and no Clerk organization: no application workflow creates "
                           "such a row, so it was loaded directly into the database"], "facts": facts}
    if accept_direct_load:
        return Decision("company", oid, name, "onboarding_source", "database_import", "assign", "D1", direct)
    return Decision("company", oid, name, "onboarding_source", "database_import", "needs_confirmation", "D1",
                    {**direct, "why": "no import batch / log ties it to an import, and a row typed in by hand "
                                      "looks the same: confirm with --accept-direct-load or --evidence-ids"})


def classify_user(f: dict) -> Decision:
    uid = str(f["id"])
    method = f.get("registration_method") or ""
    facts = {"registration_method": method or None, "registered": f["registered"],
             "staff_account": f["staff_account"]}
    if f["staff_account"]:
        return Decision("user", uid, f["email"], "registration_channel", "admin_portal", "assign", "U1",
                        {"evidence": ["staff admin account created by the admin tool"], "facts": facts})
    if f["registered"] and method in ("manual", "google"):
        return Decision("user", uid, f["email"], "registration_channel", "web_signup", "assign", "U2",
                        {"evidence": [f"registration_method '{method}' is set only by website Sign-up"],
                         "facts": facts})
    if f["registered"] and method.startswith("legacy"):
        return Decision("user", uid, f["email"], "registration_channel", "legacy_account", "assign", "U3",
                        {"evidence": [f"registration_method '{method}' (pre-registration account)"], "facts": facts})
    why = "not registered (sign-up never completed)" if not f["registered"] else \
        f"registered with an unrecognised registration_method {method!r}"
    return Decision("user", uid, f["email"], "registration_channel", None, "unresolved", "U-NONE",
                    {"why": why, "facts": facts})


def read_evidence(path: Path | None) -> tuple[set[str], dict[str, int]]:
    ids: set[str] = set()
    regs: dict[str, int] = {}
    if not path:
        return ids, regs
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
            if row.get("organization_id"):
                try:
                    ids.add(str(uuid.UUID(row["organization_id"])))
                except ValueError:
                    raise SystemExit(f"Invalid organization_id in evidence file: {row['organization_id']}")
            if row.get("registration_id"):
                key = row["registration_id"].lower()
                regs[key] = regs.get(key, 0) + 1
    return ids, regs


async def plan(session, evidence_ids=frozenset(), evidence_regs=None, accept_direct_load=False,
               only: list[str] | None = None) -> list[Decision]:
    """Classify every record with a missing value (or only the given company / user ids)."""
    p = {"only": list(only) if only is not None else None}
    companies = (await session.execute(text(COMPANY_FACTS_SQL), p)).mappings().all()
    users = (await session.execute(text(USER_FACTS_SQL), p)).mappings().all()
    return ([classify_company(dict(c), set(evidence_ids), evidence_regs or {}, accept_direct_load) for c in companies]
            + [classify_user(dict(u)) for u in users])


async def apply(session, decisions: list[Decision]) -> dict:
    """Write the decisions in the caller's transaction. Returns counts."""
    from app.manufacturer_approval import record_event
    run_id = uuid.uuid4()
    counts = {"applied": 0, "unresolved": 0, "conflict": 0, "skipped_changed": 0}
    for d in decisions:
        outcome = {"assign": "applied", "needs_confirmation": "unresolved"}.get(d.outcome, d.outcome)
        if outcome == "applied":
            table, column = ("organizations", "onboarding_source") if d.record_type == "company" \
                else ("users", "registration_channel")
            done = (await session.execute(text(f"""
                UPDATE {table} SET {column} = :v WHERE id = CAST(:i AS uuid) AND {column} IS NULL RETURNING id
            """), {"v": d.proposed, "i": d.record_id})).first()
            if done is None:  # set concurrently (e.g. a live submission): leave it
                counts["skipped_changed"] += 1
                continue
        await session.execute(text("""
            INSERT INTO onboarding_source_backfill_log
              (run_id, record_type, record_id, field, old_value, new_value, outcome, rule, evidence)
            VALUES (:run, :t, CAST(:i AS uuid), :f, NULL, :v, :o, :r, CAST(:e AS jsonb))
            ON CONFLICT (record_type, record_id, field) DO UPDATE
              SET run_id = EXCLUDED.run_id, new_value = EXCLUDED.new_value, outcome = EXCLUDED.outcome,
                  rule = EXCLUDED.rule, evidence = EXCLUDED.evidence, created_at = now()
              WHERE onboarding_source_backfill_log.outcome <> 'applied'
        """), {"run": run_id, "t": d.record_type, "i": d.record_id, "f": d.field,
               "v": d.proposed if outcome == "applied" else None, "o": outcome, "r": d.rule,
               "e": json.dumps({**d.evidence, **({"proposed": d.proposed} if outcome != "applied" and d.proposed else {})},
                               default=str)})
        if outcome == "applied" and d.record_type == "company":
            await record_event(session, event="source_backfilled", role="system", source=d.proposed,
                               organization_id=d.record_id, key=f"source_backfilled:{d.record_id}",
                               details={"rule": d.rule, "evidence": d.evidence.get("evidence"), "run": str(run_id)})
        counts[outcome] += 1
    counts["run_id"] = str(run_id)
    return counts


def write_report(decisions: list[Decision], path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        w = csv.writer(handle)
        w.writerow(["record_id", "record_type", "name", "field", "current_value", "proposed_value", "outcome",
                    "rule", "evidence_or_reason"])
        for d in decisions:
            reason = d.evidence.get("why") or "; ".join(d.evidence.get("evidence") or [])
            w.writerow([d.record_id, d.record_type, d.name, d.field, "", d.proposed or "", d.outcome, d.rule, reason])


def summary(decisions: list[Decision]) -> list[str]:
    from collections import Counter
    c = Counter((d.record_type, d.outcome, d.rule, d.proposed or "-") for d in decisions)
    return [f"  {t:<8} {o:<19} {r:<14} {p:<16} {n}" for (t, o, r, p), n in sorted(c.items())]


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    parser.add_argument("--report", type=Path, help="CSV report of every examined record")
    parser.add_argument("--evidence-ids", type=Path, help="CSV with organization_id and/or registration_id columns")
    parser.add_argument("--accept-direct-load", action="store_true",
                        help="assign database_import to rows loaded directly into the database (rule D1)")
    args = parser.parse_args(argv)
    from app.core.database import SessionFactory, engine

    ids, regs = read_evidence(args.evidence_ids)
    async with SessionFactory() as session:
        await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended('xy-source-backfill', 0))"))
        decisions = await plan(session, ids, regs, args.accept_direct_load)
        print(f"{'APPLY' if args.apply else 'DRY RUN'}: {len(decisions)} records with a missing value")
        print("  type     outcome             rule           proposed         count")
        print("\n".join(summary(decisions)) or "  (nothing to do)")
        if args.report:
            write_report(decisions, args.report)
            print(f"report: {args.report}")
        if args.apply:
            counts = await apply(session, decisions)
            await session.commit()
            print(f"applied: {counts}")
        else:
            await session.rollback()
    await engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(run_cli(main()))
