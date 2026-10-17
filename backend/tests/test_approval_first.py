"""Approval-first manufacturer onboarding (app/manufacturer_access.py): the validation scenarios.

Real Postgres (E2E_DATABASE_URL), real HTTP endpoints, decisions through the real admin API."""
import os
import uuid

import pytest

from test_company_update_requests import ACCOUNT, _admin, _company, _detail_request, _hdr, _record, _request, _tag
from test_email import outbox  # noqa: F401  (fixture: captured email)
from test_e2e_local import approve_company, client  # noqa: F401  (shared fixture)
from test_manufacturer_approval import MACHINE, PROFILE, account, complete_profile, own_org, visible

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


async def _access(c, sub):
    return (await c.get("/manufacturer/bootstrap", headers=_hdr(c, sub))).json()["approval"]["access"]


async def _locked_everywhere(c, sub) -> bool:
    h = _hdr(c, sub)
    codes = [(await c.patch("/manufacturer/profile", headers=h, json=PROFILE)).status_code,
             (await c.put("/manufacturer/profile", headers=h, json={"company": {}, "location": {}})).status_code,
             (await c.post("/manufacturer/machinery", headers=h, json=MACHINE)).status_code,
             (await c.post("/manufacturer/machinery/drafts", headers=h, json={"clientKey": str(uuid.uuid4())})).status_code,
             (await c.patch("/manufacturer/availability", headers=h, json={"calendar": {"2026-12-01": "blocked"}})).status_code]
    assert codes == [403] * 5, codes
    return True


async def _decide(c, admin, org, rid, decision, **body):
    _, req = await _detail_request(c, admin, org, rid)
    r = await c.post(f"/admin/manufacturers/{org}/update-requests/{rid}/decision", headers=admin,
                     json={"decision": decision, "fingerprint": req["fingerprint"], **body})
    return r


# ---------------------------------------------------------------- new company
async def test_new_company_pending_then_approved_unlocks_and_restores_details(client, outbox):  # noqa: F811
    t, sub = _tag(), f"user_af1_{_tag()}"
    h = _hdr(client, sub)
    admin = await _admin(client)
    # date of birth is optional
    body = {k: v for k, v in account(f"Nova Cast {t}").items() if k != "dob"}
    r = await client.post("/manufacturer/account", headers=h, json=body)
    assert r.status_code == 201, r.text
    org = await own_org(client, sub)
    acc = r.json()["approval"]["access"]
    assert (acc["unlocked"], acc["status"], acc["message"]) == (
        False, "pending", "Your manufacturer application is awaiting admin approval.")
    assert r.json()["state"]["account"]["dob"] == ""
    assert await _locked_everywhere(client, sub)
    # the admins were told (email to every active admin; delivery logged)
    r = await client.post("/manufacturer/account", headers=h, json=body)  # retry: no new application
    assert len(await client.sql("SELECT 1 FROM manufacturer_submissions WHERE target_organization_id=CAST(:o AS uuid)",
                                o=org)) == 1
    admin_email = (await client.sql("""SELECT u.email::text FROM users u JOIN platform_role_assignments p
                                       ON p.user_id = u.id ORDER BY u.created_at DESC LIMIT 1"""))[0][0]
    mine = [m["Subject"] for m in outbox.to(admin_email)]
    assert f"New manufacturer application: Nova Cast {t}" in mine, mine

    # approval: reviewer + time recorded, applicant notified, sections unlocked, details kept
    r = await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=admin, json={"review_status": "REVIEWED"})
    assert r.status_code == 200, r.text
    row = (await client.sql("""SELECT status, reviewed_by_user_id IS NOT NULL, reviewed_at IS NOT NULL
                               FROM manufacturer_submissions WHERE target_organization_id=CAST(:o AS uuid)""", o=org))[0]
    assert tuple(row) == ("approved", True, True)
    boot = (await client.get("/manufacturer/bootstrap", headers=h)).json()
    assert boot["approval"]["access"]["unlocked"] and boot["approval"]["access"]["canEditProfile"]
    assert boot["state"]["account"]["companyName"] == f"Nova Cast {t}"  # no re-entry needed
    notes = (await client.get("/manufacturer/notifications", headers=h)).json()["items"]
    assert any(n["title"] == "Your manufacturer application has been approved" for n in notes)
    # the first registering user is the primary owner (proposed until approval, confirmed now)
    people = (await client.get(f"/admin/manufacturers/{org}/people", headers=admin)).json()
    assert people["primaryUser"]["role"] == "owner" and people["primaryProposed"] is False
    await complete_profile(client, h)
    # approved AND 100% complete (date of birth not needed) -> visible to Visionaries
    d = (await client.get(f"/admin/manufacturers/{org}", headers=admin)).json()["manufacturer"]
    assert (d["completeness"], d["requiredTotal"]) == (100, 13)
    assert await visible(client, org)


