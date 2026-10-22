"""Scenario coverage for onboarding source, imports, submissions, reviews, database guards, the
evidence backfill, the registration channel and the admin APIs (Users / Manufacturers / Visionaries).
Real PostgreSQL through the real HTTP API (E2E_DATABASE_URL)."""
import hashlib
import os
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from test_company_update_requests import _detail_request
from test_e2e_local import approve_company, client  # noqa: F401  (shared fixture)
from test_manufacturer_approval import account, hdr, own_org
from test_onboarding_source import _admin, _events, _import, _org
from test_registration_compat import clerk_api, legacy_user

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


def _tag():
    return uuid.uuid4().hex[:6]


async def _run_import(path, rollback=False):
    from app.core.database import SessionFactory
    from app.import_manufacturers import import_rows, read_rows
    async with SessionFactory() as s:
        report = await import_rows(s, read_rows(path), reference=path.name,
                                   content_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), actor="job:test")
        await (s.rollback() if rollback else s.commit())
    return report


async def _sql_fails(sql, **p):
    from app.core.database import SessionFactory
    async with SessionFactory() as s:
        with pytest.raises(DBAPIError):
            await s.execute(text(sql), p)
        await s.rollback()


# ================================================================== imports
async def test_import_batches_dry_run_and_existing_companies(client, tmp_path):  # noqa: F811
    t = _tag()
    first = tmp_path / f"a_{t}.csv"
    first.write_text(f"name,country,city\nScn Alpha {t},India,Pune\n")
    # dry run (rolled back): no batch, no company, no event
    dry = await _run_import(first, rollback=True)
    assert len(dry.inserted) == 1
    assert (await client.sql("SELECT count(*) FROM import_batches WHERE id=CAST(:b AS uuid)", b=dry.batch_id))[0][0] == 0
    assert (await client.sql("SELECT count(*) FROM organizations WHERE display_name=:n", n=f"Scn Alpha {t}"))[0][0] == 0

    one = await _run_import(first)
    alpha = one.inserted[0][2]
    # a different file: new batch; the company already present keeps its first batch and source
    second = tmp_path / f"b_{t}.csv"
    second.write_text(f"name,country,city\nScn Alpha {t},India,Pune\nScn Beta {t},India,Chennai\n,India,X\n"
                      f"Scn Alpha {t},,\n")
    two = await _run_import(second)
    assert two.batch_id != one.batch_id
    assert [r[1] for r in two.inserted] == [f"Scn Beta {t}"] and [r[2] for r in two.present] == [alpha]
    assert len(two.invalid) == 1 and len(two.ambiguous) == 1
    beta = two.inserted[0][2]
    assert tuple(await _org(client, alpha)) == ("database_import", one.batch_id, "IMPORTED")
    assert tuple(await _org(client, beta)) == ("database_import", two.batch_id, "IMPORTED")
    assert len(await _events(client, alpha)) == 1  # still one 'imported' event
    batches = await client.sql("SELECT source_reference, row_count FROM import_batches WHERE id IN "
                               "(CAST(:a AS uuid), CAST(:b AS uuid)) ORDER BY created_at", a=one.batch_id, b=two.batch_id)
    assert [tuple(b) for b in batches] == [(f"a_{t}.csv", 1), (f"b_{t}.csv", 4)]


