"""Registering under an EXISTING company keeps the association on that company's database id, end to
end: selection -> submission -> review -> approved membership -> profile loading. The user's own
placeholder organization is never shown, reviewed, approved or searched as a company.

Real Postgres (E2E_DATABASE_URL), real HTTP endpoints."""
import os

import pytest

from test_approval_first import _access, _decide, _locked_everywhere
from test_company_update_requests import _admin, _company, _hdr, _record, _request, _tag
from test_e2e_local import approve_company, client  # noqa: F401  (shared fixture)
from test_manufacturer_approval import MACHINE, account, own_org

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


async def _workspace(c, sub):
    return str((await c.sql("""SELECT o.id FROM organizations o JOIN users u ON u.id = o.created_by_user_id
                               WHERE u.clerk_user_id = :s""", s=sub))[0][0])


async def _listed(c, admin, q):
    rows = (await c.get("/admin/manufacturers", headers=admin, params={"q": q, "listing": "all"})).json()["rows"]
    queue = (await c.get("/admin/review-queue", headers=admin, params={"q": q})).json()["rows"]
    return {r["id"] for r in rows} | {r["id"] for r in queue}


async def test_registration_under_existing_company_keeps_the_company_id_end_to_end(client):  # noqa: F811
    owner, org, name = await _company(client)          # e.g. Ashok Leyland, owned and approved
    before = await _record(client, org)
    admin = await _admin(client)
    sub = f"user_jhansi_{_tag()}"
    _, r = await _request(client, org, name, sub=sub, firstName="Jhansi", lastName="Rani",
                          contact=f"{sub}@gmail.com", phone="9800000000", capacity="10 units")
    assert r.status_code == 201, r.text
    assert r.json()["submitted"]["companyId"] == org
    ws = await _workspace(client, sub)
    # the application is stored on the selected company's id; no new company record
    row = (await client.sql("""SELECT target_organization_id::text, selected_company_id::text, kind, status
                               FROM manufacturer_submissions WHERE organization_id = CAST(:w AS uuid)""", w=ws))[0]
    assert tuple(row) == (org, org, "update_request", "pending")
    assert (await client.sql("SELECT count(*) FROM organizations WHERE display_name = :n", n=name))[0][0] == 1

    # admin portal: no standalone "Jhansi Rani" record without a company; the application is under the company
    assert ws not in await _listed(client, admin, "Jhansi")
    assert ws not in await _listed(client, admin, sub)
    assert (await client.get(f"/admin/manufacturers/{ws}", headers=admin)).status_code == 404
    r = await client.patch(f"/admin/manufacturers/{ws}/admin-fields", headers=admin, json={"review_status": "REVIEWED"})
    assert r.status_code == 404 and name in r.json()["detail"]   # cannot be approved by mistake
    assert org in await _listed(client, admin, name)
    people = (await client.get(f"/admin/manufacturers/{org}/people", headers=admin)).json()
    applicant = next(u for u in people["otherUsers"] if u["email"] == f"{sub}@example.com")
    assert (applicant["name"], applicant["personalEmail"], applicant["membershipStatus"], applicant["applicationStatus"]) == \
        ("Jhansi Rani", f"{sub}@gmail.com", "pending", "pending")
    assert people["primaryUser"]["email"] == f"{owner}@example.com" and people["counts"]["linkedUsers"] == 1
    d = (await client.get(f"/admin/manufacturers/{org}", headers=admin)).json()
    req = next(x for x in d["updateRequests"] if x["requester"]["email"] == f"{sub}@example.com")
    assert d["manufacturer"]["companyName"] == name                      # the selected company ...
    fields = {f["key"]: f["current"] for f in req["fields"]}
    assert fields["companyType"] == "Automotive & Machinery"             # ... and its saved details
    # her own search never offers her placeholder as a company
    found = (await client.get("/manufacturer/companies/search", headers=_hdr(client, sub),
                              params={"q": "Jhansi"})).json()["items"]
    assert ws not in [i["id"] for i in found]
    assert await _locked_everywhere(client, sub)

    # approve: member of the same company; owner and shared details unchanged
    r = await _decide(client, admin, org, req["id"], "approve", fields=[])
    assert r.status_code == 200, r.text
    assert await _record(client, org) == before
    roles = dict(await client.sql("""SELECT u.clerk_user_id, m.membership_role FROM memberships m JOIN users u ON u.id = m.user_id
                                     WHERE m.organization_id = CAST(:o AS uuid) AND m.status = 'active'""", o=org))
    assert roles == {owner: "owner", sub: "member"}
    # profile loading: her dashboard is that company, with its saved details (nothing re-entered)
    boot = (await client.get("/manufacturer/bootstrap", headers=_hdr(client, sub))).json()
    assert boot["state"]["account"]["companyName"] == name
    assert boot["state"]["account"]["companyType"] == "Automotive & Machinery"
    assert boot["approval"]["access"]["unlocked"] and boot["approval"]["access"]["role"] == "member"
    assert (await client.post("/manufacturer/machinery", headers=_hdr(client, sub), json=MACHINE)).status_code == 201
    assert (await client.sql("SELECT organization_id::text FROM machines WHERE name = :n ORDER BY created_at DESC LIMIT 1",
                             n=MACHINE["type"]))[0][0] == org
    people = (await client.get(f"/admin/manufacturers/{org}/people", headers=admin)).json()
    me = next(u for u in people["otherUsers"] if u["email"] == f"{sub}@example.com")
    assert (me["role"], me["membershipStatus"], me["applicationStatus"]) == ("member", "active", "approved")
    users = (await client.get("/admin/users", headers=admin, params={"q": sub})).json()["rows"]
    assert [c["name"] for c in users[0]["companies"]] == [name]          # her company is the existing one
    assert ws not in await _listed(client, admin, "Jhansi")


