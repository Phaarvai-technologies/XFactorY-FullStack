"""Company vs personal information on the Manufacturer details form, existing-company protection,
primary user kept, admin Primary user / Other Users. Run with E2E_DATABASE_URL (test_e2e_local.py)."""
import os
import uuid

import pytest

from test_e2e_local import approve_company, client  # noqa: F401
from test_manufacturer_approval import account, hdr, own_org

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


def _t():
    return uuid.uuid4().hex[:6]


async def _seed(c, name, phone=None, category="Automotive & Machinery", capacity=None):
    org = str((await c.sql("""INSERT INTO organizations (display_name, organization_type, status, entry_source)
                              VALUES (:n, 'manufacturer', 'claim_pending', 'IMPORTED') RETURNING id""", n=name))[0][0])
    await c.sql("""INSERT INTO organization_profiles (organization_id, company_category, country_name, contact_phone,
                                                      production_capacity_label, contact_email)
                   VALUES (CAST(:o AS uuid), :cat, 'India', :p, :cap, 'office@company.example')""",
                o=org, cat=category, p=phone, cap=capacity)
    return org


async def _profile(c, org):
    return tuple((await c.sql("""SELECT company_category, country_name, contact_phone, production_capacity_label,
                                        contact_email::text FROM organization_profiles
                                 WHERE organization_id=CAST(:o AS uuid)""", o=org))[0])


async def test_new_company_requires_company_phone_and_personal_email(client):  # noqa: F811
    sub = f"u_new_{_t()}"
    h = hdr(client, sub)
    for bad in ({"phone": ""}, {"phone": "+44 20 7946 0000"}, {"contact": "", "email": ""}, {"email": "nope"}):
        r = await client.post("/manufacturer/account", headers=h, json=account(f"New Co {_t()}", **bad))
        assert r.status_code == 422, (bad, r.text)
    r = await client.post("/manufacturer/account", headers=h,
                          json=account(f"New Co {_t()}", email="asha.rao@gmail.com", phone="98765 43210"))
    assert r.status_code == 201, r.text
    row = (await client.sql("""SELECT u.personal_email::text, u.email::text, u.phone, s.payload->>'contactEmail',
                                      s.payload->>'contactPhone'
                               FROM users u JOIN manufacturer_submissions s ON s.submitted_by_user_id=u.id
                               WHERE u.clerk_user_id=:s""", s=sub))[0]
    # personal email on the user; the phone belongs to the company (never the user's own phone)
    assert tuple(row) == ("asha.rao@gmail.com", f"{sub}@example.com", None, None, "+919876543210")
    assert r.json()["state"]["account"]["personalEmail"] == "asha.rao@gmail.com"


async def test_existing_company_saved_details_are_never_overwritten(client):  # noqa: F811
    org = await _seed(client, f"Ashok Leyland {_t()}", phone="+914423456789", capacity="900 t")
    before = await _profile(client, org)
    d = (await client.get(f"/manufacturer/companies/{org}", headers=hdr(client, f"u_v_{_t()}"))).json()
    assert (d["companyType"], d["country"], d["phone"], d["capacity"], d["missing"]) == \
        ("Automotive & Machinery", "India", "+914423456789", "900 t", [])
    sub = f"u_claim_{_t()}"
    # a modified request tries to change the shared details
    body = account(d["companyName"], companyId=org, companyType="Other", country="Germany", phone="9123456780",
                   capacity="1 t", email="ravi@gmail.com")
    r = await client.post("/manufacturer/account", headers=hdr(client, sub), json=body)
    assert r.status_code == 201, r.text
    staged = (await client.sql("""SELECT payload->>'companyType', payload->>'country', payload->>'contactPhone',
                                         payload->>'capacity', payload->>'contactEmail'
                                  FROM manufacturer_submissions WHERE target_organization_id=CAST(:o AS uuid)""", o=org))[0]
    assert tuple(staged) == ("Automotive & Machinery", "India", "+914423456789", "900 t", None)
    assert (await approve_company(client, org)).status_code == 200
    assert await _profile(client, org) == before          # saved values and contact email unchanged


