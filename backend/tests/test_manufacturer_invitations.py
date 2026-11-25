"""Manufacturer magic link (app/invitations.py) end to end against a real Postgres: the team fills
in an imported company, invites the manufacturer, the shareable link signs them in (Clerk is a
stand-in), they accept the Terms, own the company, confirm the details; reminders, resend,
cancel, expiry and the refusals.

Run:  E2E_DATABASE_URL=postgresql+asyncpg://xy:xy@localhost:5432/xy_test PYTHONPATH=. \
      python -m pytest tests/test_manufacturer_invitations.py -q
"""
import uuid

import pytest

from test_e2e_local import DB, approve_company, client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not DB, reason="E2E_DATABASE_URL not set")


def auth(client, sub):
    return {"Authorization": f"Bearer {client.token_for(sub)}"}


async def admin_headers(client, role="platform_administrator"):
    sub = f"admin_{uuid.uuid4().hex[:8]}"
    h = auth(client, sub)
    assert (await client.get("/identity/me", headers=h)).status_code == 200
    await client.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                        SELECT id, :r FROM users WHERE clerk_user_id = :s""", r=role, s=sub)
    return h


async def imported(client, name):
    org = str(uuid.uuid4())
    await client.sql("""INSERT INTO organizations(id, display_name, organization_type, entry_source, status, record_type)
                        VALUES (CAST(:id AS uuid), :n, 'manufacturer', 'IMPORTED', 'claim_pending', 'REAL')""",
                     id=org, n=name)
    await client.sql("""INSERT INTO organization_profiles(organization_id, country_name, company_category)
                        VALUES (CAST(:id AS uuid), 'India', 'Food & Beverage')""", id=org)
    await client.sql("""INSERT INTO facilities(organization_id, name, is_headquarters, city, state_province, country_name)
                        VALUES (CAST(:id AS uuid), 'HQ', true, 'Chennai', 'Tamil Nadu', 'India')""", id=org)
    return org


@pytest.fixture
def clerk_stub(monkeypatch):
    """Clerk's Backend API: one account per email, a numbered ticket per sign-in token."""
    from app import invitations
    from app.core import clerk

    accounts: dict[str, str] = {}
    tickets: list[str] = []

    async def find_or_create_user(self, email, first, last):
        created = email not in accounts
        accounts.setdefault(email, f"invitee_{uuid.uuid4().hex[:10]}")
        return accounts[email], created

    async def sign_in_token(self, clerk_user_id, expires_in_seconds=600):
        tickets.append(clerk_user_id)
        return f"ticket-{len(tickets)}-{clerk_user_id}"

    monkeypatch.setattr(clerk.ClerkManagement, "find_or_create_user", find_or_create_user)
    monkeypatch.setattr(clerk.ClerkManagement, "sign_in_token", sign_in_token)
    assert invitations  # imported for the patch target's module
    return accounts, tickets


def code_of(link):
    return link.rsplit("/invite/", 1)[1]