# ================================================================== dashboard submissions
async def test_new_company_retry_change_corrections_and_approval(client):  # noqa: F811
    t = _tag()
    sub = f"user_scn_{t}"
    h = hdr(client, sub)
    body = account(f"Scn Works {t}")
    for _ in range(3):  # double submit / retries
        assert (await client.post("/manufacturer/account", headers=h, json=body)).status_code == 201
    org = await own_org(client, sub)
    assert [e[0] for e in await _events(client, org)] == ["submitted"]
    assert (await _org(client, org))[0] is None  # kept on the staged submission until approval
    # changed details before review: same submission, 'resubmitted'
    assert (await client.post("/manufacturer/account", headers=h, json={**body, "capacity": "600 units/month"})).status_code == 201
    assert [e[0] for e in await _events(client, org)] == ["submitted", "resubmitted"]
    assert (await client.sql("SELECT count(*) FROM manufacturer_submissions WHERE target_organization_id=CAST(:o AS uuid)",
                             o=org))[0][0] == 1
    # corrections requested -> resubmitted -> approved; source never changes
    first_at = (await client.sql("SELECT submitted_at FROM manufacturer_submissions WHERE target_organization_id="
                                 "CAST(:o AS uuid)", o=org))[0][0]
    assert (await approve_company(client, org, decision="NEEDS_CORRECTION", reason="Add phone",
                                 correction_fields=["companyPhone", "capacity"])).status_code == 200
    assert (await client.post("/manufacturer/account", headers=h, json={**body, "phone": "+91 90000 22222"})).status_code == 201
    row = (await client.sql("SELECT status, submitted_at FROM manufacturer_submissions WHERE target_organization_id="
                            "CAST(:o AS uuid)", o=org))[0]
    assert row[0] == "pending" and row[1] > first_at
    assert (await approve_company(client, org)).status_code == 200
    assert [e[:3] for e in await _events(client, org)] == [
        ("submitted", "web_dashboard", "requester"), ("resubmitted", "web_dashboard", "requester"),
        ("decision", "admin_review", "admin"), ("resubmitted", "web_dashboard", "requester"),
        ("decision", "admin_review", "admin"), ("merged", "admin_review", "admin")]
    assert (await _org(client, org))[0] == "web_dashboard"  # copied on the approved creation
    admin = await _admin(client)
    d = (await client.get(f"/admin/manufacturers/{org}", headers=admin)).json()
    assert d["manufacturer"]["onboardingSource"] == "web_dashboard" and d["manufacturer"]["stagedSource"] is None
    # approving again (retry) changes nothing and adds no event
    n = len(await _events(client, org))
    await approve_company(client, org)
    assert len(await _events(client, org)) == n and (await _org(client, org))[0] == "web_dashboard"


async def test_rejection_records_review_without_merge_or_source_change(client):  # noqa: F811
    sub = f"user_rej_{_tag()}"
    h = hdr(client, sub)
    assert (await client.post("/manufacturer/account", headers=h, json=account(f"Scn Reject {_tag()}"))).status_code == 201
    org = await own_org(client, sub)
    assert (await approve_company(client, org, decision="REJECTED", reason="Not a manufacturer")).status_code == 200
    ev = await _events(client, org)
    assert [e[0] for e in ev] == ["submitted", "decision"] and ev[1][1] == "admin_review"
    # a rejected creation is never copied to the company; the source stays on the submission
    assert (await _org(client, org))[0] is None
    admin = await _admin(client)
    row = (await client.get(f"/admin/manufacturers/{org}", headers=admin)).json()
    assert row["manufacturer"]["stagedSource"] == {"source": "web_dashboard", "status": "rejected"}
    assert row["onboarding"]["staged"] == {"source": "web_dashboard", "status": "rejected"}


async def test_update_request_on_imported_company_keeps_source(client, tmp_path):  # noqa: F811
    t = _tag()
    org = (await _import(tmp_path, t, name=f"Scn Shared {t}")).inserted[0][2]
    owner = f"user_own_{t}"
    assert (await client.post("/manufacturer/account", headers=hdr(client, owner), json=account(
        f"Scn Shared {t}", companyId=org))).status_code == 201
    assert (await approve_company(client, org)).status_code == 200
    req = f"user_req_{t}"
    body = account(f"Scn Shared {t}", companyId=org, capacity="9999 units")
    for _ in range(2):  # retry
        assert (await client.post("/manufacturer/account", headers=hdr(client, req), json=body)).status_code == 201
    rows = await client.sql("""SELECT source, status FROM manufacturer_submissions
                               WHERE target_organization_id=CAST(:o AS uuid) AND kind='update_request'""", o=org)
    assert [tuple(r) for r in rows] == [("web_dashboard", "pending")]
    admin = await _admin(client)
    _, request = await _detail_request(client, admin, org)
    r = await client.post(f"/admin/manufacturers/{org}/update-requests/{request['id']}/decision", headers=admin,
                          json={"decision": "decline", "feedback": "Not verified", "fingerprint": request["fingerprint"]})
    assert r.status_code == 200, r.text
    kinds = [(e[0], e[1], e[4]) for e in await _events(client, org)]
    assert kinds.count(("submitted", "web_dashboard", "update_request")) == 1
    assert ("resubmitted", "web_dashboard", "update_request") not in kinds  # the retry added nothing
    assert ("decision", "admin_review", "update_request") in kinds
    assert tuple(await _org(client, org))[0] == "database_import"


