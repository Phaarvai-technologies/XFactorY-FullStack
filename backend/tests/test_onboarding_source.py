"""Company onboarding source (migration 020), the admin Users source display and the admin
Visionaries views. Real PostgreSQL through the real HTTP API (E2E_DATABASE_URL), decisions through
the real admin endpoint, imports through app.import_manufacturers."""
import os
import uuid
from pathlib import Path

import pytest

from test_e2e_local import approve_company, client  # noqa: F401  (shared fixture)
from test_manufacturer_approval import account, booking_status, complete_profile, hdr, own_org, visible

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


def _tag():
    return uuid.uuid4().hex[:6]


async def _admin(c):
    sub = f"admin_{_tag()}"
    h = hdr(c, sub)
    assert (await c.get("/identity/me", headers=h)).status_code == 200
    await c.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                   SELECT id, 'platform_administrator' FROM users WHERE clerk_user_id=:s""", s=sub)
    return h


async def _import(tmp_path, t, name=None):
    from app.core.database import SessionFactory
    from app.import_manufacturers import import_rows, read_rows
    import hashlib
    path = Path(tmp_path) / f"batch_{t}.csv"
    path.write_text(f"name,country,city,category,capacity\n{name or f'Imported Forge {t}'},India,Pune,"
                    "Automotive & Machinery,300 t\n")
    async with SessionFactory() as session:
        report = await import_rows(session, read_rows(path), reference=path.name,
                                   content_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), actor="job:test")
        await session.commit()
    return report


async def _org(c, org):
    return (await c.sql("""SELECT onboarding_source, import_batch_id::text, entry_source FROM organizations
                           WHERE id=CAST(:o AS uuid)""", o=org))[0]


async def _events(c, org):
    return [tuple(x) for x in await c.sql("""
        SELECT e.event, e.source, e.actor_role, (e.actor_user_id IS NOT NULL), coalesce(s.kind, '-')
        FROM manufacturer_submission_events e LEFT JOIN manufacturer_submissions s ON s.id=e.submission_id
        WHERE e.organization_id=CAST(:o AS uuid) ORDER BY e.created_at""", o=org)]


# ---------------------------------------------------------------------------------------------
async def test_import_assigns_source_and_batch_once_and_is_not_approved(client, tmp_path):  # noqa: F811
    t = _tag()
    first = await _import(tmp_path, t)
    assert len(first.inserted) == 1
    org = first.inserted[0][2]
    src, batch, entry = await _org(client, org)
    assert (src, batch, entry) == ("database_import", first.batch_id, "IMPORTED")
    b = (await client.sql("SELECT source_reference, imported_by, content_sha256 IS NOT NULL FROM import_batches "
                          "WHERE id=CAST(:b AS uuid)", b=batch))[0]
    assert tuple(b) == (f"batch_{t}.csv", "job:test", True)
    assert await _events(client, org) == [("imported", "database_import", "system", False, "-")]

    # retry of the same file: same batch, no new company, no new event
    again = await _import(tmp_path, t)
    assert again.batch_id == first.batch_id and again.inserted == [] and len(again.present) == 1
    assert (await client.sql("SELECT count(*) FROM organizations WHERE display_name=:n",
                             n=f"Imported Forge {t}"))[0][0] == 1
    assert await _events(client, org) == [("imported", "database_import", "system", False, "-")]

    # never auto-approved: selectable in onboarding lookup, invisible to Visionaries
    assert (await client.sql("SELECT count(*) FROM manufacturer_onboarding WHERE organization_id=CAST(:o AS uuid) "
                             "AND status='approved'", o=org))[0][0] == 0
    u = hdr(client, f"user_look_{t}")
    found = (await client.get("/manufacturer/companies/search", headers=u, params={"q": f"Imported Forge {t}"})).json()
    assert [i["id"] for i in found["items"]] == [org]
    assert not await visible(client, org)


async def test_dashboard_submission_on_imported_company_keeps_source_review_recorded_separately(client, tmp_path):  # noqa: F811
    t = _tag()
    org = (await _import(tmp_path, t)).inserted[0][2]
    batch = (await _org(client, org))[1]
    sub = f"user_claim_{t}"
    h = hdr(client, sub)
    body = account(f"Imported Forge {t}", companyId=org, companyType="Other", capacity="900 t")
    r = await client.post("/manufacturer/account", headers=h, json=body)
    assert r.status_code == 201, r.text
    # retry of the same submission: still one submission and one 'submitted' event
    assert (await client.post("/manufacturer/account", headers=h, json=body)).status_code == 201
    rows = await client.sql("""
        SELECT s.kind, s.source, s.status, s.submitted_at IS NOT NULL, u.clerk_user_id,
               s.target_organization_id::text, s.selected_company_id::text
        FROM manufacturer_submissions s JOIN users u ON u.id = s.submitted_by_user_id
        WHERE s.target_organization_id=CAST(:o AS uuid)""", o=org)
    assert [tuple(x) for x in rows] == [("claim", "web_dashboard", "pending", True, sub, org, org)]
    assert await _org(client, org) == ("database_import", batch, "IMPORTED")  # original source kept
    assert await _events(client, org) == [("imported", "database_import", "system", False, "-"),
                                          ("submitted", "web_dashboard", "requester", True, "claim")]

    # admin approval: a review action, merged into the same company; source / batch untouched
    assert (await approve_company(client, org)).status_code == 200
    assert await _org(client, org) == ("database_import", batch, "IMPORTED")
    reviewed = (await client.sql("""SELECT status, reviewed_by_user_id IS NOT NULL, reviewed_at IS NOT NULL,
                                           applied_at IS NOT NULL, source
                                    FROM manufacturer_submissions WHERE target_organization_id=CAST(:o AS uuid)""",
                                 o=org))[0]
    assert tuple(reviewed) == ("approved", True, True, True, "web_dashboard")
    assert await _events(client, org) == [("imported", "database_import", "system", False, "-"),
                                          ("submitted", "web_dashboard", "requester", True, "claim"),
                                          ("decision", "admin_review", "admin", True, "claim"),
                                          ("merged", "admin_review", "admin", True, "claim")]
    # deciding again (retry) adds nothing
    assert (await approve_company(client, org)).status_code in (200, 409, 422)
    assert len(await _events(client, org)) == 4

    # a later dashboard change by the new owner: a new web_dashboard submission, same source
    r = await client.post("/manufacturer/account", headers=h, json={**body, "capacity": "950 t"})
    assert r.status_code == 201, r.text
    latest = (await client.sql("""SELECT kind, source, status FROM manufacturer_submissions
                                  WHERE target_organization_id=CAST(:o AS uuid) ORDER BY created_at DESC LIMIT 1""",
                               o=org))[0]
    assert tuple(latest) == ("update", "web_dashboard", "pending")
    assert await _org(client, org) == ("database_import", batch, "IMPORTED")

    # the admin detail shows the original source, the batch and the history (approval separate)
    d = (await client.get(f"/admin/manufacturers/{org}", headers=await _admin(client))).json()
    assert d["manufacturer"]["onboardingSource"] == "database_import"
    assert d["onboarding"]["source"] == "database_import" and d["onboarding"]["sourceLabel"] == "Database Import"
    assert d["onboarding"]["importBatch"]["id"] == batch
    assert {e["sourceLabel"] for e in d["onboarding"]["history"]} == {"Database Import", "Web Dashboard", "Admin review"}


async def test_new_company_from_dashboard_and_eligibility_needs_approval_and_completion(client):  # noqa: F811
    t = _tag()
    sub = f"user_new_{t}"
    h = hdr(client, sub)
    assert (await client.post("/manufacturer/account", headers=h, json=account(f"Fresh Tools {t}"))).status_code == 201
    org = await own_org(client, sub)
    # awaiting approval: the source is on the staged submission, not yet on the company record
    assert await _org(client, org) == (None, None, "MANUFACTURER")
    staged = (await client.sql("SELECT kind, source, status FROM manufacturer_submissions WHERE target_organization_id="
                               "CAST(:o AS uuid)", o=org))[0]
    assert tuple(staged) == ("new_company", "web_dashboard", "pending")
    # not approved -> the profile cannot be completed (locked), not visible, no booking
    assert (await client.patch("/manufacturer/profile", headers=h, json={"company": {"about": "x"}})).status_code == 403
    assert not await visible(client, org) and await booking_status(client, org) == 404
    assert (await approve_company(client, org)).status_code == 200
    assert await _org(client, org) == ("web_dashboard", None, "MANUFACTURER")
    await complete_profile(client, h)  # approved AND complete -> visible
    assert await visible(client, org) and await booking_status(client, org) == 201

    # approved but incomplete -> not visible, no booking
    sub2 = f"user_new2_{t}"
    h2 = hdr(client, sub2)
    assert (await client.post("/manufacturer/account", headers=h2, json=account(f"Half Tools {t}"))).status_code == 201
    org2 = await own_org(client, sub2)
    assert (await approve_company(client, org2)).status_code == 200
    assert not await visible(client, org2) and await booking_status(client, org2) == 404


async def test_source_cannot_be_spoofed_and_future_channels_are_unavailable(client):  # noqa: F811
    from sqlalchemy.exc import DBAPIError

    from app.core import onboarding_source
    from app.core.database import SessionFactory
    from app.main import app
    from app.manufacturer_approval import stage

    t = _tag()
    sub = f"user_spoof_{t}"
    h = hdr(client, sub)
    for key, value in (("onboardingSource", "ai_voice_call"), ("source", "database_import"),
                       ("submission_source", "ground_sales"), ("importBatchId", str(uuid.uuid4()))):
        r = await client.post("/manufacturer/account", headers=h, json={**account(f"Spoof {t}"), key: value})
        assert r.status_code == 422, (key, r.text)
        assert "assigned by XfactorY" in r.text
    assert (await client.sql("""SELECT count(*) FROM manufacturer_submissions s JOIN users u
                                ON u.id=s.submitted_by_user_id WHERE u.clerk_user_id=:s""", s=sub))[0][0] == 0

    for name in ("ai_voice_call", "ground_sales", "made_up"):
        with pytest.raises(onboarding_source.SourceUnavailable):
            onboarding_source.require(name)
    async with SessionFactory() as session:
        with pytest.raises(onboarding_source.SourceUnavailable):
            await stage(session, user_id=uuid.uuid4(), workspace_id=uuid.uuid4(), target_id=uuid.uuid4(),
                        selected_id=None, kind="new_company", payload={}, source="ai_voice_call")
    # the database refuses reserved values and any change of an existing source
    assert (await client.post("/manufacturer/account", headers=h, json=account(f"Spoof {t}"))).status_code == 201
    org = await own_org(client, sub)
    assert (await approve_company(client, org)).status_code == 200  # approval copies the staged source
    for sql in ("UPDATE organizations SET onboarding_source='ai_voice_call' WHERE id=CAST(:o AS uuid)",
                "UPDATE organizations SET onboarding_source='database_import' WHERE id=CAST(:o AS uuid)",
                "UPDATE organizations SET onboarding_source=NULL WHERE id=CAST(:o AS uuid)"):
        async with SessionFactory() as session:
            with pytest.raises(DBAPIError):
                await session.execute(__import__("sqlalchemy").text(sql), {"o": org})
    assert (await _org(client, org))[0] == "web_dashboard"
    # no AI-call or field-sales endpoint exists
    paths = [getattr(r, "path", "") for r in app.routes]
    assert not [p for p in paths if any(w in p for w in ("voice", "ai-call", "ai_call", "sales", "ground"))]


async def test_admin_users_show_each_company_source_and_visionary_views(client, tmp_path):  # noqa: F811
    admin = await _admin(client)
    t = _tag()
    # user A: own dashboard company + a membership in an imported company + one in a company
    # with no recorded source (historical)
    a = f"user_multi_{t}"
    ha = hdr(client, a)
    assert (await client.post("/manufacturer/account", headers=ha, json=account(f"Multi Own {t}"))).status_code == 201
    imported = (await _import(tmp_path, t, name=f"Multi Imported {t}")).inserted[0][2]
    legacy = (await client.sql("""INSERT INTO organizations (display_name, organization_type, status)
                                  VALUES (:n, 'manufacturer', 'active') RETURNING id::text""",
                               n=f"Multi Legacy {t}"))[0][0]
    for org in (imported, legacy):
        await client.sql("""INSERT INTO memberships (user_id, organization_id, membership_role, status, accepted_at)
                            SELECT id, CAST(:o AS uuid), 'member', 'active', now() FROM users WHERE clerk_user_id=:s""",
                         o=org, s=a)
    # Visionary with a saved profile, a project and a request to an eligible manufacturer
    m = f"user_vm_{t}"
    hm = hdr(client, m)
    assert (await client.post("/manufacturer/account", headers=hm, json=account(f"Vis Supplier {t}"))).status_code == 201
    morg = await own_org(client, m)
    assert (await approve_company(client, morg)).status_code == 200
    await complete_profile(client, hm)
    v = f"user_vis_{t}"
    hv = hdr(client, v)
    profile = {"name": f"Priya {t}", "role": "Founder", "org": f"Brew {t}", "location": "Chennai", "intro": "Cups."}
    assert (await client.put("/visionary/profile", headers=hv, json=profile)).status_code == 200
    assert (await client.put("/visionary/project/idea", headers=hv, json={
        "project": f"Cups {t}", "idea": "Branded cups", "product": "Paper cups", "industry": "Food & Beverage"})).status_code == 200
    assert (await client.put("/visionary/project/stage", headers=hv, json={"stage": "Prototype Stage"})).status_code == 200
    assert (await client.put("/visionary/project/requirements", headers=hv, json={
        "manufacturing_location": "Chennai", "quantity": {"value": 1000, "unit": "units"},
        "budget": {"amount": 200000, "currency": "INR"}, "timeline": "1_3_months",
        "additional_requirements": "Food-grade ink"})).status_code == 200
    r = await client.post("/visionary/requests", headers=hv, json={
        "manufacturer_id": morg, "machine": "Die Casting", "quantity": {"value": 1000, "unit": "units"},
        "required_duration": "1_month", "manufacturing_location": "Chennai",
        "budget": {"amount": 200000, "currency": "INR"}, "timeline": "1_3_months"})
    assert r.status_code == 201, r.text

    # --- Users: one entry per linked company, each with its own source; approval separate
    rows = {u["email"]: u for u in (await client.get("/admin/users", params={"q": t, "page_size": 100},
                                                     headers=admin)).json()["rows"]}
    comp = {c["name"]: c for c in rows[f"{a}@example.com"]["companies"]}
    assert {n: c["onboardingSource"] for n, c in comp.items()} == {
        f"Multi Own {t}": None, f"Multi Imported {t}": "database_import", f"Multi Legacy {t}": None}
    # a new company awaiting approval shows its staged source, separately from the stored one
    assert comp[f"Multi Own {t}"]["stagedSource"] == {"source": "web_dashboard", "status": "pending"}
    assert comp[f"Multi Legacy {t}"]["stagedSource"] is None
    assert comp[f"Multi Own {t}"]["reviewStatus"] == "SUBMITTED"
    assert rows[f"{m}@example.com"]["companies"][0]["reviewStatus"] == "REVIEWED"
    assert rows[f"{m}@example.com"]["companies"][0]["onboardingSource"] == "web_dashboard"  # approval is not a source
    assert rows[f"{v}@example.com"]["companies"] == []
    detail = (await client.get(f"/admin/users/{rows[f'{a}@example.com']['id']}", headers=admin)).json()
    assert {x["company_name"]: x["onboarding_source_label"] for x in detail["manufacturers"]} == {
        f"Multi Own {t}": "Unknown", f"Multi Imported {t}": "Database Import", f"Multi Legacy {t}": "Unknown"}

    # --- Visionaries listing: exactly the Visionary, once (a second role row adds no duplicate)
    await client.sql("""INSERT INTO marketplace_role_selections (user_id, role_selected, status)
                        SELECT id, 'demand_requester', 'inactive' FROM users WHERE clerk_user_id=:s""", s=v)
    lst = await client.get("/admin/visionaries", params={"q": t, "page_size": 100}, headers=admin)
    assert lst.status_code == 200, lst.text
    data = lst.json()
    assert [x["email"] for x in data["rows"]] == [f"{v}@example.com"] and data["total"] == 1
    row = data["rows"][0]
    assert (row["name"], row["roleTitle"], row["organizationName"], row["location"], row["profileSaved"],
            row["projectCount"], row["requestCount"]) == (f"Priya {t}", "Founder", f"Brew {t}", "Chennai", True, 1, 1)
    assert (await client.get("/admin/visionaries", params={"q": t, "profile": "missing"}, headers=admin)).json()["rows"] == []

    d = (await client.get(f"/admin/visionaries/{row['id']}", headers=admin)).json()
    assert d["profile"]["introduction"] == "Cups." and d["profile"]["fullName"] == f"Priya {t}"
    [p] = d["projects"]
    assert (p["name"], p["product"], p["industry"], p["stage"], p["location"], p["quantity"], p["budget"],
            p["timeline"], p["additionalRequirements"], p["requestCount"]) == (
        f"Cups {t}", "Paper cups", "Food & Beverage", "Prototype Stage", "Chennai", 1000, 200000.0, "1_3_months",
        "Food-grade ink", 1)
    [req] = d["requests"]
    assert (req["manufacturerId"], req["manufacturerName"], req["machine"], req["projectName"], req["duration"]) == (
        morg, f"Vis Supplier {t}", "Die Casting", f"Cups {t}", "1_month")
    # a manufacturer is not a Visionary
    muser = rows[f"{m}@example.com"]["id"]
    assert (await client.get(f"/admin/visionaries/{muser}", headers=admin)).status_code == 404

    # --- admin-only
    plain = hdr(client, f"user_plain_{t}")
    for path in ("/admin/visionaries", f"/admin/visionaries/{row['id']}", "/admin/users",
                 f"/admin/users/{row['id']}", f"/admin/manufacturers/{imported}"):
        assert (await client.get(path, headers=plain)).status_code == 403, path
        assert (await client.get(path, headers={"Authorization": ""})).status_code == 401, path
    for path in ("/admin/visionaries", f"/admin/visionaries/{row['id']}"):
        assert (await client.get(path, headers=hv)).status_code == 403, path  # the Visionary themself
