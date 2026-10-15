"""Evidence-based backfill (app.backfill_onboarding_source) on records shaped like data from before
migration 020, plus future tracking of the registration channel and the admin API display.
Real PostgreSQL (E2E_DATABASE_URL); rows are created exactly as the older code left them."""
import json
import os
import uuid

import pytest

from test_e2e_local import client  # noqa: F401  (shared fixture)
from test_onboarding_source import _admin
from test_manufacturer_approval import hdr

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


async def _user(c, t, label, method=None, staff=False):
    clerk = f"{'local-admin:' if staff else 'user_bf_'}{label}_{t}"
    return (await c.sql("""
        INSERT INTO users (clerk_user_id, email, display_name, registration_completed_at, registration_method)
        VALUES (:c, :e, :d, CASE WHEN CAST(:m AS text) IS NULL THEN NULL ELSE now() END, :m) RETURNING id::text
    """, c=clerk, e=f"{label}_{t}@example.com", d=label, m=method))[0][0]


async def _org(c, name, created_by=None, entry="MANUFACTURER", clerk_org=None, category=None, form=False,
               owner=None):
    org = (await c.sql("""
        INSERT INTO organizations (display_name, organization_type, status, created_by_user_id, entry_source,
                                   clerk_organization_id)
        VALUES (:n, 'manufacturer', 'active', CAST(:u AS uuid), :e, :k) RETURNING id::text
    """, n=name, u=created_by, e=entry, k=clerk_org))[0][0]
    if category is not None:
        await c.sql("INSERT INTO organization_profiles (organization_id, company_category) VALUES (CAST(:o AS uuid), :c)",
                    o=org, c=category)
    if form:
        await c.sql("""INSERT INTO manufacturer_onboarding (organization_id, personal_information_completed, status)
                       VALUES (CAST(:o AS uuid), true, 'in_progress')""", o=org)
    if owner:
        await c.sql("""INSERT INTO memberships (user_id, organization_id, membership_role, status, accepted_at)
                       VALUES (CAST(:u AS uuid), CAST(:o AS uuid), 'owner', 'active', now())""", u=owner, o=org)
    return org


async def _submission(c, workspace, target, user, kind, status="pending"):
    await c.sql("""INSERT INTO manufacturer_submissions (organization_id, target_organization_id, submitted_by_user_id,
                                                         kind, payload, status, reviewed_at)
                   VALUES (CAST(:w AS uuid), CAST(:t AS uuid), CAST(:u AS uuid), :k, '{}'::jsonb, :s,
                           CASE WHEN :s = 'approved' THEN now() END)""",
                w=workspace, t=target, u=user, k=kind, s=status)