# ================================================================== database guards
async def test_database_guards(client, tmp_path):  # noqa: F811
    t = _tag()
    org = (await _import(tmp_path, t)).inserted[0][2]
    for value in ("admin_review", "ai_voice_call", "ground_sales", "unknown"):
        await _sql_fails("INSERT INTO organizations (display_name, organization_type, onboarding_source) "
                         "VALUES ('x', 'manufacturer', :v)", v=value)
    await _sql_fails("UPDATE organizations SET import_batch_id = NULL WHERE id = CAST(:o AS uuid)", o=org)
    await _sql_fails("INSERT INTO organizations (display_name, organization_type, onboarding_source, import_batch_id) "
                     "SELECT 'x', 'manufacturer', 'web_dashboard', import_batch_id FROM organizations "
                     "WHERE id = CAST(:o AS uuid)", o=org)
    await _sql_fails("INSERT INTO manufacturer_submissions (organization_id, target_organization_id, kind, payload, source) "
                     "VALUES (CAST(:o AS uuid), CAST(:o AS uuid), 'claim', '{}', 'database_import')", o=org)
    await _sql_fails("INSERT INTO manufacturer_submissions (organization_id, target_organization_id, kind, payload, source) "
                     "VALUES (CAST(:o AS uuid), CAST(:o AS uuid), 'claim', '{}', 'web_dashboard')", o=org)  # no user
    await _sql_fails("INSERT INTO manufacturer_submission_events (organization_id, event, actor_role, source) "
                     "VALUES (CAST(:o AS uuid), 'submitted', 'system', 'ai_voice_call')", o=org)
    await _sql_fails("INSERT INTO manufacturer_submission_events (event, actor_role) VALUES ('submitted', 'system')")
    await _sql_fails("UPDATE users SET registration_channel = 'google' WHERE id = (SELECT id FROM users LIMIT 1)")
    await _sql_fails("INSERT INTO onboarding_source_backfill_log (run_id, record_type, record_id, field, outcome, rule) "
                     "VALUES (gen_random_uuid(), 'company', CAST(:o AS uuid), 'onboarding_source', 'guessed', 'Z')", o=org)
    # a duplicate 'imported' event for the same company is refused by the idempotency key
    await _sql_fails("INSERT INTO manufacturer_submission_events (organization_id, event, actor_role, source, idempotency_key) "
                     "VALUES (CAST(:o AS uuid), 'imported', 'system', 'database_import', :k)", o=org, k=f"imported:{org}")