async def test_pending_new_company_shows_proposed_owner(client):  # noqa: F811
    sub = f"user_af2_{_tag()}"
    assert (await client.post("/manufacturer/account", headers=_hdr(client, sub),
                              json=account(f"Prop Owner {_tag()}"))).status_code == 201
    org = await own_org(client, sub)
    admin = await _admin(client)
    people = (await client.get(f"/admin/manufacturers/{org}/people", headers=admin)).json()
    assert people["primaryProposed"] is True and people["primaryUser"]["applicationStatus"] == "pending"


# ---------------------------------------------------------------- existing company (join)
async def test_existing_company_application_pending_then_member_shared_record_and_owner_intact(client):  # noqa: F811
    owner, org, name = await _company(client)
    before = await _record(client, org)
    admin = await _admin(client)
    # two applicants select the same company with its saved (read-only) details
    subs = []
    for _ in range(2):
        sub, r = await _request(client, org, name, phone="9800000000", capacity="10 units", dob=None)
        assert r.status_code == 201, r.text
        assert r.json()["approval"]["access"]["status"] == "pending"
        assert await _locked_everywhere(client, sub)
        subs.append((sub, r.json()["submitted"]["requestId"]))
    # one company record, unchanged; no access, no ownership before approval
    assert await _record(client, org) == before
    assert (await client.sql("SELECT count(*) FROM organizations WHERE display_name=:n AND NOT is_archived",
                             n=name))[0][0] == 1
    members = await client.sql("""SELECT u.clerk_user_id, m.membership_role FROM memberships m JOIN users u ON u.id=m.user_id
                                  WHERE m.organization_id=CAST(:o AS uuid) AND m.status='active'""", o=org)
    assert [tuple(m) for m in members] == [(owner, "owner")]
    # public company search never shows associated users' personal details
    found = (await client.get("/manufacturer/companies/search", headers=_hdr(client, subs[0][0]),
                              params={"q": name})).json()["items"]
    assert "ravi@example.com" not in str(found) and "Ravi" not in str(found)

    # approve the first (no field changes): membership, never ownership; the owner keeps ownership
    r = await _decide(client, admin, org, subs[0][1], "approve", fields=[])
    assert r.status_code == 200, r.text
    roles = dict(await client.sql("""SELECT u.clerk_user_id, m.membership_role FROM memberships m JOIN users u ON u.id=m.user_id
                                     WHERE m.organization_id=CAST(:o AS uuid) AND m.status='active'""", o=org))
    assert roles == {owner: "owner", subs[0][0]: "member"}
    assert await _record(client, org) == before  # shared details unchanged
    acc = await _access(client, subs[0][0])
    assert acc["unlocked"] and acc["role"] == "member" and not acc["canEditProfile"]
    h1 = _hdr(client, subs[0][0])
    assert (await client.post("/manufacturer/machinery", headers=h1, json=MACHINE)).status_code == 201
    assert (await client.patch("/manufacturer/profile", headers=h1, json=PROFILE)).status_code == 403
    # the other applicant is still pending and locked
    assert (await _access(client, subs[1][0]))["status"] == "pending"
    assert await _locked_everywhere(client, subs[1][0])


