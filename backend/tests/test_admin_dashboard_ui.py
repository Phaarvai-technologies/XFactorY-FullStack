"""Admin dashboard data used by the compact listings (real Postgres through the real admin API):
linked-user counts and members per company, Users role filter + onboarding source, the
Machinery tab, request info in the review queue, the review count, and the "Approved" label.

Run with E2E_DATABASE_URL set (see test_e2e_local.py)."""
import os
import uuid

import pytest

from test_e2e_local import approve_company, client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")

ACCOUNT = {"firstName": "Asha", "lastName": "Rao", "contact": "asha@example.com", "dob": "1990-01-01",
           "companyType": "Automotive & Machinery", "country": "India", "phone": "9876543210", "capacity": "10 units"}
MACHINE = {"industry": "Automotive", "subcategory": "Machining", "type": "5-axis CNC mill", "capacity": "100",
           "age": "5", "condition": "Good", "technical": "Haas", "images": [], "rawMatStatus": "Provided",
           "materialDetails": "", "laborType": "Skilled", "workerCount": "3", "workerRoles": "", "logistics": [],
           "logisticsPartner": "", "pricing": {"hour": "1500", "day": "", "month": "", "unit": "", "batch": ""},
           "insurance": "Yes"}


def _tag() -> str:
    return uuid.uuid4().hex[:6]


def _hdr(c, sub):
    return {"Authorization": f"Bearer {c.token_for(sub)}"}


