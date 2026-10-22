"""Admin company detail: Registered Users (memberships) and onboarding / change requests, kept apart
from each other and from the company's own contact details. Real PostgreSQL through the real
admin API (E2E_DATABASE_URL)."""
import os
import uuid

import pytest

from test_company_update_requests import _detail_request
from test_e2e_local import approve_company, client  # noqa: F401  (shared fixture)
from test_manufacturer_approval import account, hdr, own_org
from test_onboarding_source import _admin

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


def _tag():
    return uuid.uuid4().hex[:6]


async def _user_id(c, sub):
    return (await c.sql("SELECT id::text FROM users WHERE clerk_user_id=:s", s=sub))[0][0]


async def _contact(c, org):
    return tuple((await c.sql("""SELECT contact_email::text, contact_phone FROM organization_profiles
                                 WHERE organization_id=CAST(:o AS uuid)""", o=org))[0])


async def _people(c, admin, org):
    r = await c.get(f"/admin/manufacturers/{org}/people", headers=admin)
    assert r.status_code == 200, r.text
    return r.json()


async def _company(c, t, name):
    owner = f"user_ru_own_{t}"
    body = account(name, contact="contact@company.example", phone="+91 90000 33333")
    assert (await c.post("/manufacturer/account", headers=hdr(c, owner), json=body)).status_code == 201
    org = await own_org(c, owner)
    assert (await approve_company(c, org)).status_code == 200
    return owner, org


async def test_registered_users_requests_counts_and_contact(client):  # noqa: F811
    admin = await _admin(client)
    t = _tag()
    name = f"RU Works {t}"
    owner, org = await _company(client, t, name)
    contact_before = await _contact(client, org)
    # the form's email is the person's own: the company keeps no personal email as its contact
    assert contact_before == (None, "+919000033333")

    # two more users linked by membership (one active, one removed)
    member, removed = f"user_ru_mem_{t}", f"user_ru_rem_{t}"
    for sub, status in ((member, "active"), (removed, "removed")):
        assert (await client.get("/identity/me", headers=hdr(client, sub))).status_code == 200
        await client.sql("""INSERT INTO memberships (user_id, organization_id, membership_role, status, accepted_at)
                            SELECT id, CAST(:o AS uuid), 'member', :st, now() FROM users WHERE clerk_user_id=:s""",
                         o=org, st=status, s=sub)

    # three other users submit onboarding for this existing company (-> update requests)
    reqs = {}
    for label in ("pending", "approved", "rejected"):
        sub = f"user_ru_req_{label}_{t}"
        body = account(name, companyId=org, capacity=f"{len(label)}00 t", contact=f"{sub}@example.com")
        r = await client.post("/manufacturer/account", headers=hdr(client, sub), json=body)
        assert r.status_code == 201, r.text
        reqs[label] = sub
    for label, decision, feedback in (("approved", "approve", None), ("rejected", "decline", "Not verified")):
        rid = (await client.sql("""SELECT s.id::text FROM manufacturer_submissions s JOIN users u ON u.id=s.submitted_by_user_id
                                   WHERE u.clerk_user_id=:s""", s=reqs[label]))[0][0]
        _, req = await _detail_request(client, admin, org, rid)
        body = {"decision": decision, "fingerprint": req["fingerprint"], "feedback": feedback}
        if decision == "approve":
            body["fields"] = ["capacity"]  # only the capacity change, never the contact
        r = await client.post(f"/admin/manufacturers/{org}/update-requests/{rid}/decision", headers=admin, json=body)
        assert r.status_code == 200, r.text

    p = await _people(client, admin, org)
    users = p["registeredUsers"]
    ids = [u["id"] for u in users]
    # each user once: owner, member, removed member and the APPROVED applicant (now a member)
    assert len(ids) == len(set(ids)) == 4
    by_id = {u["id"]: u for u in users}
    own = by_id[await _user_id(client, owner)]
    assert (own["role"], own["membershipStatus"], own["email"]) == ("owner", "active", f"{owner}@example.com")
    assert own["linkedAt"] and own["registeredAt"] and own["name"]
    assert by_id[await _user_id(client, removed)]["membershipStatus"] == "removed"
    assert p["counts"] == {"linkedUsers": 3, "openRequests": 1,   # active members only; requests not counted
                           "confirmedUsers": 3, "pendingRequests": 1}
    approved_user = by_id[await _user_id(client, reqs["approved"])]
    assert (approved_user["role"], approved_user["membershipStatus"], approved_user["applicationStatus"]) == \
        ("member", "active", "approved")
    assert approved_user["registeredAt"] and p["primaryProposed"] is False
    # the primary user (owner) apart from the Other Users; each user once, with a personal email
    assert p["primaryUser"]["role"] == "owner" and p["primaryUser"]["email"] == f"{owner}@example.com"
    assert owner not in [u["email"].split("@")[0] for u in p["otherUsers"]]
    assert all(u.get("personalEmail") for u in p["otherUsers"])
    # requesters: listed with their real status; only an approved one became a member
    by_req = {r["requester"]["email"]: r for r in p["requests"] if r["kind"] == "update_request"}
    assert {e: (r["status"], r["statusLabel"], r["requesterIsMember"]) for e, r in by_req.items()} == {
        f"{reqs['pending']}@example.com": ("pending", "Awaiting review", False),
        f"{reqs['approved']}@example.com": ("approved", "Approved", True),
        f"{reqs['rejected']}@example.com": ("rejected", "Rejected", False)}
    assert by_req[f"{reqs['rejected']}@example.com"]["feedback"] == "Not verified"
    assert by_req[f"{reqs['approved']}@example.com"]["reviewer"]
    own_req = next(r for r in p["requests"] if r["kind"] == "new_company")
    assert own_req["status"] == "approved" and own_req["requesterIsMember"] is True
    assert p["requests"][0]["status"] == "pending"                # open requests first

    # listing and detail agree on the distinct active count
    row = next(r for r in (await client.get("/admin/manufacturers", headers=admin, params={"q": name})).json()["rows"]
               if r["id"] == org)
    assert row["linkedUsers"] == 3
    # company contact is the company's own: unchanged by sign-ups, memberships and requests
    assert await _contact(client, org) == contact_before
    assert (row["contactEmail"], row["contactPhone"]) == contact_before
    assert row["primaryUser"]["email"] == f"{owner}@example.com"   # the person, shown separately
    d = (await client.get(f"/admin/manufacturers/{org}", headers=admin)).json()
    assert ((d["contacts"]["email"] or None), d["contacts"]["phone"]) == contact_before
    # a pending or rejected requester got no access (only approval grants membership)
    for label in ("pending", "rejected"):
        assert (await client.sql("""SELECT count(*) FROM memberships m JOIN users u ON u.id=m.user_id
                                    WHERE u.clerk_user_id=:s AND m.organization_id=CAST(:o AS uuid)""",
                                 s=reqs[label], o=org))[0][0] == 0