# ================================================================== backfill
async def test_backfill_concurrency_existing_values_cli_and_registration_ids(client, tmp_path, monkeypatch):  # noqa: F811
    from app import backfill_onboarding_source as bf
    from app.core.database import SessionFactory
    t = _tag()
    a = (await client.sql("""INSERT INTO organizations (display_name, organization_type) VALUES (:n, 'manufacturer')
                             RETURNING id::text""", n=f"Scn Race {t}"))[0][0]
    b = (await client.sql("""INSERT INTO organizations (display_name, organization_type) VALUES (:n, 'manufacturer')
                             RETURNING id::text""", n=f"Scn RegId {t}"))[0][0]
    await client.sql("INSERT INTO organization_profiles (organization_id, registration_id) VALUES (CAST(:o AS uuid), :r)",
                     o=b, r=f"GST{t}")
    # value set between the plan and the apply (e.g. a live submission): left alone, counted
    async with SessionFactory() as s:
        decisions = await bf.plan(s, accept_direct_load=True, only=[a])
        await client.sql("UPDATE organizations SET onboarding_source='web_dashboard' WHERE id=CAST(:o AS uuid)", o=a)
        counts = await bf.apply(s, decisions)
        await s.commit()
    assert counts["skipped_changed"] == 1 and counts["applied"] == 0
    assert (await _org(client, a))[0] == "web_dashboard"
    # a company whose source is already set is never examined again
    async with SessionFactory() as s:
        assert await bf.plan(s, accept_direct_load=True, only=[a]) == []
    # registration id from an import log
    ev = tmp_path / "ev.csv"
    ev.write_text(f"registration_id\ngst{t}\n")
    ids, regs = bf.read_evidence(ev)
    async with SessionFactory() as s:
        await bf.apply(s, await bf.plan(s, ids, regs, only=[b]))
        await s.commit()
    assert (await _org(client, b))[0] == "database_import"
    log = (await client.sql("SELECT rule, outcome FROM onboarding_source_backfill_log WHERE record_id=CAST(:o AS uuid)",
                            o=b))[0]
    assert tuple(log) == ("E1", "applied")
    # the CLI dry run writes a report and changes nothing
    c = (await client.sql("""INSERT INTO organizations (display_name, organization_type) VALUES (:n, 'manufacturer')
                             RETURNING id::text""", n=f"Scn Cli {t}"))[0][0]
    report = tmp_path / "report.csv"
    assert await bf.main(["--report", str(report)]) == 0
    assert c in report.read_text()
    assert (await _org(client, c))[0] is None
    assert (await client.sql("SELECT count(*) FROM onboarding_source_backfill_log WHERE record_id=CAST(:o AS uuid)",
                             o=c))[0][0] == 0


# ================================================================== registration channel
async def test_registration_channel_for_each_way_of_registering(client, monkeypatch):  # noqa: F811
    t = _tag()
    google = f"user_g_{t}"
    await client.register(google, "google")
    await client.register(google, "google")  # repeated callback
    sub = await legacy_user(client)
    clerk_api(monkeypatch, {})
    await client.sql("""INSERT INTO marketplace_role_selections (user_id, role_selected, status)
                        SELECT id, 'vendor', 'active' FROM users WHERE clerk_user_id=:s""", s=sub)
    assert (await client.get("/identity/me", headers=hdr(client, sub))).status_code == 200
    # the legacy user later completes Sign-up: channel stays what was recorded first
    client.unregistered.discard(sub)
    await client.register(sub)
    admin = await _admin(client)
    r = await client.post("/admin/admin-users", headers=admin, json={"email": f"staff_{t}@example.com",
                                                                       "name": "Staff Member"})
    assert r.status_code == 201, r.text
    rows = dict((x[0], (x[1], x[2])) for x in await client.sql("""
        SELECT coalesce(clerk_user_id, ''), registration_channel, registration_method FROM users
        WHERE clerk_user_id IN (:g, :l) OR email = CAST(:e AS citext)""", g=google, l=sub, e=f"staff_{t}@example.com"))
    assert rows[google] == ("web_signup", "google")
    assert rows[sub] == ("legacy_account", "legacy_activity")
    staff = next(v for k, v in rows.items() if k.startswith("local-admin:"))
    assert staff[0] == "admin_portal"


# ================================================================== admin APIs
async def test_admin_users_and_manufacturers_reflect_stored_values(client, tmp_path):  # noqa: F811
    admin = await _admin(client)
    t = _tag()
    org = (await _import(tmp_path, t, name=f"Scn Listed {t}")).inserted[0][2]
    sub = f"user_list_{t}"
    assert (await client.post("/manufacturer/account", headers=hdr(client, sub), json=account(
        f"Scn Listed {t}", companyId=org))).status_code == 201
    row = next(r for r in (await client.get("/admin/manufacturers", headers=admin, params={"q": f"Scn Listed {t}"})).json()["rows"])
    stored = (await _org(client, org))[0]
    assert row["onboardingSource"] == stored == "database_import" and row["onboardingSourceNote"] is None
    d = (await client.get(f"/admin/manufacturers/{org}", headers=admin)).json()["onboarding"]
    assert d["backfill"] is None and d["note"] is None and d["importBatch"]["importedBy"] == "job:test"
    # linked companies come from active memberships only (never from names or email domains)
    async def companies():
        u = next(x for x in (await client.get("/admin/users", headers=admin, params={"q": sub})).json()["rows"])
        return u, {c["id"]: c["onboardingSource"] for c in u["companies"]}
    u, before = await companies()
    assert org not in before  # a pending claim grants no membership
    await client.sql("""INSERT INTO memberships (user_id, organization_id, membership_role, status)
                        SELECT id, CAST(:o AS uuid), 'member', 'active' FROM users WHERE clerk_user_id=:s""", o=org, s=sub)
    assert (await companies())[1][org] == "database_import"
    await client.sql("""UPDATE memberships SET status='removed' WHERE organization_id=CAST(:o AS uuid)
                        AND user_id=(SELECT id FROM users WHERE clerk_user_id=:s)""", o=org, s=sub)
    assert org not in (await companies())[1]
    assert u["registrationChannel"] == "web_signup" and u["registrationMethod"] == "manual"