async def test_magic_link_end_to_end(client, clerk_stub, monkeypatch):
    from app.core.config import get_settings
    accounts, tickets = clerk_stub
    t = uuid.uuid4().hex[:6]
    admin = await admin_headers(client)
    org = await imported(client, f"Kaveri Kitchenware {t}")

    # the team fills in what it learned on the call
    r = await client.patch(f"/admin/manufacturers/{org}/fields", headers=admin,
                           json={"field": "company.about", "value": "Steel tea pans.", "reason": "Phone call"})
    assert r.status_code == 200, r.text
    r = await client.post(f"/admin/manufacturers/{org}/machinery", headers=admin,
                          json={"type": "Sheet Metal Bending", "industry": "Food & Beverage", "capacity": "1500/day",
                                "reason": "Phone call"})
    assert r.status_code == 201, r.text
    r = await client.get(f"/admin/manufacturers/{org}/invitations", headers=admin)
    assert r.json()["details"]["source"] == "entered_by_xfactory" and r.json()["invitations"] == []

    # invite: account created in Clerk, link returned for Copy link / WhatsApp
    email = f"meena.{t}@example.com"
    r = await client.post(f"/admin/manufacturers/{org}/invitations", headers=admin,
                          json={"contactName": "Meena Raghavan", "email": email.upper(), "phone": "+91 98840 22334"})
    assert r.status_code == 201, r.text
    body = r.json()
    link, invitation = body["link"], body["invitation"]
    assert "/invite/" in link and invitation["status"] == "invited" and invitation["email"] == email
    assert body["email"] in ("skipped", "sent", "failed")          # no SMTP in tests
    invitee = accounts[email]
    client.unregistered.add(invitee)                                 # signs up through the link only
    r = await client.post(f"/admin/manufacturers/{org}/invitations", headers=admin,
                          json={"contactName": "Meena", "email": email})
    assert r.status_code == 409 and r.json()["code"] == "already_invited"

    # the shareable link signs in, more than once, with a fresh ticket each time
    code = code_of(link)
    first = (await client.post(f"/invitations/{code}/open", headers={"Authorization": ""})).json()
    again = (await client.post(f"/invitations/{code}/open", headers={"Authorization": ""})).json()
    assert first["status"] == again["status"] == "open" and first["ticket"] != again["ticket"]
    assert first["companyName"] == f"Kaveri Kitchenware {t}" and first["email"] == email
    assert (await client.post("/invitations/not-a-real-code/open", headers={"Authorization": ""})).json() == \
        {"status": "invalid"}

    # reminders: day 3 sends one, with the same link
    settings = get_settings()
    monkeypatch.setattr(settings, "invitation_job_secret", "job-secret")
    assert (await client.post("/jobs/invitation-reminders", headers={"X-Job-Secret": "wrong"})).status_code == 401
    await client.sql("""UPDATE manufacturer_invitations SET last_sent_at = now() - interval '4 days'
                        WHERE id = CAST(:i AS uuid)""", i=invitation["id"])
    r = await client.post("/jobs/invitation-reminders", headers={"X-Job-Secret": "job-secret"})
    assert r.status_code == 200 and r.json()["reminded"] >= 1
    rows = await client.sql("SELECT reminders_sent FROM manufacturer_invitations WHERE id = CAST(:i AS uuid)",
                            i=invitation["id"])
    assert rows[0][0] == 1
    assert (await client.post(f"/invitations/{code}/open", headers={"Authorization": ""})).json()["status"] == "open"

    # accept: only the invited account, only with the Terms
    terms = {"termsAccepted": True, "termsVersion": "terms-1.2;privacy-1.4"}
    stranger = f"stranger_{t}"
    client.unregistered.add(stranger)
    r = await client.post(f"/invitations/{code}/accept", headers=auth(client, stranger), json=terms)
    assert r.status_code == 403 and r.json()["code"] == "other_account"
    r = await client.post(f"/invitations/{code}/accept", headers=auth(client, invitee),
                          json={**terms, "termsAccepted": False})
    assert r.status_code == 422
    r = await client.post(f"/invitations/{code}/accept", headers=auth(client, invitee), json=terms)
    assert r.status_code == 200, r.text
    assert r.json()["returnPath"] == "/manufacturer/dashboard"
    client.registered.add(invitee)

    # registered, owner, approved, on the dashboard with the team's details
    user = await client.sql("""SELECT registration_channel, registration_method, phone FROM users
                               WHERE clerk_user_id = :c""", c=invitee)
    assert user[0] == ("admin_portal", "magic_link", "+91 98840 22334")
    r = await client.get("/manufacturer/bootstrap", headers=auth(client, invitee))
    assert r.status_code == 200, r.text
    boot = r.json()
    assert boot["details"]["source"] == "entered_by_xfactory"
    assert "Steel tea pans." in str(boot["profileData"])
    assert "Sheet Metal Bending" in str(boot["state"])
    owner = await client.sql("""SELECT m.membership_role, mo.status FROM memberships m
                                JOIN users u ON u.id = m.user_id
                                JOIN manufacturer_onboarding mo ON mo.organization_id = m.organization_id
                                WHERE u.clerk_user_id = :c AND m.organization_id = CAST(:o AS uuid)""",
                             c=invitee, o=org)
    # accepting does not approve: approval is a separate step after "Confirm details"
    assert owner[0] == ("owner", "in_progress")
    # ...but the invited owner may already edit their profile and machinery
    r = await client.post("/manufacturer/machinery", headers=auth(client, invitee),
                          json={"industry": "Food & Beverage", "subcategory": "Lids", "type": "Welding",
                                "capacity": "500", "age": "2", "condition": "Good", "technical": "", "images": [],
                                "rawMatStatus": "", "materialDetails": "", "laborType": "", "workerCount": "",
                                "workerRoles": "", "logistics": [], "logisticsPartner": "",
                                "pricing": {"hour": "", "day": "", "month": "", "unit": "", "batch": ""},
                                "insurance": "", "status": "Published"})
    assert r.status_code == 201, r.text

    # confirm -> sent to admin approval (review status Submitted)
    r = await client.post("/manufacturer/details/confirm", headers=auth(client, invitee))
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "confirmed_by_manufacturer" and r.json()["approvalStatus"] == "submitted"
    review = await client.sql("SELECT review_status FROM admin_manufacturer_overview WHERE organization_id = CAST(:o AS uuid)", o=org)
    assert review[0][0] == "SUBMITTED"
    # corrections requested -> the dashboard shows the note; confirming again sends it back
    r = await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=admin,
                           json={"review_status": "NEEDS_CORRECTION", "reason": "Please add your GST number"})
    assert r.status_code == 200, r.text
    boot = (await client.get("/manufacturer/bootstrap", headers=auth(client, invitee))).json()
    assert boot["details"]["approvalStatus"] == "changes_requested"
    assert boot["details"]["feedback"] == "Please add your GST number"
    r = await client.post("/manufacturer/details/confirm", headers=auth(client, invitee))
    assert r.json()["approvalStatus"] == "submitted"
    # the admin approves with the usual Review status control
    assert (await approve_company(client, org)).status_code == 200
    r = await client.get(f"/admin/manufacturers/{org}/invitations", headers=admin)
    assert r.json()["details"]["approvalStatus"] == "approved"
    # an edit to an owned company is a correction: not marked as entered by XfactorY again
    r = await client.patch(f"/admin/manufacturers/{org}/fields", headers=admin,
                           json={"field": "company.about", "value": "Steel tea pans and kettles.", "reason": "Fix"})
    assert r.status_code == 200
    r = await client.get(f"/admin/manufacturers/{org}/invitations", headers=admin)
    assert r.json()["details"]["source"] == "confirmed_by_manufacturer"
    assert r.json()["invitations"][0]["status"] == "accepted" and r.json()["invitations"][0]["link"] is None

    # after set-up the link only says so (no ticket), and the company cannot be invited again
    done = (await client.post(f"/invitations/{code}/open", headers={"Authorization": ""})).json()
    assert done["status"] == "accepted" and "ticket" not in done
    r = await client.post(f"/admin/manufacturers/{org}/invitations", headers=admin,
                          json={"contactName": "Someone", "email": f"other.{t}@example.com"})
    assert r.status_code == 409 and r.json()["code"] == "has_owner"
    r = await client.post(f"/invitations/{code}/accept", headers=auth(client, invitee), json=terms)
    assert r.status_code == 200 and r.json()["alreadyAccepted"] is True