async def test_placeholder_approved_by_mistake_does_not_unlock(client):  # noqa: F811
    owner, org, name = await _company(client)
    sub = f"user_mis_{_tag()}"
    _, r = await _request(client, org, name, sub=sub, phone="9800000000", capacity="10 units")
    assert r.status_code == 201
    ws = await _workspace(client, sub)
    # data from before this fix: the placeholder itself was approved in the admin portal
    await client.sql("UPDATE manufacturer_onboarding SET status = 'approved' WHERE organization_id = CAST(:w AS uuid)", w=ws)
    acc = await _access(client, sub)
    assert acc["unlocked"] is False and acc["status"] == "pending"
    assert await _locked_everywhere(client, sub)


async def test_new_company_is_shown_with_its_submitted_details_and_is_real(client):  # noqa: F811
    t, sub = _tag(), f"user_newco_{_tag()}"
    assert (await client.post("/manufacturer/account", headers=_hdr(client, sub),
                              json=account(f"Jhansi Fabrications {t}"))).status_code == 201
    org = await own_org(client, sub)
    admin = await _admin(client)
    rows = (await client.get("/admin/review-queue", headers=admin, params={"q": t})).json()["rows"]
    assert [(r["id"], r["companyName"], r["reviewStatus"], r["recordType"]) for r in rows] == [
        (org, f"Jhansi Fabrications {t}", "SUBMITTED", "REAL")]
    d = (await client.get(f"/admin/manufacturers/{org}", headers=admin)).json()["pendingSubmission"]
    assert {f["key"]: f["submitted"] for f in d["fields"]}["companyType"] == "Automotive & Machinery"
    assert await _locked_everywhere(client, sub)
    assert (await approve_company(client, org)).status_code == 200
    boot = (await client.get("/manufacturer/bootstrap", headers=_hdr(client, sub))).json()
    assert boot["state"]["account"]["companyName"] == f"Jhansi Fabrications {t}" and boot["approval"]["access"]["unlocked"]
    roles = await client.sql("""SELECT m.membership_role FROM memberships m JOIN users u ON u.id = m.user_id
                                WHERE m.organization_id = CAST(:o AS uuid) AND u.clerk_user_id = :s""", o=org, s=sub)
    assert [r[0] for r in roles] == ["owner"]
