"""Approval-first manufacturer onboarding (app/manufacturer_applications.py), against real Postgres.

Covers: company vs personal information, existing-company selection (read-only, enforced on the
backend), new-company entry, submission for approval, locked sections until approval, approval /
rejection / corrections, ownership and associated users, notifications, reapplication policy,
Visionary visibility and retries.

Run with E2E_DATABASE_URL set (see test_e2e_local.py)."""
import json
import os
import uuid

import pytest

from test_e2e_local import PNG, client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")

PROFILE = {  # every remaining required section of the company profile
    "company": {"logo": PNG, "about": "Precision castings.", "estYear": "2001", "employees": "40"},
    "location": {"address": "Plot 9, SIPCOT", "city": "Hosur", "state": "Tamil Nadu", "country": "India"},
    "certifications": [{"name": "ISO 9001", "body": "TUV", "fileName": "", "status": "Pending"}],
    "infra": {"electricity": "250 kVA"},
    "faqs": [{"q": "MOQ?", "a": "200"}],
}


def _t() -> str:
    return uuid.uuid4().hex[:6]


def hdr(c, sub):
    return {"Authorization": f"Bearer {c.token_for(sub)}"}


def basics(name=None, **over):
    """A valid new-company application (personal + company information)."""
    return {"firstName": "Asha", "lastName": "Rao", "personalEmail": "asha.rao@gmail.com", "dob": "1990-02-02",
            "companyName": name or f"Rao Castings {_t()}", "companyType": "Automotive & Machinery",
            "country": "India", "companyPhone": "098765 43210", "capacity": "500 units/month", **over}