async def _admin(c):
    admin = f"admin_{_tag()}"
    hdr = _hdr(c, admin)
    assert (await c.get("/identity/me", headers=hdr)).status_code == 200
    await c.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                   SELECT id, 'platform_administrator' FROM users WHERE clerk_user_id=:s""", s=admin)
    return hdr


async def _manufacturer(c, name=None):
    sub = f"user_m_{_tag()}"
    name = name or f"Dash Works {_tag()}"
    r = await c.post("/manufacturer/account", headers=_hdr(c, sub), json={**ACCOUNT, "companyName": name})
    assert r.status_code == 201, r.text
    org = (await c.sql("""SELECT o.id::text FROM organizations o JOIN memberships m ON m.organization_id=o.id
                          JOIN users u ON u.id=m.user_id WHERE u.clerk_user_id=:c""", c=sub))[0][0]
    return sub, org, name


async def _find(c, admin, name):
    r = await c.get("/admin/manufacturers", params={"q": name, "listing": "all"}, headers=admin)
    assert r.status_code == 200, r.text
    return r.json()["rows"]


async def test_company_linked_users_count_and_members_by_membership_only(client):  # noqa: F811
    admin = await _admin(client)
    owner, org, name = await _manufacturer(client)
    # a second user linked to exactly this company (member) and one whose link was removed
    for sub, status in ((f"user_mem_{_tag()}", "active"), (f"user_rm_{_tag()}", "removed")):
        assert (await client.get("/identity/me", headers=_hdr(client, sub))).status_code == 200
        await client.sql("""INSERT INTO memberships (user_id, organization_id, membership_role, status)
                            SELECT id, CAST(:o AS uuid), 'member', :st FROM users WHERE clerk_user_id=:s""",
                         o=org, s=sub, st=status)
    # a user with a lookalike email domain / same company name elsewhere is NOT linked
    _, other_org, _ = await _manufacturer(client, name=f"{name} Two")

    row = next(r for r in await _find(client, admin, name) if r["id"] == org)
    assert row["linkedUsers"] == 2  # active memberships only
    detail = (await client.get(f"/admin/manufacturers/{org}", headers=admin)).json()
    members = detail["members"]
    assert [(m["membershipRole"], m["membershipStatus"]) for m in members] == [
        ("owner", "active"), ("member", "active"), ("member", "removed")]
    assert members[0]["roles"] == ["manufacturer"] and members[0]["email"] == f"{owner}@example.com"
    assert all(m["id"] for m in members)
    other = (await client.get(f"/admin/manufacturers/{other_org}", headers=admin)).json()
    assert len(other["members"]) == 1  # its own owner only

    # a seeded / imported company: listed as such, with no user accounts
    seeded = f"Seeded Forge {_tag()}"
    await client.sql("""INSERT INTO organizations (display_name, organization_type, status, entry_source)
                        VALUES (:n, 'manufacturer', 'active', 'IMPORTED')""", n=seeded)
    s_row = (await _find(client, admin, seeded))[0]
    assert s_row["entrySource"] == "IMPORTED" and s_row["linkedUsers"] == 0
    assert (await client.get(f"/admin/manufacturers/{s_row['id']}", headers=admin)).json()["members"] == []


async def test_users_role_filter_roles_and_onboarding_source(client):  # noqa: F811
    admin = await _admin(client)
    t = _tag()
    msub, _, mname = await _manufacturer(client, name=f"Role Co {t}")
    vsub = f"user_vis_{t}"
    assert (await client.get("/identity/me", headers=_hdr(client, vsub))).status_code == 200
    await client.sql("""INSERT INTO marketplace_role_selections (user_id, role_selected, status)
                        SELECT id, 'demand_requester', 'active' FROM users WHERE clerk_user_id=:s""", s=vsub)

    async def emails(role):
        r = await client.get("/admin/users", params={"q": t, "role": role, "page_size": 100}, headers=admin)
        assert r.status_code == 200, r.text
        return {u["email"]: u for u in r.json()["rows"]}

    everyone = await client.get("/admin/users", params={"q": t, "page_size": 100}, headers=admin)
    mine = {u["email"] for u in everyone.json()["rows"]}
    makers, visionaries = await emails("manufacturer"), await emails("visionary")
    assert f"{msub}@example.com" in makers and f"{vsub}@example.com" not in makers
    assert f"{vsub}@example.com" in visionaries and f"{msub}@example.com" not in visionaries
    assert set(makers) | set(visionaries) <= mine
    m = makers[f"{msub}@example.com"]
    # onboarding source is the linked company's own (020), one entry per company
    assert m["roles"] == ["manufacturer"] and m["companyName"] == mname
    assert [(c["name"], c["onboardingSource"], c["stagedSource"]) for c in m["companies"]] == [
        (mname, None, {"source": "web_dashboard", "status": "pending"})]  # copied to the company on approval
    assert visionaries[f"{vsub}@example.com"]["roles"] == ["demand_requester"]
    assert visionaries[f"{vsub}@example.com"]["companies"] == []  # no company: "Not applicable"
    assert (await client.get("/admin/users", params={"role": "machinery"}, headers=admin)).status_code == 422
    # admins stay in the Admins tab
    r = await client.get("/admin/users", params={"q": "admin_", "page_size": 100}, headers=admin)
    assert all(not u["isAdmin"] for u in r.json()["rows"])


async def test_machinery_tab_lists_company_machines(client):  # noqa: F811
    admin = await _admin(client)
    sub, org, name = await _manufacturer(client)
    hdr = _hdr(client, sub)
    # approval first: machinery stays locked until X!Y approves the application
    assert (await client.post("/manufacturer/machinery", headers=hdr, json=MACHINE)).status_code == 403
    assert (await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=admin,
                               json={"review_status": "REVIEWED"})).status_code == 200
    assert (await client.post("/manufacturer/machinery", headers=hdr, json={**MACHINE, "status": "Published"})).status_code == 201
    assert (await client.post("/manufacturer/machinery", headers=hdr,
                              json={**MACHINE, "type": "Lathe", "status": "Draft"})).status_code == 201
    av = await client.put("/manufacturer/availability", headers=hdr, json={
        "calendar": {}, "recurring": {"days": ["Mon", "Tue"], "start": "09:00", "end": "17:00"},
        "capacity": {"machine": "Lathe", "count": "2", "start": "2026-11-01", "end": "2026-11-30"}})
    assert av.status_code == 200, av.text

    r = await client.get("/admin/machinery", params={"org": org}, headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["company"] == name and body["total"] == 2
    by = {m["name"]: m for m in body["rows"]}
    assert by["5-axis CNC mill"]["listingStatus"] == "Published" and by["Lathe"]["listingStatus"] == "Draft"
    assert all(m["companyId"] == org and m["companyName"] == name for m in body["rows"])
    assert by["5-axis CNC mill"]["industry"] == "Automotive" and by["5-axis CNC mill"]["capacity"] == "100"
    assert by["Lathe"]["availability"] == "2 × 2026-11-01 to 2026-11-30"          # the company's plan for this machine
    assert by["5-axis CNC mill"]["availability"] == "Mon, Tue · 09:00–17:00 (company hours)"
    r = await client.get("/admin/machinery", params={"org": org, "status": "Draft"}, headers=admin)
    assert [m["name"] for m in r.json()["rows"]] == ["Lathe"]
    r = await client.get("/admin/machinery", params={"q": name}, headers=admin)
    assert {m["name"] for m in r.json()["rows"]} == {"5-axis CNC mill", "Lathe"}
    # users see machinery through their company (count + link), not as a role
    uid = (await client.sql("SELECT id::text FROM users WHERE clerk_user_id=:s", s=sub))[0][0]
    ud = (await client.get(f"/admin/users/{uid}", headers=admin)).json()
    assert ud["manufacturers"][0]["machinery_count"] == 2 and ud["manufacturers"][0]["entry_source"] == "MANUFACTURER"
    # admin only
    assert (await client.get("/admin/machinery", headers=hdr)).status_code in (401, 403)


async def test_review_queue_request_info_count_and_approved_label(client):  # noqa: F811
    admin = await _admin(client)
    before = (await client.get("/admin/overview", headers=admin)).json()["cards"]["awaitingReview"]
    sub, org, name = await _manufacturer(client)  # a new company account awaiting approval
    after = (await client.get("/admin/overview", headers=admin)).json()["cards"]["awaitingReview"]
    assert after == before + 1  # shows up in the existing dashboard count / review queue link

    queue = (await client.get("/admin/review-queue", params={"q": name}, headers=admin)).json()["rows"]
    row = next(r for r in queue if r["id"] == org)
    assert row["reviewStatus"] == "SUBMITTED"
    assert row["request"]["kind"] == "new_company" and row["request"]["label"] == "New company account"
    assert row["request"]["requestedBy"] == "Asha Rao" and row["request"]["submittedAt"] and row["request"]["openCount"] == 1

    assert (await approve_company(client, org)).status_code == 200
    history = (await client.get(f"/admin/manufacturers/{org}", headers=admin)).json()["history"]
    status_change = next(h for h in history if h["field_changed"] == "Review status")
    assert status_change["new_value"] == "Approved"  # a stored approval
    timeline = (await client.get(f"/admin/manufacturers/{org}", headers=admin)).json()["timeline"]
    assert any(t["event"] == "Approved by X!Y" for t in timeline)

    # another user's update request on the now-approved company appears as its own request type
    other = f"user_req_{_tag()}"
    r = await client.post("/manufacturer/account", headers=_hdr(client, other), json={
        **ACCOUNT, "contact": "ravi@example.com", "companyName": name, "companyId": org, "capacity": "999"})
    assert r.status_code == 201 and r.json()["submitted"]["kind"] == "update_request"
    row = next(r for r in (await client.get("/admin/review-queue", params={"q": name}, headers=admin)).json()["rows"]
               if r["id"] == org)
    assert row["reviewStatus"] == "SUBMITTED" and row["request"]["kind"] == "update_request"

    # a rejection is shown as Rejected, never as Approved
    _, org2, name2 = await _manufacturer(client)
    assert (await approve_company(client, org2, "REJECTED", "Not a manufacturer")).status_code == 200
    h2 = (await client.get(f"/admin/manufacturers/{org2}", headers=admin)).json()["history"]
    assert next(h for h in h2 if h["field_changed"] == "Review status")["new_value"] == "Rejected"