async def test_resend_cancel_expiry_and_roles(client, clerk_stub):
    t = uuid.uuid4().hex[:6]
    admin = await admin_headers(client)
    org = await imported(client, f"Marina Castings {t}")
    support = await admin_headers(client, "support_specialist")
    r = await client.post(f"/admin/manufacturers/{org}/invitations", headers=support,
                          json={"contactName": "Suresh Babu", "email": f"suresh.{t}@example.com"})
    assert r.status_code == 403
    r = await client.get(f"/admin/manufacturers/{org}/invitations", headers=support)
    assert r.json()["canInvite"] is False

    r = await client.post(f"/admin/manufacturers/{org}/invitations", headers=admin,
                          json={"contactName": "Suresh Babu", "email": f"suresh.{t}@example.com"})
    assert r.status_code == 201, r.text
    old = code_of(r.json()["link"])
    inv = r.json()["invitation"]["id"]
    r = await client.get(f"/admin/manufacturers/{org}/invitations", headers=admin)
    assert code_of(r.json()["invitations"][0]["link"]) == old            # Copy link shows the same link

    # resend: a new link, the old one stops working
    r = await client.post(f"/admin/invitations/{inv}/resend", headers=admin)
    assert r.status_code == 200 and r.json()["invitation"]["sendCount"] == 2
    new = code_of(r.json()["link"])
    assert new != old
    assert (await client.post(f"/invitations/{old}/open", headers={"Authorization": ""})).json()["status"] == "invalid"
    assert (await client.post(f"/invitations/{new}/open", headers={"Authorization": ""})).json()["status"] == "open"

    # expired after 14 days
    await client.sql("UPDATE manufacturer_invitations SET expires_at = now() - interval '1 minute' "
                     "WHERE id = CAST(:i AS uuid)", i=inv)
    assert (await client.post(f"/invitations/{new}/open", headers={"Authorization": ""})).json()["status"] == "expired"
    r = await client.get(f"/admin/manufacturers/{org}/invitations", headers=admin)
    assert r.json()["invitations"][0]["status"] == "expired"

    # a resend brings it back; cancel ends it
    r = await client.post(f"/admin/invitations/{inv}/resend", headers=admin)
    third = code_of(r.json()["link"])
    assert (await client.post(f"/invitations/{third}/open", headers={"Authorization": ""})).json()["status"] == "open"
    r = await client.post(f"/admin/invitations/{inv}/cancel", headers=admin)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert (await client.post(f"/invitations/{third}/open", headers={"Authorization": ""})).json()["status"] == \
        "cancelled"

    # bad input
    r = await client.post(f"/admin/manufacturers/{org}/invitations", headers=admin,
                          json={"contactName": "X", "email": "not-an-email"})
    assert r.status_code == 422