async def admin(c, role="platform_administrator"):
    sub = f"admin_{_t()}"
    h = hdr(c, sub)
    assert (await c.get("/identity/me", headers=h)).status_code == 200
    await c.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                   SELECT id, :r FROM users WHERE clerk_user_id=:s""", s=sub, r=role)
    return h


async def uid(c, sub):
    return (await c.sql("SELECT id FROM users WHERE clerk_user_id=:s", s=sub))[0][0]


async def boot(c, sub):
    r = await c.get("/manufacturer/bootstrap", headers=hdr(c, sub))
    assert r.status_code == 200, r.text
    return r.json()


async def apply(c, sub, body):
    return await c.post("/manufacturer/account", headers=hdr(c, sub), json=body)


async def application_id(c, sub):
    return str((await c.sql("""
        SELECT s.id FROM manufacturer_submissions s JOIN users u ON u.id = s.submitted_by_user_id
        WHERE u.clerk_user_id=:s AND s.kind IN ('new_company','join_company','claim')
        ORDER BY s.created_at DESC LIMIT 1""", s=sub))[0][0])


async def decide(c, adm, app_id, **body):
    return await c.post(f"/admin/applications/{app_id}/decision", headers=adm, json=body)


async def approved_company(c, adm, name=None, complete=False):
    """A user-created company approved by X!Y (its applicant is the primary user)."""
    owner = f"user_own_{_t()}"
    r = await apply(c, owner, basics(name, firstName="Owner", personalEmail=f"{owner}@mail.in"))
    assert r.status_code == 201, r.text
    app = await application_id(c, owner)
    assert (await decide(c, adm, app, decision="approve")).status_code == 200
    org = str((await c.sql("""SELECT o.id FROM organizations o JOIN memberships m ON m.organization_id=o.id
                              JOIN users u ON u.id=m.user_id WHERE u.clerk_user_id=:s AND m.status='active'""",
                           s=owner))[0][0])
    if complete:
        r = await c.patch("/manufacturer/profile", headers=hdr(c, owner), json=PROFILE)
        assert r.status_code == 200, r.text
    return owner, org


async def company_row(c, org):
    return dict((await c.sql("""
        SELECT o.display_name, o.onboarding_source, op.company_category, op.country_name,
               op.production_capacity_label, op.contact_email::text AS contact_email, op.contact_phone,
               mo.status AS approval
        FROM organizations o LEFT JOIN organization_profiles op ON op.organization_id=o.id
        LEFT JOIN manufacturer_onboarding mo ON mo.organization_id=o.id WHERE o.id=CAST(:o AS uuid)""", o=org))[0]._mapping)


async def members(c, org):
    return {r[0]: (r[1], r[2]) for r in await c.sql("""
        SELECT u.clerk_user_id, m.membership_role, m.status FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.organization_id=CAST(:o AS uuid)""", o=org)}


async def my_notes(c, sub):
    r = await c.get("/manufacturer/notifications", headers=hdr(c, sub))
    assert r.status_code == 200, r.text
    return r.json()["items"]


# ---------------------------------------------------------------- 1, 3: company vs personal information
async def test_new_company_validation_phone_and_personal_email_are_separate(client):  # noqa: F811
    sub = f"user_new_{_t()}"
    bad_phone = await apply(client, sub, basics(companyPhone="+1 555 000 1234"))
    assert bad_phone.status_code == 422 and bad_phone.json()["field"] == "companyPhone"
    for phone in ("12345", "0000000000", "98765"):
        r = await apply(client, sub, basics(companyPhone=phone))
        assert r.status_code == 422 and r.json()["field"] == "companyPhone", (phone, r.text)
    no_phone = await apply(client, sub, basics(companyPhone=""))
    assert no_phone.status_code == 422 and no_phone.json()["field"] == "companyPhone"
    bad_email = await apply(client, sub, basics(personalEmail="not-an-email"))
    assert bad_email.status_code == 422 and bad_email.json()["field"] == "personalEmail"
    no_email = await apply(client, sub, basics(personalEmail=""))
    assert no_email.status_code == 422 and no_email.json()["field"] == "personalEmail"
    for key in ("companyName", "companyType", "country", "firstName", "lastName"):
        r = await apply(client, sub, basics(**{key: ""}))
        assert r.status_code == 422 and r.json()["field"] == key, (key, r.text)
    future = await apply(client, sub, basics(dob="2999-01-01"))
    assert future.status_code == 422 and future.json()["field"] == "dob"
    # nothing was staged by the refused attempts
    assert await client.sql("""SELECT 1 FROM manufacturer_submissions s JOIN users u ON u.id=s.submitted_by_user_id
                               WHERE u.clerk_user_id=:s""", s=sub) == []

    ok = await apply(client, sub, basics(companyPhone="098765 43210"))
    assert ok.status_code == 201, ok.text
    body = ok.json()
    assert body["submitted"]["kind"] == "new_company" and body["onboarding"]["application"]["status"] == "pending"
    payload = (await client.sql("""SELECT s.payload FROM manufacturer_submissions s JOIN users u
                                   ON u.id=s.submitted_by_user_id WHERE u.clerk_user_id=:s""", s=sub))[0][0]
    payload = payload if isinstance(payload, dict) else json.loads(payload)
    assert payload["contactPhone"] == "+919876543210"           # normalized with +91
    assert payload["contactEmail"] is None                       # personal email is NOT company contact
    assert payload["applicant"]["personalEmail"] == "asha.rao@gmail.com"
    user = (await client.sql("SELECT personal_email::text, email::text, date_of_birth::text, first_name FROM users "
                             "WHERE clerk_user_id=:s", s=sub))[0]
    assert user[0] == "asha.rao@gmail.com" and user[1] == f"{sub}@example.com"   # sign-in email unchanged
    assert user[2] == "1990-02-02" and user[3] == "Asha"
    # older client fields still work: contact (email) -> personal email, phone -> company phone
    legacy = await apply(client, f"user_legacy_{_t()}", {
        "firstName": "Old", "lastName": "Client", "contact": "old@client.in", "dob": "1980-01-01",
        "companyName": f"Legacy Works {_t()}", "companyType": "Other", "country": "India",
        "phone": "+91 90000 11111", "capacity": "10"})
    assert legacy.status_code == 201, legacy.text


async def test_approval_writes_company_details_without_personal_email(client):  # noqa: F811
    adm = await admin(client)
    owner, org = await approved_company(client, adm)
    row = await company_row(client, org)
    assert row["contact_phone"] == "+919876543210" and row["contact_email"] is None
    assert row["company_category"] == "Automotive & Machinery" and row["production_capacity_label"] == "500 units/month"
    assert row["approval"] == "approved" and row["onboarding_source"] == "web_dashboard"


# ---------------------------------------------------------------- 2: existing company selection
async def test_existing_company_read_only_and_join_application(client):  # noqa: F811
    adm = await admin(client)
    owner, org = await approved_company(client, adm)
    await client.sql("UPDATE organization_profiles SET contact_email='sales@castings.in' WHERE organization_id=CAST(:o AS uuid)",
                     o=org)
    before = await company_row(client, org)
    applicant = f"user_join_{_t()}"
    details = (await client.get(f"/manufacturer/companies/{org}", headers=hdr(client, applicant))).json()
    assert details["id"] == org and details["phone"] == "+919876543210"
    assert details["companyType"] == "Automotive & Machinery" and details["capacity"] == "500 units/month"
    assert details["canUpdate"] is False and details["missing"] == []
    assert "sales@castings.in" not in json.dumps(details)        # no contact email / user emails to applicants
    search = (await client.get("/manufacturer/companies/search", params={"q": before["display_name"][:12]},
                               headers=hdr(client, applicant))).json()["items"]
    assert any(i["id"] == org for i in search) and "@" not in json.dumps(search)

    mine = {"firstName": "Ravi", "lastName": "Kumar", "personalEmail": "ravi.k@gmail.com", "dob": "1991-03-03",
            "companyId": org}
    # trying to change the shared company record through the application is refused (backend)
    for key, value in (("companyPhone", "+91 99999 88888"), ("capacity", "1 unit"), ("companyType", "Other")):
        r = await apply(client, applicant, {**mine, "companyName": before["display_name"], key: value})
        assert r.status_code == 422 and r.json()["code"] == "company_read_only", (key, r.text)
    stale = await apply(client, applicant, {**mine, "companyName": "Some Other Company"})
    assert stale.status_code == 422 and stale.json()["code"] == "stale_selection"
    # same values (or none) are accepted; the company record is untouched
    ok = await apply(client, applicant, {**mine, "companyName": before["display_name"], "companyPhone": "9876543210"})
    assert ok.status_code == 201, ok.text
    assert ok.json()["submitted"]["kind"] == "join_company" and ok.json()["submitted"]["companyId"] == org
    assert await company_row(client, org) == before
    assert applicant not in await members(client, org)          # selecting grants nothing
    # an invalid company id / the user's own placeholder cannot be selected
    r = await apply(client, f"user_x_{_t()}", {**mine, "companyId": str(uuid.uuid4())})
    assert r.status_code == 404


async def test_existing_company_missing_details_are_staged_not_written(client):  # noqa: F811
    adm = await admin(client)
    owner, org = await approved_company(client, adm)
    await client.sql("UPDATE organization_profiles SET contact_phone=NULL, production_capacity_label=NULL, "
                     "stated_production_capacity=NULL WHERE organization_id=CAST(:o AS uuid)", o=org)
    before = await company_row(client, org)
    applicant = f"user_fix_{_t()}"
    details = (await client.get(f"/manufacturer/companies/{org}", headers=hdr(client, applicant))).json()
    assert set(details["missing"]) == {"companyPhone", "capacity"}
    r = await apply(client, applicant, {"firstName": "Meena", "lastName": "S", "personalEmail": "meena@gmail.com",
                                        "dob": "1993-04-04", "companyId": org,
                                        "companyPhone": "044 2345 6789", "capacity": "900 units"})
    assert r.status_code == 201, r.text
    assert await company_row(client, org) == before               # never written before approval
    staged = (await client.sql("""SELECT payload FROM manufacturer_submissions WHERE kind='join_company'
                                  AND target_organization_id=CAST(:o AS uuid)""", o=org))[0][0]
    staged = staged if isinstance(staged, dict) else json.loads(staged)
    assert staged["additions"] == {"contactPhone": "+914423456789", "capacity": "900 units"}
    bad = await apply(client, f"user_fix_{_t()}", {"firstName": "A", "lastName": "B", "personalEmail": "a@b.in",
                                                     "dob": "1990-01-01", "companyId": org,
                                                     "companyPhone": "+44 20 7946 0000"})
    assert bad.status_code == 422 and bad.json()["field"] == "companyPhone"


# ---------------------------------------------------------------- 4, 5: locked until approval
async def test_pending_applicant_is_locked_out_of_remaining_sections(client):  # noqa: F811
    adm = await admin(client)
    sub = f"user_lock_{_t()}"
    assert (await apply(client, sub, basics())).status_code == 201
    b = await boot(client, sub)
    assert b["accountExists"] is True
    assert b["onboarding"]["access"] == {"unlocked": False, "status": "pending"}
    h = hdr(client, sub)
    blocked = [
        await client.patch("/manufacturer/profile", headers=h, json={"company": {"about": "x"}}),
        await client.put("/manufacturer/profile", headers=h, json={**PROFILE, "company": {**PROFILE["company"], "name": "X"}}),
        await client.post("/manufacturer/machinery/drafts", headers=h, json={"clientKey": str(uuid.uuid4()), "type": "Lathe"}),
        await client.patch("/manufacturer/availability", headers=h, json={"calendar": {"2026-1-1": "available"}}),
        await client.put("/manufacturer/availability", headers=h, json={"calendar": {}, "recurring": None, "capacity": None}),
    ]
    for r in blocked:
        assert r.status_code == 403 and r.json()["code"] == "onboarding_pending", r.text
    # a pending application cannot be changed or duplicated
    retry = await apply(client, sub, basics(companyName="Another Name Entirely"))
    assert retry.status_code == 409 and retry.json()["code"] == "awaiting_review"

    app = await application_id(client, sub)
    r = await decide(client, adm, app, decision="approve", feedback="Welcome aboard")
    assert r.status_code == 200, r.text
    b = await boot(client, sub)
    assert b["onboarding"]["access"] == {"unlocked": True, "status": "approved"}
    assert (await client.patch("/manufacturer/profile", headers=h, json=PROFILE)).status_code == 200
    notes = await my_notes(client, sub)
    assert notes[0]["title"] == "Your manufacturer application was approved" and notes[0]["body"] == "Welcome aboard"
    # saved basic details are kept (not asked again)
    assert b["state"]["account"]["firstName"] == "Asha" and b["state"]["account"]["companyType"] == "Automotive & Machinery"
    # applying again after approval is refused
    again = await apply(client, sub, basics())
    assert again.status_code == 409 and again.json()["code"] == "already_approved"


# ---------------------------------------------------------------- 6: rejection
async def test_rejection_locks_only_that_application_and_keeps_internal_notes_private(client, monkeypatch):  # noqa: F811
    adm = await admin(client)
    owner, org = await approved_company(client, adm)
    sub = f"user_rej_{_t()}"
    name = (await company_row(client, org))["display_name"]
    assert (await apply(client, sub, {"firstName": "Kiran", "lastName": "P", "personalEmail": "kiran@gmail.com",
                                      "dob": "1990-05-05", "companyId": org, "companyName": name})).status_code == 201
    app = await application_id(client, sub)
    no_reason = await decide(client, adm, app, decision="reject")
    assert no_reason.status_code == 422
    r = await decide(client, adm, app, decision="reject", feedback="We could not verify your employment.",
                     internalNote="CONFIDENTIAL: HR said not an employee")
    assert r.status_code == 200, r.text
    # history + internal note visible to admins only
    detail = r.json()
    a = next(x for x in detail["applications"] if x["id"] == app)
    assert a["status"] == "rejected" and "CONFIDENTIAL" in a["internalNotes"]
    # the applicant: locked, user-facing reason only
    b = await boot(client, sub)
    assert b["onboarding"]["access"] == {"unlocked": False, "status": "rejected"}
    assert b["onboarding"]["application"]["feedback"] == "We could not verify your employment."
    everything = json.dumps(b) + json.dumps(await my_notes(client, sub))
    assert "CONFIDENTIAL" not in everything
    assert "We could not verify your employment." in json.dumps(await my_notes(client, sub))
    assert (await client.patch("/manufacturer/profile", headers=hdr(client, sub), json=PROFILE)).status_code == 403
    # the account itself and other roles keep working
    assert (await client.get("/identity/me", headers=hdr(client, sub))).status_code == 200
    assert (await client.sql("SELECT status FROM users WHERE clerk_user_id=:s", s=sub))[0][0] == "active"
    # the company and its owner are unaffected
    assert (await company_row(client, org))["approval"] == "approved"
    assert (await boot(client, owner))["onboarding"]["access"]["unlocked"] is True
    assert not any("Kiran" in n["body"] or "not approved" in n["title"] for n in await my_notes(client, owner))
    # reapplication: the waiting period is NOT configured -> not available (never silently immediate)
    again = await apply(client, sub, basics())
    assert again.status_code == 409 and again.json()["code"] == "reapply_not_available"
    assert b["onboarding"]["reapply"] == {"configured": False, "allowed": False, "availableFrom": None}
    # once configured, a new application is a new record; the rejected one is kept with its history
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "manufacturer_reapply_after_days", 30)
    early = await apply(client, sub, basics())
    assert early.status_code == 409 and early.json()["code"] == "reapply_too_early"
    monkeypatch.setattr(get_settings(), "manufacturer_reapply_after_days", 0)
    later = await apply(client, sub, basics())
    assert later.status_code == 201, later.text
    rows = await client.sql("""SELECT s.status FROM manufacturer_submissions s JOIN users u ON u.id=s.submitted_by_user_id
                               WHERE u.clerk_user_id=:s ORDER BY s.created_at""", s=sub)
    assert [r[0] for r in rows] == ["rejected", "pending"]


# ---------------------------------------------------------------- 7: corrections
async def test_corrections_only_permitted_fields_and_admin_is_notified(client):  # noqa: F811
    adm = await admin(client)
    sub = f"user_cor_{_t()}"
    body = basics()
    assert (await apply(client, sub, body)).status_code == 201
    app = await application_id(client, sub)
    unread_before = (await client.get("/admin/notifications", headers=adm)).json()["unread"]
    assert unread_before >= 1
    no_fields = await decide(client, adm, app, decision="request_changes", feedback="Fix it")
    assert no_fields.status_code == 422
    r = await decide(client, adm, app, decision="request_changes", feedback="Please check the phone and date of birth.",
                     correctionFields=["companyPhone", "dob"], internalNote="caller id mismatch")
    assert r.status_code == 200, r.text
    b = await boot(client, sub)
    assert b["onboarding"]["access"]["status"] == "changes_requested"
    assert b["onboarding"]["application"]["correctionFields"] == ["companyPhone", "dob"]
    assert b["onboarding"]["application"]["feedback"] == "Please check the phone and date of birth."
    assert "caller id" not in json.dumps(b) + json.dumps(await my_notes(client, sub))
    assert (await client.patch("/manufacturer/profile", headers=hdr(client, sub), json=PROFILE)).status_code == 403
    # only the requested fields may change
    r = await apply(client, sub, {**body, "companyName": body["companyName"] + " Pvt", "dob": "1990-03-03"})
    assert r.status_code == 422 and r.json()["code"] == "field_not_correctable"
    r = await apply(client, sub, body)
    assert r.status_code == 422 and r.json()["code"] == "nothing_changed"
    r = await apply(client, sub, {**body, "companyPhone": "+91 91234 56789", "dob": "1990-03-03"})
    assert r.status_code == 201, r.text
    assert r.json()["onboarding"]["application"]["status"] == "pending"
    feed = (await client.get("/admin/notifications", headers=adm)).json()
    assert feed["items"][0]["kind"] == "application_resubmitted" and feed["items"][0]["applicationId"] == app
    # history: original submission, decision, resubmission with the changed fields
    org = feed["items"][0]["companyId"]
    detail = (await client.get(f"/admin/manufacturers/{org}", headers=adm)).json()
    a = next(x for x in detail["applications"] if x["id"] == app)
    assert [e["event"] for e in a["events"]] == ["submitted", "decision", "resubmitted"]
    assert sorted(a["changedOnResubmit"]) == ["companyPhone", "dob"]
    # the admin may now approve, reject or ask again
    again = await decide(client, adm, app, decision="request_changes", feedback="Still wrong", correctionFields=["dob"],
                         seen=a["seen"])
    assert again.status_code == 200, again.text


# ---------------------------------------------------------------- 8, 9, 10: ownership and associated users
async def test_join_approval_adds_member_without_changing_owner_or_contacts(client):  # noqa: F811
    adm = await admin(client)
    owner, org = await approved_company(client, adm, complete=True)
    await client.sql("UPDATE organization_profiles SET contact_email='sales@castings.in' WHERE organization_id=CAST(:o AS uuid)",
                     o=org)
    before = await company_row(client, org)
    name = before["display_name"]
    joiner, waiting = f"user_mem_{_t()}", f"user_wait_{_t()}"
    for sub, email in ((joiner, "joiner@gmail.com"), (waiting, "waiting@gmail.com")):
        r = await apply(client, sub, {"firstName": sub[:8], "lastName": "X", "personalEmail": email,
                                      "dob": "1990-01-01", "companyId": org, "companyName": name})
        assert r.status_code == 201, r.text
    # the owner keeps working while others are reviewed
    assert (await boot(client, owner))["onboarding"]["access"]["unlocked"] is True
    app = await application_id(client, joiner)
    detail = (await client.get(f"/admin/manufacturers/{org}", headers=adm)).json()
    a = next(x for x in detail["applications"] if x["id"] == app)
    assert a["canMakePrimary"] is False and a["applicant"]["personalEmail"] == "joiner@gmail.com"
    primary_refused = await decide(client, adm, app, decision="approve", makePrimary=True)
    assert primary_refused.status_code == 409
    r = await decide(client, adm, app, decision="approve", seen=a["seen"])
    assert r.status_code == 200, r.text
    dup = await decide(client, adm, app, decision="approve")
    assert dup.status_code == 409                              # never processed twice
    m = await members(client, org)
    assert m[owner] == ("owner", "active") and m[joiner] == ("member", "active") and waiting not in m
    assert await company_row(client, org) == before          # name, contacts, approval unchanged
    # the approved member works in this company now; the waiting applicant does not
    jb = await boot(client, joiner)
    assert jb["onboarding"]["access"]["unlocked"] is True and jb["state"]["account"]["companyName"] == name
    assert (await client.patch("/manufacturer/profile", headers=hdr(client, joiner),
                               json={"company": {"vision": "Grow"}})).status_code == 200
    assert (await boot(client, waiting))["onboarding"]["access"]["unlocked"] is False
    # only the applicant was notified
    assert any(n["title"] == "Your manufacturer application was approved" for n in await my_notes(client, joiner))
    owner_notes = await my_notes(client, owner)          # only the owner's own approval, nothing about others
    assert [n["title"] for n in owner_notes] == ["Your manufacturer application was approved"]
    # admin view: primary user, other users, pending applicants, distinct confirmed count
    people = (await client.get(f"/admin/manufacturers/{org}/people", headers=adm)).json()
    assert people["primaryUser"]["id"] == str(await uid(client, owner))
    assert [u["id"] for u in people["otherUsers"]] == [str(await uid(client, joiner))]
    assert people["otherUsers"][0]["personalEmail"] == "joiner@gmail.com"
    assert people["otherUsers"][0]["membershipStatus"] == "active" and people["otherUsers"][0]["role"] == "member"
    assert [p["requester"]["personalEmail"] for p in people["pendingApplicants"]] == ["waiting@gmail.com"]
    assert people["counts"]["confirmedUsers"] == 2 and people["counts"]["pendingApplicants"] == 1
    # visibility for Visionaries is unaffected by the other applicant's review
    await client.sql("UPDATE organizations SET status='active' WHERE id=CAST(:o AS uuid)", o=org)
    vis = f"user_vis_{_t()}"
    ids = [x["id"] for x in (await client.get("/visionary/manufacturers", headers=hdr(client, vis))).json()]
    assert org in ids
    wapp = await application_id(client, waiting)
    assert (await decide(client, adm, wapp, decision="reject", feedback="No")).status_code == 200
    ids = [x["id"] for x in (await client.get("/visionary/manufacturers", headers=hdr(client, vis))).json()]
    assert org in ids


async def test_unowned_existing_company_primary_only_by_explicit_admin_choice(client):  # noqa: F811
    adm = await admin(client)
    name = f"Imported Forge {_t()}"
    org = str((await client.sql("""
        INSERT INTO organizations (display_name, organization_type, status, entry_source, onboarding_source)
        VALUES (:n, 'manufacturer', 'active', 'IMPORTED', 'database_import') RETURNING id""", n=name))[0][0])
    await client.sql("""INSERT INTO organization_profiles (organization_id, company_category, country_name, contact_phone,
                        production_capacity_label) VALUES (CAST(:o AS uuid), 'Other', 'India', '+914423456789', '50 t')""",
                     o=org)
    first, second = f"user_first_{_t()}", f"user_second_{_t()}"
    for sub in (first, second):
        r = await apply(client, sub, {"firstName": "F", "lastName": "L", "personalEmail": f"{sub}@gmail.com",
                                      "dob": "1990-01-01", "companyId": org})
        assert r.status_code == 201, r.text
    first_app, second_app = await application_id(client, first), await application_id(client, second)
    # approving the first applicant does NOT make them the owner by itself
    assert (await decide(client, adm, first_app, decision="approve")).status_code == 200
    assert (await members(client, org))[first] == ("member", "active")
    # an explicit admin choice may make an applicant the primary user of an owner-less company
    assert (await decide(client, adm, second_app, decision="approve", makePrimary=True)).status_code == 200
    m = await members(client, org)
    assert m[second] == ("owner", "active") and m[first] == ("member", "active")
    row = await company_row(client, org)
    assert row["onboarding_source"] == "database_import"    # original source preserved
    assert row["contact_phone"] == "+914423456789"


# ---------------------------------------------------------------- authorization, retries, drafts
async def test_only_reviewers_decide_and_retries_do_not_duplicate(client):  # noqa: F811
    adm = await admin(client)
    support = await admin(client, role="support_specialist")
    sub = f"user_retry_{_t()}"
    body = basics()
    assert (await apply(client, sub, body)).status_code == 201
    count = lambda: client.sql("""SELECT count(*) FROM notifications WHERE notification_type LIKE 'application_%'
                                  AND related_id = (SELECT s.id FROM manufacturer_submissions s JOIN users u
                                  ON u.id=s.submitted_by_user_id WHERE u.clerk_user_id=:s LIMIT 1)""", s=sub)
    n_before = (await count())[0][0]
    retry = await apply(client, sub, body)                       # same details again (double click / retry)
    assert retry.status_code == 201
    assert (await count())[0][0] == n_before
    assert len(await client.sql("""SELECT 1 FROM manufacturer_submissions s JOIN users u ON u.id=s.submitted_by_user_id
                                   WHERE u.clerk_user_id=:s""", s=sub)) == 1
    app = await application_id(client, sub)
    assert (await decide(client, support, app, decision="approve")).status_code == 403
    assert (await client.get("/admin/notifications", headers=support)).json()["items"] == []
    stale = await decide(client, adm, app, decision="approve", seen="2000-01-01T00:00:00+00:00")
    assert stale.status_code == 409
    assert (await decide(client, adm, app, decision="approve")).status_code == 200
    # the admins' notifications about it are marked done
    assert (await client.sql("""SELECT count(*) FROM notifications WHERE related_id=CAST(:a AS uuid) AND read_at IS NULL""",
                             a=app))[0][0] == 0


async def test_draft_is_kept_and_grants_nothing(client):  # noqa: F811
    sub = f"user_draft_{_t()}"
    r = await client.put("/manufacturer/account/draft", headers=hdr(client, sub),
                         json={"firstName": "Dee", "companyName": "Half Done Works", "companyPhone": "98"})
    assert r.status_code == 200, r.text
    b = await boot(client, sub)
    assert b["onboarding"]["draft"]["values"] == {"firstName": "Dee", "companyName": "Half Done Works",
                                                   "companyPhone": "98"}
    assert b["accountExists"] is False and b["onboarding"]["access"]["unlocked"] is False
    assert (await client.patch("/manufacturer/profile", headers=hdr(client, sub), json=PROFILE)).status_code == 403
    assert (await apply(client, sub, basics())).status_code == 201
    assert (await boot(client, sub))["onboarding"]["draft"] is None
    assert (await client.put("/manufacturer/account/draft", headers=hdr(client, sub),
                             json={"firstName": "X"})).status_code == 409


# ---------------------------------------------------------------- 11: Visionary visibility
async def test_only_approved_and_complete_manufacturers_are_visible(client):  # noqa: F811
    adm = await admin(client)
    vis = f"user_vis_{_t()}"

    async def visible(org_id):
        r = await client.get("/visionary/manufacturers", headers=hdr(client, vis))
        assert r.status_code == 200, r.text
        return org_id in [x["id"] for x in r.json()]

    # pending application: not visible (and cannot even complete the profile)
    pending = f"user_pv_{_t()}"
    assert (await apply(client, pending, basics())).status_code == 201
    porg = str((await client.sql("""SELECT s.target_organization_id FROM manufacturer_submissions s JOIN users u
                                    ON u.id=s.submitted_by_user_id WHERE u.clerk_user_id=:s""", s=pending))[0][0])
    assert not await visible(porg)
    # approved but incomplete: not visible
    owner, org = await approved_company(client, adm, name=f"Approved Incomplete {_t()}")
    assert not await visible(org)
    # approved and 100% complete: visible
    assert (await client.patch("/manufacturer/profile", headers=hdr(client, owner), json=PROFILE)).status_code == 200
    completeness = (await client.sql("SELECT completeness FROM admin_manufacturer_overview WHERE organization_id=CAST(:o AS uuid)",
                                     o=org))[0][0]
    assert completeness == 100
    assert await visible(org)
    # complete but approval withdrawn (rejected status): hidden again
    await client.sql("UPDATE manufacturer_onboarding SET status='changes_requested' WHERE organization_id=CAST(:o AS uuid)",
                     o=org)
    assert not await visible(org)