async def test_join_rejection_public_reason_private_notes_and_24_hours(client, outbox):  # noqa: F811
    owner, org, name = await _company(client)
    admin = await _admin(client)
    sub, r = await _request(client, org, name, phone="9800000000", capacity="10 units")
    rid = r.json()["submitted"]["requestId"]
    # internal note (private) and an applicant-facing rejection reason (required)
    assert (await client.patch(f"/admin/manufacturers/{org}/update-requests/{rid}", headers=admin,
                               json={"notes": "HR said: not an employee"})).status_code == 200
    assert (await _decide(client, admin, org, rid, "decline")).status_code == 422
    assert (await _decide(client, admin, org, rid, "decline", feedback="We could not confirm you work here.")).status_code == 200
    acc = await _access(client, sub)
    assert acc["status"] == "rejected" and acc["application"]["feedback"] == "We could not confirm you work here."
    assert acc["reapplyAt"] and not acc["canReapply"] and "apply again from" in acc["message"]
    boot = (await client.get("/manufacturer/bootstrap", headers=_hdr(client, sub))).json()
    notes = (await client.get("/manufacturer/notifications", headers=_hdr(client, sub))).json()
    assert "HR said" not in str(boot) and "HR said" not in str(notes)
    assert any("was not approved" in n["title"] for n in notes["items"])
    assert any(m["Subject"].startswith("Your manufacturer application for") for m in outbox)
    assert await _locked_everywhere(client, sub)
    # a fresh application only after 24 hours; the rejected one and its history stay
    sub2, r = await _request(client, org, name, sub=sub, phone="9800000000", capacity="10 units")
    assert r.status_code == 409 and "apply again from" in r.json()["detail"]
    await client.sql("UPDATE manufacturer_submissions SET reviewed_at = now() - interval '25 hours' WHERE id=CAST(:i AS uuid)",
                     i=rid)
    _, r = await _request(client, org, name, sub=sub, phone="9800000000", capacity="10 units")
    assert r.status_code == 201, r.text
    rows = await client.sql("""SELECT s.status FROM manufacturer_submissions s JOIN users u ON u.id=s.submitted_by_user_id
                               WHERE u.clerk_user_id=:s ORDER BY s.created_at""", s=sub)
    assert [x[0] for x in rows] == ["rejected", "pending"]


async def test_join_corrections_allow_only_the_listed_fields(client):  # noqa: F811
    owner, org, name = await _company(client)
    admin = await _admin(client)
    sub, r = await _request(client, org, name, phone="9800000000", capacity="10 units")
    rid = r.json()["submitted"]["requestId"]
    r = await _decide(client, admin, org, rid, "request_changes", feedback="Use your work email.",
                      correction_fields=["personalEmail"])
    assert r.status_code == 200, r.text
    req = next(x for x in r.json()["updateRequests"] if x["id"] == rid)
    assert req["correctionFields"] == ["personalEmail"] and req["applicant"]["personalEmail"] == "ravi@example.com"
    acc = await _access(client, sub)
    assert acc["status"] == "changes_requested" and acc["application"]["correctionFields"] == ["personalEmail"]
    assert await _locked_everywhere(client, sub)
    # a field not listed cannot change
    _, r = await _request(client, org, name, sub=sub, phone="9800000000", capacity="10 units", lastName="Other")
    assert r.status_code == 422 and "Not open for correction: Last name" in r.text
    # the listed one can; resubmission returns to pending and does not unlock
    _, r = await _request(client, org, name, sub=sub, phone="9800000000", capacity="10 units",
                          contact="ravi@ashok.example.com")
    assert r.status_code == 201, r.text
    assert (await _access(client, sub))["status"] == "pending"
    assert await _locked_everywhere(client, sub)
    _, req = await _detail_request(client, admin, org, rid)
    assert req["status"] == "pending" and req["applicant"]["personalEmail"] == "ravi@ashok.example.com"