async def test_backfill_classifies_by_evidence_is_reviewable_and_rerunnable(client, tmp_path):  # noqa: F811
    from app.backfill_onboarding_source import apply, plan, read_evidence, write_report
    from app.core.database import SessionFactory

    t = uuid.uuid4().hex[:6]
    web = await _user(client, t, "web", "google")
    legacy = await _user(client, t, "legacy", "legacy_activity")
    unreg = await _user(client, t, "unreg")
    staff = await _user(client, t, "staff", staff=True)
    claimer = await _user(client, t, "claimer", "manual")

    # imported by the old importer, later claimed and approved through the website
    imported = await _org(client, f"BF Imported {t}", entry="IMPORTED", category="Metal", owner=claimer)
    # the claimant's own workspace (owner, form submitted) - retired after the claim was approved
    claim_ws = await _org(client, f"BF Claim workspace {t}", created_by=claimer, category="Metal", form=True,
                          owner=claimer)
    await client.sql("""UPDATE memberships SET status='removed' WHERE organization_id=CAST(:o AS uuid)""", o=claim_ws)
    await _submission(client, claim_ws, imported, claimer, "claim", "approved")
    await client.sql("""INSERT INTO manufacturer_onboarding (organization_id, status, reviewed_at)
                        VALUES (CAST(:o AS uuid), 'approved', now())""", o=imported)
    seeded = await _org(client, f"BF Seeded {t}")                                   # direct SQL load
    listed = await _org(client, f"BF Listed {t}")                                   # id in an import log
    new_web = await _org(client, f"BF New web {t}", created_by=web, owner=web)
    await _submission(client, new_web, new_web, web, "new_company", "approved")
    pending_web = await _org(client, f"BF Pending web {t}", created_by=legacy, owner=legacy)
    await _submission(client, pending_web, pending_web, legacy, "new_company")
    admin_made = await _org(client, f"BF Admin made {t}")
    await client.sql("""INSERT INTO manufacturer_submission_events (organization_id, event, actor_user_id, actor_role, source)
                        VALUES (CAST(:o AS uuid), 'created', CAST(:u AS uuid), 'admin', 'admin_entry')""",
                     o=admin_made, u=staff)
    legacy_web = await _org(client, f"BF Legacy web {t}", created_by=legacy, owner=legacy, category="Plastics",
                            form=True)
    placeholder = await _org(client, f"BF Placeholder {t}", created_by=web, owner=web)
    clerk_org = await _org(client, f"BF Clerk org {t}", clerk_org=f"org_{t}")
    edited = await _org(client, f"BF Admin edited {t}", entry="IMPORTED")
    await client.sql("""INSERT INTO admin_change_history (manufacturer_id, field_changed, old_value, new_value)
                        VALUES (CAST(:o AS uuid), 'Entry source', 'MANUFACTURER', 'IMPORTED')""", o=edited)
    conflict = await _org(client, f"BF Conflict {t}", created_by=web, entry="IMPORTED")
    companies = [imported, claim_ws, seeded, listed, new_web, legacy_web, placeholder, clerk_org, edited, conflict,
                 pending_web, admin_made]
    users = [web, legacy, unreg, staff, claimer]
    before = await client.sql("""SELECT o.id::text, mo.status, mo.reviewed_at,
                                        (SELECT array_agg(m.user_id::text || m.membership_role ORDER BY m.user_id)
                                         FROM memberships m WHERE m.organization_id = o.id)
                                 FROM organizations o LEFT JOIN manufacturer_onboarding mo ON mo.organization_id = o.id
                                 WHERE o.id = ANY(CAST(:ids AS uuid[])) ORDER BY 1""", ids=companies)

    evidence = tmp_path / "import_log_ids.csv"
    evidence.write_text(f"organization_id,reference\n{listed},import-2026-03.xlsx row 12\n")
    ids, regs = read_evidence(evidence)

    # --- dry run: nothing written, every record explained
    async with SessionFactory() as s:
        decisions = await plan(s, ids, regs, only=companies + users)
        await s.rollback()
    got = {d.record_id: (d.outcome, d.rule, d.proposed) for d in decisions}
    assert got == {
        imported: ("assign", "I2", "database_import"),
        claim_ws: ("unresolved", "U-PLACEHOLDER", None),
        seeded: ("needs_confirmation", "D1", "database_import"),
        listed: ("assign", "E1", "database_import"),
        new_web: ("assign", "W1", "web_dashboard"),
        pending_web: ("unresolved", "U-NOT-APPROVED", None),
        admin_made: ("assign", "A1", "admin_entry"),
        legacy_web: ("assign", "W2", "web_dashboard"),
        placeholder: ("unresolved", "U-PLACEHOLDER", None),
        clerk_org: ("unresolved", "U-CLERK-ORG", None),
        edited: ("unresolved", "U-ADMIN-EDIT", None),
        conflict: ("conflict", "X1", None),
        web: ("assign", "U2", "web_signup"), claimer: ("assign", "U2", "web_signup"),
        legacy: ("assign", "U3", "legacy_account"), staff: ("assign", "U1", "admin_portal"),
        unreg: ("unresolved", "U-NONE", None),
    }
    report = tmp_path / "report.csv"
    write_report(decisions, report)
    lines = report.read_text().splitlines()
    assert lines[0].startswith("record_id,record_type,name,field,current_value,proposed_value,outcome,rule")
    assert len(lines) == 1 + len(decisions)
    assert (await client.sql("SELECT count(*) FROM organizations WHERE id = ANY(CAST(:i AS uuid[])) "
                             "AND onboarding_source IS NOT NULL", i=companies))[0][0] == 0

    # --- apply (without --accept-direct-load), then run again
    for _ in range(2):
        async with SessionFactory() as s:
            await apply(s, await plan(s, ids, regs, only=companies + users))
            await s.commit()
    src = dict((r[0], r[1]) for r in await client.sql(
        "SELECT id::text, onboarding_source FROM organizations WHERE id = ANY(CAST(:i AS uuid[]))", i=companies))
    assert src == {imported: "database_import", claim_ws: None, seeded: None, listed: "database_import",
                   new_web: "web_dashboard", legacy_web: "web_dashboard", placeholder: None, clerk_org: None,
                   edited: None, conflict: None, pending_web: None, admin_made: "admin_entry"}
    chan = dict((r[0], r[1]) for r in await client.sql(
        "SELECT id::text, registration_channel FROM users WHERE id = ANY(CAST(:i AS uuid[]))", i=users))
    assert chan == {web: "web_signup", claimer: "web_signup", legacy: "legacy_account", staff: "admin_portal",
                    unreg: None}
    # one log row per record, one history event per assigned company, even after the second run
    log = await client.sql("""SELECT record_id::text, outcome, rule, evidence FROM onboarding_source_backfill_log
                              WHERE record_id = ANY(CAST(:i AS uuid[]))""", i=companies + users)
    assert len(log) == len(companies) + len(users)
    by = {r[0]: r for r in log}
    assert by[imported][1:3] == ("applied", "I2") and by[seeded][1:3] == ("unresolved", "D1")
    seeded_ev = by[seeded][3] if isinstance(by[seeded][3], dict) else json.loads(by[seeded][3])
    assert "confirm with --accept-direct-load" in seeded_ev["why"] and seeded_ev["proposed"] == "database_import"
    events = await client.sql("""SELECT organization_id::text, source, actor_role FROM manufacturer_submission_events
                                 WHERE event = 'source_backfilled' AND organization_id = ANY(CAST(:i AS uuid[]))""",
                              i=companies)
    assert sorted((e[0], e[1], e[2]) for e in events) == sorted([
        (imported, "database_import", "system"), (listed, "database_import", "system"),
        (new_web, "web_dashboard", "system"), (legacy_web, "web_dashboard", "system"),
        (admin_made, "admin_entry", "system")])
    # approval, reviewer time, owners and memberships untouched
    after = await client.sql("""SELECT o.id::text, mo.status, mo.reviewed_at,
                                       (SELECT array_agg(m.user_id::text || m.membership_role ORDER BY m.user_id)
                                        FROM memberships m WHERE m.organization_id = o.id)
                                FROM organizations o LEFT JOIN manufacturer_onboarding mo ON mo.organization_id = o.id
                                WHERE o.id = ANY(CAST(:ids AS uuid[])) ORDER BY 1""", ids=companies)
    assert [tuple(r) for r in after] == [tuple(r) for r in before]

    # --- confirming direct loads assigns them; the value then never changes
    async with SessionFactory() as s:
        await apply(s, await plan(s, accept_direct_load=True, only=[seeded]))
        await s.commit()
    assert (await client.sql("SELECT onboarding_source FROM organizations WHERE id=CAST(:o AS uuid)", o=seeded))[0][0] \
        == "database_import"

    # --- admin API shows the stored values and why the others are unknown
    admin = await _admin(client)
    rows = {r["id"]: r for r in (await client.get("/admin/manufacturers", headers=admin,
                                                  params={"q": f"BF ", "page_size": 100, "archived": "all"})).json()["rows"]
            if r["id"] in companies}
    assert rows[imported]["onboardingSource"] == "database_import" and rows[imported]["reviewStatus"] == "REVIEWED"
    assert rows[placeholder]["onboardingSource"] is None and "placeholder" in rows[placeholder]["onboardingSourceNote"]
    assert rows[edited]["onboardingSourceNote"].startswith("entry_source IMPORTED was set or changed by an admin")
    d = (await client.get(f"/admin/manufacturers/{legacy_web}", headers=admin)).json()["onboarding"]
    assert d["source"] == "web_dashboard" and d["backfill"]["rule"] == "W2" and d["backfill"]["evidence"]
    d = (await client.get(f"/admin/manufacturers/{clerk_org}", headers=admin)).json()["onboarding"]
    assert d["source"] is None and "Clerk organization" in d["note"]
    users_rows = {u["id"]: u for u in (await client.get("/admin/users", headers=admin,
                                                         params={"q": t, "page_size": 100})).json()["rows"]}
    claimer_row = users_rows[claimer]
    assert claimer_row["registrationChannel"] == "web_signup" and claimer_row["registrationMethod"] == "manual"
    assert [(c["name"], c["onboardingSource"]) for c in claimer_row["companies"]] == [(f"BF Imported {t}",
                                                                                       "database_import")]


async def test_new_registrations_record_the_channel(client):  # noqa: F811
    sub = f"user_chan_{uuid.uuid4().hex[:6]}"
    assert (await client.get("/identity/me", headers=hdr(client, sub))).status_code == 200  # fixture: real sign-up
    row = (await client.sql("SELECT registration_channel, registration_method FROM users WHERE clerk_user_id=:s",
                            s=sub))[0]
    assert tuple(row) == ("web_signup", "manual")