async def test_add_manufacturer_page(client):
    """One page for company, contact person and machines: create, read, save only what changed
    (with history), all-or-nothing validation, roles, duplicates; then invite from it."""
    t = uuid.uuid4().hex[:6]
    admin = await admin_headers(client)
    form = {
        "company": {"name": f"Sahyadri Plastics {t}", "category": "Chemicals & Plastics",
                    "about": "Injection moulded containers.", "estYear": "2012", "employees": "40",
                    "businessType": "Private Limited", "orgSize": "Small (10–49 employees)", "capacity": "50,000 pcs/month"},
        "location": {"address": "Plot 4, MIDC Bhosari", "city": "Pune", "state": "Maharashtra", "country": "India",
                     "zip": "411026"},
        "contact": {"personName": "Rahul Deshmukh", "email": f"rahul.{t}@example.com", "phone": "+91 98220 99001"},
        "machines": [{"type": "Injection Moulding", "industry": "Chemicals & Plastics", "capacity": "8000/day"},
                     {"type": "Blow Moulding", "industry": "Food & Beverage"}],
    }
    support = await admin_headers(client, "support_specialist")
    assert (await client.post("/admin/manufacturers/onboarding", headers=support, json=form)).status_code == 403

    r = await client.post("/admin/manufacturers/onboarding", headers=admin, json=form)
    assert r.status_code == 201, r.text
    page = r.json()
    org = page["id"]
    assert page["company"]["name"] == f"Sahyadri Plastics {t}" and page["company"]["category"] == "Chemicals & Plastics"
    assert page["company"]["about"] == "Injection moulded containers." and page["location"]["city"] == "Pune"
    assert page["contact"] == {"personName": "Rahul Deshmukh", "email": f"rahul.{t}@example.com",
                               "phone": "+91 98220 99001"}
    assert sorted(m["type"] for m in page["machines"]) == ["Blow Moulding", "Injection Moulding"]
    assert page["hasOwner"] is False
    r = await client.get(f"/admin/manufacturers/{org}/invitations", headers=admin)
    assert r.json()["details"]["source"] == "entered_by_xfactory"
    # the same company again is refused as a duplicate, with its id
    r = await client.post("/admin/manufacturers/onboarding", headers=admin, json=form)
    assert r.status_code == 409 and r.json()["existingId"] == org

    # save: change about, remove one machine, add one, edit one, change the contact person
    blow = next(m for m in page["machines"] if m["type"] == "Blow Moulding")
    inj = next(m for m in page["machines"] if m["type"] == "Injection Moulding")
    edited = {**form, "company": {**form["company"], "about": "Containers and caps."},
              "contact": {**form["contact"], "personName": "Rahul D."},
              "machines": [{**inj, "capacity": "9000/day"}, {**blow, "remove": True},
                           {"type": "Extrusion", "industry": "Chemicals & Plastics"}]}
    for m in edited["machines"]:
        m.pop("status", None)
    r = await client.put(f"/admin/manufacturers/{org}/onboarding", headers=admin, json=edited)
    assert r.status_code == 200, r.text
    page = r.json()
    assert page["company"]["about"] == "Containers and caps." and page["contact"]["personName"] == "Rahul D."
    assert sorted(m["type"] for m in page["machines"]) == ["Extrusion", "Injection Moulding"]
    assert next(m for m in page["machines"] if m["type"] == "Injection Moulding")["capacity"] == "9000/day"
    history = await client.sql("SELECT field_changed FROM admin_change_history WHERE manufacturer_id = CAST(:o AS uuid)",
                               o=org)
    fields = {h[0] for h in history}
    assert {"About the company", "Contact person", "Machinery removed", "Machinery added"} <= fields

    # all or nothing: a bad email saves nothing
    bad = {**edited, "company": {**edited["company"], "about": "Should not be saved."},
           "contact": {**edited["contact"], "email": "not-an-email"}, "machines": []}
    r = await client.put(f"/admin/manufacturers/{org}/onboarding", headers=admin, json=bad)
    assert r.status_code == 422, r.text
    assert (await client.get(f"/admin/manufacturers/{org}/onboarding", headers=admin)).json()["company"]["about"] == \
        "Containers and caps."


