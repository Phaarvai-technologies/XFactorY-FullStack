"""Admin Dashboard MVP (XY-ADMIN-01..10) against a real PostgreSQL with the XY
schema + migrations. Skipped without E2E_DATABASE_URL."""
import os
import uuid

import pytest

from test_e2e_local import ACCOUNT, client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


@pytest.fixture
def no_clerk(monkeypatch):
    """Clerk API calls (ban/unban, last sign-in) are replaced; records what was sent."""
    from app.core import clerk
    calls = []

    async def set_banned(self, clerk_user_id, banned):
        calls.append((clerk_user_id, banned))

    async def login_info(self, clerk_user_id):
        return {"last_sign_in_at": 1790000000000, "last_active_at": None, "banned": False}

    monkeypatch.setattr(clerk.ClerkManagement, "set_banned", set_banned)
    monkeypatch.setattr(clerk.ClerkManagement, "login_info", login_info)
    return calls


def auth(c, sub):
    return {"Authorization": f"Bearer {c.token_for(sub)}"}


async def make_admin(c, sub):
    """A signed-in X!Y staff member with the platform_administrator role."""
    assert (await c.get("/identity/me", headers=auth(c, sub))).status_code == 200
    await c.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                   SELECT id, 'platform_administrator' FROM users WHERE clerk_user_id=:s""", s=sub)
    return auth(c, sub)


async def new_manufacturer(c, company, **extra):
    """A separate manufacturer user who fills the onboarding form."""
    sub = f"user_{uuid.uuid4().hex[:10]}"
    h = auth(c, sub)
    r = await c.post("/manufacturer/account", headers=h, json={**ACCOUNT, "companyName": company, **extra})
    assert r.status_code == 201, r.text
    org = (await c.sql("""SELECT o.id FROM organizations o JOIN memberships m ON m.organization_id=o.id
                          JOIN users u ON u.id=m.user_id WHERE u.clerk_user_id=:s""", s=sub))[0][0]
    return sub, h, str(org)


async def test_access_is_admin_only(client, no_clerk, monkeypatch):
    # A normal manufacturer user cannot use any admin API
    await client.post("/manufacturer/account", json=ACCOUNT)
    for path in ("/admin/me", "/admin/overview", "/admin/manufacturers", "/admin/users", "/admin/analytics"):
        r = await client.get(path)
        assert r.status_code == 403, (path, r.status_code)
    assert (await client.get("/admin/me", headers={"Authorization": ""})).status_code == 401

    # Granted admin -> allowed
    admin = await make_admin(client, f"admin_{uuid.uuid4().hex[:8]}")
    me = (await client.get("/admin/me", headers=admin)).json()
    assert me["roles"] == ["platform_administrator"]

    # ADMIN_EMAILS bootstraps the first admin on first visit
    from app.core.config import get_settings
    boot = f"boot_{uuid.uuid4().hex[:8]}"
    monkeypatch.setattr(get_settings(), "admin_emails", f"someone@x.com, {boot}@example.com")
    assert (await client.get("/admin/me", headers=auth(client, boot))).status_code == 200


async def test_manufacturer_list_detail_edit_history(client, no_clerk):
    admin = await make_admin(client, f"admin_{uuid.uuid4().hex[:8]}")
    tag = uuid.uuid4().hex[:6]
    sub, mh, org = await new_manufacturer(client, f"Chnnai Tools {tag}")
    await client.patch("/manufacturer/profile", headers=mh, json={
        "company": {"about": "Precision parts"}, "location": {"address": "Plot 1", "city": "Chnnai", "country": "India"}})

    # XY-ADMIN-04: search + combined filters
    body = (await client.get("/admin/manufacturers", headers=admin,
                             params={"q": tag, "completeness": "incomplete", "record_type": ["REAL"]})).json()
    assert body["total"] == 1
    row = body["rows"][0]
    assert row["companyName"] == f"Chnnai Tools {tag}" and row["reviewStatus"] == "IN_PROGRESS"
    assert row["completeness"] < 100 and "At least one certification" in row["missingFields"]
    assert row["recordType"] == "REAL" and row["entrySource"] == "MANUFACTURER"
    assert (await client.get("/admin/manufacturers", headers=admin,
                             params={"q": tag, "completeness": "complete"})).json()["total"] == 0

    # XY-ADMIN-05: one workspace
    d = (await client.get(f"/admin/manufacturers/{org}", headers=admin)).json()
    assert d["profile"]["profileData"]["location"]["city"] == "Chnnai"
    assert d["linkedUsers"][0]["email"] == f"{sub}@example.com"
    assert any(f["label"] == "At least one FAQ" and not f["done"] for f in d["requiredFields"])

    # XY-ADMIN-06: reason required, invalid input refused, previous value kept
    r = await client.patch(f"/admin/manufacturers/{org}/fields", headers=admin,
                           json={"field": "location.city", "value": "Chennai"})
    assert r.status_code == 422
    r = await client.patch(f"/admin/manufacturers/{org}/fields", headers=admin,
                           json={"field": "company.estYear", "value": "1500", "reason": "Typo fix"})
    assert r.status_code == 422 and "1700" in r.json()["detail"]
    r = await client.patch(f"/admin/manufacturers/{org}/fields", headers=admin,
                           json={"field": "location.city", "value": "", "reason": "Clear"})
    assert r.status_code == 422 and "required" in r.json()["detail"]
    r = await client.patch(f"/admin/manufacturers/{org}/fields", headers=admin,
                           json={"field": "location.city", "value": "Chennai", "reason": "Typographical correction"})
    assert r.status_code == 200, r.text
    h = r.json()["history"][0]
    assert (h["field_changed"], h["old_value"], h["new_value"], h["reason"]) == \
           ("City", "Chnnai", "Chennai", "Typographical correction")
    assert h["changed_by"] and h["created_at"]
    # the manufacturer's own profile shows the correction
    mine = (await client.get("/manufacturer/bootstrap", headers=mh)).json()
    assert mine["profileData"]["location"]["city"] == "Chennai"

    # account-level and machinery fields
    r = await client.patch(f"/admin/manufacturers/{org}/fields", headers=admin,
                           json={"field": "contact.email", "value": "not-an-email", "reason": "x fix"})
    assert r.status_code == 422
    r = await client.patch(f"/admin/manufacturers/{org}/fields", headers=admin,
                           json={"field": "account.capacity", "value": "8,000 units/month", "reason": "Confirmed by phone"})
    assert r.json()["profile"]["state"]["account"]["capacity"] == "8,000 units/month"
    m = await client.post("/manufacturer/machinery", headers=mh, json={"industry": "Auto", "type": "Lathe",
                                                                       "capacity": "10", "status": "Published"})
    mid = m.json()["state"]["machinery"][0]["id"]
    r = await client.patch(f"/admin/manufacturers/{org}/fields", headers=admin,
                           json={"field": f"machinery.{mid}.capacity", "value": "12", "reason": "Capacity confirmed"})
    assert r.status_code == 200 and r.json()["history"][0]["field_changed"] == "Machinery: Capacity"
    assert (await client.get("/manufacturer/bootstrap", headers=mh)).json()["state"]["machinery"][0]["capacity"] == "12"


async def test_review_flow_notes_assignment(client, no_clerk):
    admin_sub = f"admin_{uuid.uuid4().hex[:8]}"
    admin = await make_admin(client, admin_sub)
    admin_id = (await client.get("/admin/me", headers=admin)).json()["id"]
    tag = uuid.uuid4().hex[:6]
    _, mh, org = await new_manufacturer(client, f"Review Co {tag}")

    # queue shows the incomplete manufacturer; assign to me; note
    q = (await client.get("/admin/review-queue", headers=admin, params={"q": tag})).json()["rows"]
    assert len(q) == 1 and q[0]["stoppedAt"] == "Company details" and q[0]["lastCompletedSection"] == "Company info"
    await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=admin, json={"assigned_admin_id": admin_id})
    mine = (await client.get("/admin/review-queue", headers=admin, params={"q": tag, "assigned": "me"})).json()["rows"]
    assert len(mine) == 1 and mine[0]["assignedAdminName"]
    r = await client.post(f"/admin/manufacturers/{org}/notes", headers=admin, json={"note": "Called - will finish today"})
    assert r.status_code == 201 and r.json()["notes"][0]["note"] == "Called - will finish today"

    # Needs correction requires a reason and creates a note
    r = await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=admin,
                           json={"review_status": "NEEDS_CORRECTION"})
    assert r.status_code == 422
    r = await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=admin,
                           json={"review_status": "NEEDS_CORRECTION", "reason": "Add your ISO certificate"})
    d = r.json()
    assert d["manufacturer"]["reviewStatus"] == "NEEDS_CORRECTION"
    assert d["notes"][0]["note"].startswith("Correction requested")

    # manufacturer completes everything -> SUBMITTED automatically
    await client.patch("/manufacturer/profile", headers=mh, json={
        "company": {"about": "Parts"}, "location": {"address": "Plot 1", "city": "Pune", "country": "India"},
        "certifications": [{"name": "ISO 9001", "body": "BSI", "fileName": "", "status": "Pending"}],
        "infra": {"water": "Borewell"}, "faqs": [{"q": "MOQ?", "a": "100"}]})
    d = (await client.get(f"/admin/manufacturers/{org}", headers=admin)).json()
    assert d["manufacturer"]["reviewStatus"] == "SUBMITTED" and d["manufacturer"]["completeness"] == 100

    r = await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=admin, json={"review_status": "REVIEWED"})
    assert r.json()["manufacturer"]["reviewStatus"] == "REVIEWED"
    fields = [h["field_changed"] for h in r.json()["history"]]
    assert fields.count("Review status") == 2 and "Assigned admin" in fields


async def test_record_types_archive_and_metrics(client, no_clerk):
    admin = await make_admin(client, f"admin_{uuid.uuid4().hex[:8]}")
    tag = uuid.uuid4().hex[:6]
    _, _, real = await new_manufacturer(client, f"Real Co {tag}")
    _, _, demo = await new_manufacturer(client, f"Demo Co {tag}")
    before = (await client.get("/admin/overview", headers=admin)).json()["cards"]

    r = await client.patch(f"/admin/manufacturers/{demo}/admin-fields", headers=admin,
                           json={"record_type": "DEMO", "entry_source": "ADMIN_ASSISTED", "referral_source": "Trade fair"})
    assert r.json()["manufacturer"]["recordType"] == "DEMO"
    after = (await client.get("/admin/overview", headers=admin)).json()["cards"]
    assert after["totalManufacturers"] == before["totalManufacturers"] - 1
    assert after["testDemo"] == before["testDemo"] + 1

    # analytics exclude demo by default, include on request; referral reported
    a = (await client.get("/admin/analytics", headers=admin)).json()
    b = (await client.get("/admin/analytics", headers=admin, params={"include_test": True})).json()
    assert b["registrations"]["manufacturers"] == a["registrations"]["manufacturers"] + b["excludedDemoTest"] - 0 \
        or b["registrations"]["manufacturers"] > a["registrations"]["manufacturers"]
    assert any(x["label"] == "Trade fair" for x in b["byReferral"])
    assert not any(x["label"] == "Trade fair" for x in a["byReferral"])
    future = (await client.get("/admin/analytics", headers=admin, params={"from": "2099-01-01"})).json()
    assert future["registrations"]["manufacturers"] == 0
    assert sum(x["count"] for x in a["dropOff"][1:]) == a["onboarding"]["incomplete"]

    # batch archive skips REAL; archived hidden by default; restore
    r = (await client.post("/admin/manufacturers/archive-batch", headers=admin, json={"ids": [real, demo]})).json()
    assert r["changed"] == [demo] and r["skippedReal"] == [real]
    listed = (await client.get("/admin/manufacturers", headers=admin, params={"q": tag})).json()
    assert [x["id"] for x in listed["rows"]] == [real]
    archived = (await client.get("/admin/manufacturers", headers=admin, params={"q": tag, "archived": "archived"})).json()
    assert [x["id"] for x in archived["rows"]] == [demo]
    d = (await client.post(f"/admin/manufacturers/{demo}/restore", headers=admin, json={})).json()
    assert d["manufacturer"]["isArchived"] is False


async def test_users_suspend_and_troubleshooting(client, no_clerk):
    admin_sub = f"admin_{uuid.uuid4().hex[:8]}"
    admin = await make_admin(client, admin_sub)
    tag = uuid.uuid4().hex[:6]
    sub, mh, org = await new_manufacturer(client, f"Trouble Co {tag}")
    # a user who registered but never created a manufacturer profile
    lone = f"lone_{tag}"
    assert (await client.get("/identity/me", headers=auth(client, lone))).status_code == 200

    rows = (await client.get("/admin/users", headers=admin, params={"q": tag})).json()["rows"]
    assert {r["companyName"] for r in rows} == {f"Trouble Co {tag}", None}
    no_profile = (await client.get("/admin/users", headers=admin,
                                   params={"q": f"lone_{tag}", "onboarding_status": "NO_PROFILE"})).json()
    assert no_profile["total"] == 1 and no_profile["rows"][0]["manufacturerId"] is None
    uid = next(r["id"] for r in rows if r["companyName"])

    # a failed operation is captured with an error reference
    bad = await client.patch("/manufacturer/profile", headers=mh, json={"company": {"estYear": "1200"}})
    assert bad.status_code == 422
    detail = (await client.get(f"/admin/users/{uid}", headers=admin)).json()
    t = detail["troubleshooting"]
    assert t["accountStatus"] == "active" and t["lastLogin"]["available"]
    assert t["onboarding"]["stoppedAt"] == "Company details"
    err = t["events"][0]
    assert err["status_code"] == 422 and err["path"].endswith("/manufacturer/profile") and err["request_id"]
    text = str(detail).lower()
    assert "bearer" not in text and "token" not in text and "password" not in text

    # suspend -> the user is blocked; reactivate -> allowed again; Clerk told both times
    r = await client.post(f"/admin/users/{uid}/suspend", headers=admin, json={"reason": "Spam reports"})
    assert r.status_code == 200 and r.json()["user"]["accountStatus"] == "suspended"
    assert (await client.get("/manufacturer/bootstrap", headers=mh)).status_code == 403
    assert (await client.get("/identity/me", headers=mh)).status_code == 403
    r = await client.post(f"/admin/users/{uid}/reactivate", headers=admin, json={"reason": "Resolved"})
    assert r.json()["user"]["accountStatus"] == "active"
    assert (await client.get("/manufacturer/bootstrap", headers=mh)).status_code == 200
    assert no_clerk == [(sub, True), (sub, False)]
    kinds = [e["kind"] for e in (await client.get(f"/admin/users/{uid}", headers=admin)).json()["troubleshooting"]["events"]]
    assert kinds.count("account_status") == 2

    # admins cannot suspend themselves
    me = (await client.get("/admin/me", headers=admin)).json()["id"]
    assert (await client.post(f"/admin/users/{me}/suspend", headers=admin, json={"reason": "oops"})).status_code == 422

    # support: recent failed operations across users
    errors = (await client.get("/admin/support/recent-errors", headers=admin)).json()
    assert any(e["user_id"] == uid for e in errors)