async def test_other_company_shows_only_its_own_people_and_no_user_email_as_contact(client):  # noqa: F811
    admin = await _admin(client)
    t = _tag()
    _, first = await _company(client, t, f"RU First {t}")
    # second company: imported, no contact details, one requester (claim)
    from test_onboarding_source import _import
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as d:
        second = (await _import(Path(d), t, name=f"RU Second {t}")).inserted[0][2]
    claimer = f"user_ru_claim_{t}"
    assert (await client.post("/manufacturer/account", headers=hdr(client, claimer),
                              json=account(f"RU Second {t}", companyId=second))).status_code == 201
    p2 = await _people(client, admin, second)
    assert p2["registeredUsers"] == [] and p2["counts"] == {"linkedUsers": 0, "openRequests": 1,
                                                            "confirmedUsers": 0, "pendingRequests": 1}
    assert p2["primaryUser"] is None and len(p2["pendingRequests"]) == 1
    # the claimant is listed under this company as an applicant awaiting approval
    assert [(u["email"], u["membershipStatus"], u["applicationStatus"]) for u in p2["otherUsers"]] == [
        (f"{claimer}@example.com", "pending", "pending")]
    assert [(r["kind"], r["status"], r["requester"]["email"], r["requesterIsMember"]) for r in p2["requests"]] == [
        ("claim", "pending", f"{claimer}@example.com", False)]
    p1 = await _people(client, admin, first)
    assert claimer not in str(p1)
    row = next(r for r in (await client.get("/admin/manufacturers", headers=admin, params={"q": f"RU Second {t}"})).json()["rows"])
    assert row["contactEmail"] is None and row["contactName"] is None and row["primaryUser"] is None
    # approving the claim makes the claimant a member (the existing workflow), count follows
    assert (await approve_company(client, second)).status_code == 200
    p2 = await _people(client, admin, second)
    assert [u["email"] for u in p2["registeredUsers"]] == [f"{claimer}@example.com"]
    assert p2["counts"]["linkedUsers"] == 1 and p2["requests"][0]["requesterIsMember"] is True


async def test_people_endpoint_is_admin_only(client):  # noqa: F811
    admin = await _admin(client)
    t = _tag()
    owner, org = await _company(client, t, f"RU Private {t}")
    path = f"/admin/manufacturers/{org}/people"
    assert (await client.get(path, headers=hdr(client, owner))).status_code == 403   # even the company owner
    assert (await client.get(path, headers=hdr(client, f"user_ru_x_{t}"))).status_code == 403
    assert (await client.get(path, headers={"Authorization": ""})).status_code == 401
    assert (await client.get(f"/admin/manufacturers/{uuid.uuid4()}/people", headers=admin)).status_code == 404
    assert (await client.get("/admin/manufacturers/not-a-uuid/people", headers=admin)).status_code == 422
