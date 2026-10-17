"""Admin-reviewed update requests for a company managed by someone else (real Postgres).

Run with E2E_DATABASE_URL set (see test_e2e_local.py)."""
import asyncio
import os
import uuid

import pytest

from test_e2e_local import approve_company, client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")

ACCOUNT = {"firstName": "Jo", "lastName": "Owner", "contact": "owner@example.com", "dob": "1990-01-01",
           "companyType": "Automotive & Machinery", "country": "India", "phone": "9800000000",
           "capacity": "10 units"}


def _tag() -> str:
    return uuid.uuid4().hex[:6]


def _hdr(c, sub):
    return {"Authorization": f"Bearer {c.token_for(sub)}"}


async def _company(c):
    """An owner's company, approved by X!Y (like Ashok Leyland already registered by one user)."""
    t = _tag()
    owner = f"user_own_{t}"
    name = f"Ashok Leyland {t} Limited"
    r = await c.post("/manufacturer/account", headers=_hdr(c, owner), json={**ACCOUNT, "companyName": name})
    assert r.status_code == 201, r.text
    org = (await c.sql("""SELECT o.id FROM organizations o JOIN memberships m ON m.organization_id=o.id
                          JOIN users u ON u.id=m.user_id WHERE u.clerk_user_id=:c""", c=owner))[0][0]
    assert (await approve_company(c, str(org))).status_code == 200
    return owner, str(org), name