async def test_existing_company_without_phone_needs_one_and_only_fills_it(client):  # noqa: F811
    org = await _seed(client, f"Phoneless Works {_t()}", phone="   ")
    d = (await client.get(f"/manufacturer/companies/{org}", headers=hdr(client, f"u_v_{_t()}"))).json()
    assert set(d["missing"]) == {"phone", "capacity"}
    sub = f"u_ph_{_t()}"
    r = await client.post("/manufacturer/account", headers=hdr(client, sub),
                          json=account(d["companyName"], companyId=org, phone=""))
    assert r.status_code == 422 and "phone" in r.text.lower()
    r = await client.post("/manufacturer/account", headers=hdr(client, sub),
                          json=account(d["companyName"], companyId=org, phone="9876543210", capacity="50 t"))
    assert r.status_code == 201, r.text
    assert (await approve_company(client, org)).status_code == 200
    assert await _profile(client, org) == ("Automotive & Machinery", "India", "+919876543210", "50 t",
                                           "office@company.example")


async def test_primary_user_kept_and_admin_lists_other_users(client):  # noqa: F811
    owner = f"u_own_{_t()}"
    r = await client.post("/manufacturer/account", headers=hdr(client, owner),
                          json=account(f"Primary Co {_t()}", email="owner.self@gmail.com"))
    assert r.status_code == 201, r.text
    org = await own_org(client, owner)
    assert (await approve_company(client, org)).status_code == 200
    name = (await client.sql("SELECT display_name FROM organizations WHERE id=CAST(:o AS uuid)", o=org))[0][0]
    # a second user registers under the same company: an update request, never ownership
    other = f"u_oth_{_t()}"
    r = await client.post("/manufacturer/account", headers=hdr(client, other),
                          json=account(name, companyId=org, email="other.self@gmail.com"))
    assert r.status_code == 201, r.text
    admin_sub = f"adm_{_t()}"
    ah = hdr(client, admin_sub)
    assert (await client.get("/identity/me", headers=ah)).status_code == 200
    await client.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                        SELECT id, 'platform_administrator' FROM users WHERE clerk_user_id=:s""", s=admin_sub)
    member = f"u_mem_{_t()}"
    assert (await client.get("/identity/me", headers=hdr(client, member))).status_code == 200
    await client.sql("""UPDATE users SET personal_email='member.self@gmail.com' WHERE clerk_user_id=:s""", s=member)
    await client.sql("""INSERT INTO memberships (user_id, organization_id, membership_role, status, accepted_at)
                        SELECT id, CAST(:o AS uuid), 'member', 'active', now() FROM users WHERE clerk_user_id=:s""",
                     o=org, s=member)
    p = (await client.get(f"/admin/manufacturers/{org}/people", headers=ah)).json()
    assert p["primaryUser"]["email"] == f"{owner}@example.com"
    assert p["primaryUser"]["personalEmail"] == "owner.self@gmail.com"
    # associated users: the member, then the applicant awaiting approval (not a member, not counted)
    assert [(u["personalEmail"], u["role"], u["membershipStatus"]) for u in p["otherUsers"]] == [
        ("member.self@gmail.com", "member", "active"), ("other.self@gmail.com", "applicant", "pending")]
    assert [r["requester"]["personalEmail"] for r in p["pendingRequests"]] == ["other.self@gmail.com"]
    assert p["counts"]["confirmedUsers"] == 2 and p["counts"]["pendingRequests"] == 1
    owners = await client.sql("""SELECT u.clerk_user_id FROM memberships m JOIN users u ON u.id=m.user_id
                                 WHERE m.organization_id=CAST(:o AS uuid) AND m.membership_role='owner'""", o=org)
    assert [o[0] for o in owners] == [owner]