async def test_new_company_corrections_show_admin_the_changed_fields(client):  # noqa: F811
    t, sub = _tag(), f"user_af5_{_tag()}"
    h = _hdr(client, sub)
    assert (await client.post("/manufacturer/account", headers=h, json=account(f"Fix Forge {t}"))).status_code == 201
    org = await own_org(client, sub)
    admin = await _admin(client)
    r = await approve_company(client, org, decision="NEEDS_CORRECTION", reason="Capacity per month, please",
                              correction_fields=["capacity", "dob"])
    assert r.status_code == 200, r.text
    assert (await approve_company(client, org, decision="NEEDS_CORRECTION", reason="x",
                                  correction_fields=["notAField"])).status_code == 422
    r = await client.post("/manufacturer/account", headers=h, json=account(f"Fix Forge {t}", capacity="900 t/month",
                                                                          dob=None))
    assert r.status_code == 201, r.text
    d = (await client.get(f"/admin/manufacturers/{org}", headers=admin)).json()["pendingSubmission"]
    changed = {f["key"]: (f["previous"], f["submitted"]) for f in d["fields"] if f["changed"]}
    assert changed == {"capacity": ("500 units/month", "900 t/month")}
    assert [(a["key"], a["previous"], a["submitted"]) for a in d["applicant"] if a["changed"]] == [
        ("dob", "1990-02-02", "")]


async def test_pending_join_application_never_hides_an_approved_complete_company(client):  # noqa: F811
    owner, org, name = await _company(client)
    await complete_profile(client, _hdr(client, owner))
    assert await visible(client, org)
    _, r = await _request(client, org, name, phone="9800000000", capacity="10 units")
    assert r.status_code == 201
    assert await visible(client, org)  # still visible while the applicant waits


async def test_member_cannot_bypass_with_direct_calls_before_details(client):  # noqa: F811
    sub = f"fresh_{_tag()}"
    h = _hdr(client, sub)
    assert (await client.patch("/manufacturer/profile", headers=h, json={"company": {"about": "x"}})).status_code == 403
    assert (await client.post("/manufacturer/machinery", headers=h, json=MACHINE)).status_code == 403
    acc = await _access(client, sub)
    assert acc["status"] == "not_submitted" and not acc["unlocked"]


async def test_accounts_from_before_approvals_keep_working(client):  # noqa: F811
    sub = f"legacy_{_tag()}"
    h = _hdr(client, sub)
    assert (await client.post("/manufacturer/account", headers=h, json=account(f"Legacy Co {_tag()}"))).status_code == 201
    org = await own_org(client, sub)
    # an account saved before admin approval existed: details saved, never submitted for review
    await client.sql("DELETE FROM manufacturer_submission_events WHERE submission_id IN "
                     "(SELECT id FROM manufacturer_submissions WHERE target_organization_id=CAST(:o AS uuid))", o=org)
    await client.sql("DELETE FROM manufacturer_submissions WHERE target_organization_id=CAST(:o AS uuid)", o=org)
    await client.sql("UPDATE manufacturer_onboarding SET status='in_progress' WHERE organization_id=CAST(:o AS uuid)",
                     o=org)
    assert (await client.patch("/manufacturer/profile", headers=h, json=PROFILE)).status_code == 200


async def test_admin_cannot_approve_a_user_who_never_applied(client):  # noqa: F811
    sub = f"never_{_tag()}"
    assert (await client.get("/manufacturer/bootstrap", headers=_hdr(client, sub))).status_code == 200
    org = await own_org(client, sub)
    r = await approve_company(client, org)
    assert r.status_code == 422 and "nothing to approve" in r.text
    assert (await _access(client, sub))["unlocked"] is False