async def test_visionaries_filters_pagination_and_access(client):  # noqa: F811
    admin = await _admin(client)
    t = _tag()
    subs = []
    for i in range(3):
        v = f"user_vp_{i}_{t}"
        subs.append(v)
        r = await client.put("/visionary/profile", headers=hdr(client, v), json={
            "name": f"Vis {i} {t}", "role": "Founder", "org": f"Org{i} {t}", "location": f"City{i}", "intro": ""})
        assert r.status_code == 200, r.text
    role_only = f"user_vr_{t}"
    assert (await client.get("/identity/me", headers=hdr(client, role_only))).status_code == 200
    await client.sql("""INSERT INTO marketplace_role_selections (user_id, role_selected, status)
                        SELECT id, 'demand_requester', 'active' FROM users WHERE clerk_user_id=:s""", s=role_only)

    async def lst(**p):
        r = await client.get("/admin/visionaries", headers=admin, params={"q": t, **p})
        assert r.status_code == 200, r.text
        return r.json()

    everyone = await lst(page_size=100)
    assert everyone["total"] == 4 and len({x["id"] for x in everyone["rows"]}) == 4
    page1, page2 = await lst(page_size=5, page=1), await lst(page_size=5, page=2)
    assert len(page1["rows"]) == 4 and page2["rows"] == [] and page2["total"] == 4
    assert [x["name"] for x in (await lst(q=f"Org1 {t}"))["rows"]] == [f"Vis 1 {t}"]
    assert (await client.get("/admin/visionaries", headers=admin, params={"q": "City2"})).json()["total"] >= 1
    missing = (await lst(profile="missing"))["rows"]
    assert [x["email"] for x in missing] == [f"{role_only}@example.com"] and missing[0]["profileSaved"] is False
    d = (await client.get(f"/admin/visionaries/{missing[0]['id']}", headers=admin)).json()
    assert d["profile"] is None and d["projects"] == [] and d["requests"] == [] and d["draftCount"] == 0
    assert len((await lst(profile="saved"))["rows"]) == 3
    # account status filter (suspend one through the real admin API)
    target = next(x for x in everyone["rows"] if x["email"] == f"{subs[0]}@example.com")
    assert (await client.post(f"/admin/users/{target['id']}/suspend", headers=admin,
                              json={"reason": "test suspension"})).status_code == 200
    assert [x["id"] for x in (await lst(account_status="suspended"))["rows"]] == [target["id"]]
    # bad input and access
    assert (await client.get("/admin/visionaries/not-a-uuid", headers=admin)).status_code == 422
    assert (await client.get(f"/admin/visionaries/{uuid.uuid4()}", headers=admin)).status_code == 404
    assert (await client.get("/admin/visionaries", headers=admin, params={"profile": "bogus"})).status_code == 422
    assert (await client.get("/admin/visionaries", headers=admin, params={"page_size": 1000})).status_code == 422
    support = f"support_{t}"
    sh = hdr(client, support)
    assert (await client.get("/identity/me", headers=sh)).status_code == 200
    await client.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                        SELECT id, 'support_specialist' FROM users WHERE clerk_user_id=:s""", s=support)
    assert (await client.get("/admin/visionaries", headers=sh, params={"q": t})).status_code == 200
    assert (await client.get("/admin/visionaries", headers=hdr(client, subs[1]))).status_code == 403