async def _admin(c):
    admin = f"admin_{_tag()}"
    hdr = _hdr(c, admin)
    assert (await c.get("/identity/me", headers=hdr)).status_code == 200
    await c.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                   SELECT id, 'platform_administrator' FROM users WHERE clerk_user_id=:s""", s=admin)
    return hdr


async def _request(c, org, name, sub=None, **values):
    sub = sub or f"user_req_{_tag()}"
    body = {**ACCOUNT, "firstName": "Ravi", "lastName": "Kumar", "contact": "ravi@example.com",
            "companyName": name, "companyId": org, "phone": "9741235478", "capacity": "7800", **values}
    r = await c.post("/manufacturer/account", headers=_hdr(c, sub), json=body)
    return sub, r


async def _record(c, org):
    return (await c.sql("""
        SELECT o.id, o.display_name, o.entry_source, op.company_category, op.country_name, op.production_capacity_label,
               op.stated_production_capacity, op.contact_email::text, op.contact_phone, mo.status
        FROM organizations o LEFT JOIN organization_profiles op ON op.organization_id=o.id
        LEFT JOIN manufacturer_onboarding mo ON mo.organization_id=o.id WHERE o.id=CAST(:o AS uuid)""", o=org))[0]


async def _members(c, org):
    return sorted(r[0] for r in await c.sql("""
        SELECT u.clerk_user_id FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.organization_id=CAST(:o AS uuid) AND m.status='active'""", o=org))


async def _detail_request(c, admin, org, request_id=None):
    d = (await c.get(f"/admin/manufacturers/{org}", headers=admin)).json()
    reqs = d["updateRequests"]
    return d, (next(r for r in reqs if r["id"] == request_id) if request_id else reqs[0])


# ---------------------------------------------------------------- submission
async def test_second_user_submits_update_request_and_company_stays_unchanged(client):  # noqa: F811
    owner, org, name = await _company(client)
    before, owners_before = await _record(client, org), await _members(client, org)
    orgs_before = (await client.sql("SELECT count(*) FROM organizations WHERE NOT is_archived"))[0][0]

    sub, r = await _request(client, org, name)
    assert r.status_code == 201, r.text
    assert r.json()["submitted"]["kind"] == "update_request" and r.json()["submitted"]["companyId"] == org

    row = (await client.sql("""
        SELECT s.kind, s.target_organization_id::text, u.clerk_user_id, s.source, s.status, s.payload->>'capacity',
               s.base_snapshot->>'capacity', s.created_at IS NOT NULL
        FROM manufacturer_submissions s JOIN users u ON u.id=s.submitted_by_user_id
        WHERE s.target_organization_id=CAST(:o AS uuid) AND s.kind='update_request'""", o=org))
    assert [tuple(x) for x in row] == [("update_request", org, sub, "web_dashboard", "pending", "7800",
                                        "10 units", True)]
    # nothing on the company changed; no ownership / membership; no duplicate company
    assert await _record(client, org) == before
    assert await _members(client, org) == owners_before == [owner]
    # (the requester's own workspace is theirs, not a new company record)
    assert (await client.sql("SELECT count(*) FROM organizations WHERE NOT is_archived"))[0][0] <= orgs_before + 1

    # requester sees status of their own request, not the company's private data
    boot = (await client.get("/manufacturer/bootstrap", headers=_hdr(client, sub))).json()
    mine = boot["approval"]["updateRequests"]
    assert len(mine) == 1 and mine[0]["status"] == "pending" and mine[0]["companyName"] == name
    assert mine[0]["proposed"]["capacity"] == "7800"
    assert set(mine[0]) == {"id", "status", "companyId", "companyName", "proposed", "feedback", "submittedAt",
                            "updatedAt", "reviewedAt"}
    assert "9800000000" not in str(boot) and "owner@example.com" not in str(boot)
    # the owner's view is unaffected
    own = (await client.get("/manufacturer/bootstrap", headers=_hdr(client, owner))).json()
    assert own["approval"]["updateRequests"] == [] and own["approval"]["status"] == "approved"

    # retry -> same row, refreshed; identical data -> nothing to review
    _, r = await _request(client, org, name, sub=sub, capacity="8000")
    assert r.status_code == 201, r.text
    rows = await client.sql("""SELECT status, payload->>'capacity' FROM manufacturer_submissions
                               WHERE target_organization_id=CAST(:o AS uuid) AND kind='update_request'""", o=org)
    assert [tuple(x) for x in rows] == [("pending", "8000")]
    events = [e[0] for e in await client.sql("""
        SELECT e.event FROM manufacturer_submission_events e JOIN manufacturer_submissions s ON s.id=e.submission_id
        WHERE s.target_organization_id=CAST(:o AS uuid) AND s.kind='update_request'
        ORDER BY e.created_at""", o=org)]  # (the owner's own submission has its own history since 020)
    assert events == ["submitted", "resubmitted"]
    _, same = await _request(client, org, name, contact="owner@example.com", phone="9800000000",
                             capacity="10 units")
    # registering under the company with its saved (read-only) details is still recorded for review
    assert same.status_code == 201, same.text

    # shown in the admin dashboard review queue
    admin = await _admin(client)
    queue = (await client.get("/admin/review-queue", headers=admin)).json()["rows"]
    assert any(x["id"] == org and x["reviewStatus"] == "SUBMITTED" for x in queue)


# ---------------------------------------------------------------- review and approval
async def test_admin_edits_notes_and_approves_only_chosen_fields(client):  # noqa: F811
    owner, org, name = await _company(client)
    before = await _record(client, org)
    sub, r = await _request(client, org, name, companyType="Other")
    request_id = r.json()["submitted"]["requestId"]
    admin = await _admin(client)

    d, req = await _detail_request(client, admin, org, request_id)
    assert d["pendingSubmission"] is None  # not mistaken for the company's own submission
    fields = {f["key"]: f for f in req["fields"]}
    assert fields["capacity"]["current"] == "10 units" and fields["capacity"]["proposed"] == "7800"
    assert fields["companyType"]["differs"] and not fields["companyName"]["differs"]
    assert req["requester"]["email"] == f"{sub}@example.com" and req["source"] == "web_dashboard"

    r = await client.patch(f"/admin/manufacturers/{org}/update-requests/{request_id}", headers=admin,
                           json={"values": {"capacity": "7,800 units/month"}, "notes": "Called the plant: confirmed."})
    assert r.status_code == 200, r.text
    req = next(x for x in r.json()["updateRequests"] if x["id"] == request_id)
    cap = next(f for f in req["fields"] if f["key"] == "capacity")
    assert cap["proposed"] == "7,800 units/month" and cap["submitted"] == "7800" and cap["edited"]
    assert req["adminNotes"] == "Called the plant: confirmed."

    r = await client.post(f"/admin/manufacturers/{org}/update-requests/{request_id}/decision", headers=admin,
                          json={"decision": "approve", "fields": ["capacity", "contactPhone"],
                                "fingerprint": req["fingerprint"], "feedback": "Thanks"})
    assert r.status_code == 200, r.text
    after = await _record(client, org)
    # only the chosen fields; same id, name, source, category, email and approval status
    assert after[5] == "7,800 units/month" and float(after[6]) == 7800 and after[8] == "+919741235478"
    assert (after[0], after[1], after[2], after[3], after[4], after[7], after[9]) == \
           (before[0], before[1], before[2], before[3], before[4], before[7], "approved")
    # the approved applicant is now a MEMBER of the company - never its owner
    assert await _members(client, org) == sorted([owner, sub])
    roles = dict(await client.sql("""SELECT u.clerk_user_id, m.membership_role FROM memberships m
                                     JOIN users u ON u.id = m.user_id
                                     WHERE m.organization_id = CAST(:o AS uuid) AND m.status = 'active'""", o=org))
    assert roles == {owner: "owner", sub: "member"}

    stored = (await client.sql("""SELECT status, applied_changes, reviewed_by_user_id IS NOT NULL, reviewed_at IS NOT NULL,
                                         applied_at IS NOT NULL, review_feedback
                                  FROM manufacturer_submissions WHERE id=CAST(:i AS uuid)""", i=request_id))[0]
    assert stored[0] == "approved" and stored[1] == {
        "capacity": {"from": "10 units", "to": "7,800 units/month"},  # phones are stored as +91XXXXXXXXXX
        "contactPhone": {"from": "+919800000000", "to": "+919741235478"}} and all(stored[2:5]) and stored[5] == "Thanks"
    history = await client.sql("""SELECT field_changed, old_value, new_value, reason FROM admin_change_history
                                  WHERE manufacturer_id=CAST(:o AS uuid) AND reason LIKE 'Approved update request%'
                                  ORDER BY field_changed""", o=org)
    assert [(h[0], h[1], h[2]) for h in history] == [("Contact phone", "+919800000000", "+919741235478"),
                                                     ("Production capacity", "10 units", "7,800 units/month")]
    assert "Ravi Kumar" in history[0][3]
    d, req = await _detail_request(client, admin, org, request_id)
    assert [e["event"] for e in req["events"]] == ["submitted", "edited", "note", "decision"]
    assert req["events"][-1]["details"]["decision"] == "approved" and req["reviewedBy"]

    # processed exactly once
    again = await client.post(f"/admin/manufacturers/{org}/update-requests/{request_id}/decision", headers=admin,
                              json={"decision": "approve", "fingerprint": "0" * 32})
    assert again.status_code == 409 and "already decided" in again.json()["detail"]

    # requester: status + feedback and a notification; approved membership opens the company to them
    # (as a member: machinery / availability / bookings, not the owner's shared company profile)
    boot = (await client.get("/manufacturer/bootstrap", headers=_hdr(client, sub))).json()
    assert boot["approval"]["updateRequests"][0]["status"] == "approved"
    acc = boot["approval"]["access"]
    assert acc["unlocked"] and acc["role"] == "member" and not acc["canEditProfile"]
    notes = (await client.get("/manufacturer/notifications", headers=_hdr(client, sub))).json()
    assert any("has been approved" in n["title"] for n in notes["items"])
    r = await client.patch("/manufacturer/profile", headers=_hdr(client, sub), json={"company": {"about": "x"}})
    assert r.status_code == 403 and "primary user" in r.text
    seen = (await client.get(f"/manufacturer/companies/{org}", headers=_hdr(client, sub))).json()
    # the company's own phone (business information) is shown read-only
    assert seen["access"] == "claimed" and seen["canUpdate"] is False and seen["phone"] == "+919741235478"
    assert boot["state"]["account"]["companyName"] == name  # their dashboard is now this company


async def test_decline_and_corrections_keep_record_unchanged(client):  # noqa: F811
    owner, org, name = await _company(client)
    before = await _record(client, org)
    admin = await _admin(client)
    sub1, r1 = await _request(client, org, name)
    sub2, r2 = await _request(client, org, name, capacity="99")
    id1, id2 = r1.json()["submitted"]["requestId"], r2.json()["submitted"]["requestId"]
    assert id1 != id2  # different requesters: separate requests

    _, req1 = await _detail_request(client, admin, org, id1)
    url1 = f"/admin/manufacturers/{org}/update-requests/{id1}/decision"
    r = await client.post(url1, headers=admin, json={"decision": "decline", "fingerprint": req1["fingerprint"]})
    assert r.status_code == 422  # feedback required
    r = await client.post(url1, headers=admin, json={"decision": "decline", "fingerprint": req1["fingerprint"],
                                                     "feedback": "We could not verify you work for this company."})
    assert r.status_code == 200, r.text
    assert await _record(client, org) == before
    boot = (await client.get("/manufacturer/bootstrap", headers=_hdr(client, sub1))).json()
    assert boot["approval"]["updateRequests"][0]["status"] == "rejected"
    assert boot["approval"]["updateRequests"][0]["feedback"] == "We could not verify you work for this company."

    _, req2 = await _detail_request(client, admin, org, id2)
    r = await client.post(f"/admin/manufacturers/{org}/update-requests/{id2}/decision", headers=admin,
                          json={"decision": "request_changes", "fingerprint": req2["fingerprint"],
                                "feedback": "Please give the capacity with units."})
    assert r.status_code == 422 and "Choose the fields" in r.text  # the exact fields are required
    r = await client.post(f"/admin/manufacturers/{org}/update-requests/{id2}/decision", headers=admin,
                          json={"decision": "request_changes", "fingerprint": req2["fingerprint"],
                                "feedback": "Please give the capacity with units.", "correction_fields": ["capacity"]})
    assert r.status_code == 200, r.text
    assert await _record(client, org) == before
    # the company itself is not marked "Needs correction" (the requester has to act)
    status = (await client.sql("SELECT review_status FROM admin_manufacturer_overview WHERE organization_id=CAST(:o AS uuid)",
                               o=org))[0][0]
    assert status == "REVIEWED"
    _, again = await _request(client, org, name, sub=sub2, capacity="99 t/month")
    assert again.status_code == 201 and again.json()["submitted"]["requestId"] == id2  # same request, pending again
    _, req2 = await _detail_request(client, admin, org, id2)
    assert req2["status"] == "pending"


# ---------------------------------------------------------------- concurrency
async def test_stale_reviews_and_concurrent_approvals(client):  # noqa: F811
    owner, org, name = await _company(client)
    admin = await _admin(client)
    sub, r = await _request(client, org, name)
    request_id = r.json()["submitted"]["requestId"]
    url = f"/admin/manufacturers/{org}/update-requests/{request_id}/decision"
    _, seen = await _detail_request(client, admin, org, request_id)

    # the company changes meanwhile (an admin corrects the owner's record)
    r = await client.patch(f"/admin/manufacturers/{org}/fields", headers=admin,
                           json={"field": "account.capacity", "value": "12 units", "reason": "Owner called"})
    assert r.status_code == 200, r.text
    r = await client.post(url, headers=admin, json={"decision": "approve", "fingerprint": seen["fingerprint"]})
    assert r.status_code == 409 and "changed after you opened it" in r.json()["detail"]
    assert (await _record(client, org))[5] == "12 units"  # the newer value was not overwritten

    _, latest = await _detail_request(client, admin, org, request_id)
    cap = next(f for f in latest["fields"] if f["key"] == "capacity")
    assert cap["companyChanged"] and cap["atSubmission"] == "10 units" and cap["current"] == "12 units"

    # the requester resubmits while the admin reviews -> the admin must look again
    await _request(client, org, name, sub=sub, capacity="7900")
    r = await client.post(url, headers=admin, json={"decision": "approve", "fingerprint": latest["fingerprint"]})
    assert r.status_code == 409

    # two admins approving at the same moment: applied once
    _, latest = await _detail_request(client, admin, org, request_id)
    admin2 = await _admin(client)
    body = {"decision": "approve", "fields": ["capacity"], "fingerprint": latest["fingerprint"]}
    results = await asyncio.gather(client.post(url, headers=admin, json=body), client.post(url, headers=admin2, json=body))
    assert sorted(x.status_code for x in results) == [200, 409]
    assert (await _record(client, org))[5] == "7900"
    applied = await client.sql("""SELECT count(*) FROM admin_change_history WHERE manufacturer_id=CAST(:o AS uuid)
                                  AND reason LIKE 'Approved update request%'""", o=org)
    assert applied[0][0] == 1
    assert (await client.sql("""SELECT count(*) FROM manufacturer_submissions WHERE target_organization_id=CAST(:o AS uuid)
                                AND kind='update_request'""", o=org))[0][0] == 1


async def test_name_change_cannot_duplicate_another_approved_company(client):  # noqa: F811
    _, org_a, name_a = await _company(client)
    _, org_b, name_b = await _company(client)
    admin = await _admin(client)
    _, r = await _request(client, org_b, name_b)
    request_id = r.json()["submitted"]["requestId"]
    await client.patch(f"/admin/manufacturers/{org_b}/update-requests/{request_id}", headers=admin,
                       json={"values": {"companyName": name_a.upper()}})
    _, req = await _detail_request(client, admin, org_b, request_id)
    r = await client.post(f"/admin/manufacturers/{org_b}/update-requests/{request_id}/decision", headers=admin,
                          json={"decision": "approve", "fields": ["companyName"], "fingerprint": req["fingerprint"]})
    assert r.status_code == 409 and "already has this name" in r.json()["detail"]
    assert (await _record(client, org_b))[1] == name_b


# ---------------------------------------------------------------- authorization
async def test_only_admins_review_and_requests_stay_private(client):  # noqa: F811
    owner, org, name = await _company(client)
    sub, r = await _request(client, org, name)
    request_id = r.json()["submitted"]["requestId"]
    base = f"/admin/manufacturers/{org}/update-requests/{request_id}"
    for who in (sub, owner, f"user_x_{_tag()}"):
        hdr = _hdr(client, who)
        assert (await client.post(f"{base}/decision", headers=hdr,
                                  json={"decision": "approve", "fingerprint": "x" * 32})).status_code in (401, 403)
        assert (await client.patch(base, headers=hdr, json={"notes": "x"})).status_code in (401, 403)
        assert (await client.get(f"/admin/manufacturers/{org}", headers=hdr)).status_code in (401, 403)
    # another user's dashboard never lists it
    other = (await client.get("/manufacturer/bootstrap", headers=_hdr(client, f"user_y_{_tag()}"))).json()
    assert other["approval"]["updateRequests"] == []
    # a request can only be reached through its own company
    admin = await _admin(client)
    _, other_org, _ = await _company(client)
    r = await client.patch(f"/admin/manufacturers/{other_org}/update-requests/{request_id}", headers=admin,
                           json={"notes": "x"})
    assert r.status_code == 404
    # admin notes stay internal
    await client.patch(base, headers=admin, json={"notes": "Internal: phoned HR"})
    boot = (await client.get("/manufacturer/bootstrap", headers=_hdr(client, sub))).json()
    assert "phoned HR" not in str(boot)
    assert (await client.sql("SELECT status FROM manufacturer_submissions WHERE id=CAST(:i AS uuid)",
                             i=request_id))[0][0] == "pending"