async def test_invite_email_asks_for_a_reply_within_7_days():
    from datetime import datetime, timezone
    from app.core import email_templates
    from app.core.config import get_settings
    from app.invitations import respond_by_date
    due = respond_by_date(get_settings(), {"last_sent_at": datetime(2026, 11, 25, 10, tzinfo=timezone.utc)})
    assert due == "2 Dec 2026"
    subject, text, html = email_templates.manufacturer_invite("Lakshmi", "Nilgiri", "https://x/invite/abc", 14, due)
    assert "by 2 Dec 2026" in text and "works for 14 days" in text and "2 Dec 2026" in html
    _, text, _ = email_templates.manufacturer_invite_reminder("Lakshmi", "Nilgiri", "https://x/invite/abc", 11, due)
    assert "by 2 Dec 2026" in text


async def test_new_link_says_14_days_not_13_and_dates_are_indian():
    from datetime import datetime, timedelta, timezone
    from app.core import email_templates
    from app.core.config import get_settings
    from app.invitations import days_left, respond_by_date
    now = datetime.now(timezone.utc)
    assert days_left(now + timedelta(days=14) - timedelta(seconds=5)) == 14  # just sent
    assert days_left(now + timedelta(days=2) - timedelta(hours=1)) == 2      # day-12 reminder
    assert days_left(now - timedelta(days=1)) == 1
    # sent at 20:00 UTC = 01:30 next day in India → the date is counted from the Indian date
    assert respond_by_date(get_settings(), {"last_sent_at": datetime(2026, 11, 25, 20, tzinfo=timezone.utc)}) == \
        "3 Dec 2026"
    _, text, html = email_templates.manufacturer_invite("Lakshmi", "Nilgiri", "https://x/invite/abc", 14, "2 Dec 2026")
    assert "within 7 days (by 2 Dec 2026)" in text and "works for 14 days" in text
    assert "within 7 days" in html and "works for 14 days" in html
