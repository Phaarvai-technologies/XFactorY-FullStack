"""Admin Entry: an admin adds a company in the admin dashboard. Real PostgreSQL through the real
admin API (E2E_DATABASE_URL)."""
import os
import uuid

import pytest

from test_e2e_local import approve_company, client  # noqa: F401  (shared fixture)
from test_manufacturer_approval import account, complete_profile, hdr, visible
from test_onboarding_source import _admin, _events, _org

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


def _tag():
    return uuid.uuid4().hex[:6]


async def _role_admin(c, role):
    sub = f"admin_{role}_{_tag()}"
    h = hdr(c, sub)
    assert (await c.get("/identity/me", headers=h)).status_code == 200
    await c.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                   SELECT id, :r FROM users WHERE clerk_user_id=:s""", r=role, s=sub)
    return h


def company(t, **over):
    return {"name": f"Admin Added {t}", "country": "India", "state": "Tamil Nadu", "city": "Hosur",
            "address": "Plot 4", "category": "Automotive & Machinery", "website": f"https://added{t}.example",
            "registration_id": f"REG{t}", "email": "info@added.example", "phone": "9800000000",
            "capacity": "300 t", "reason": "Met at trade fair", **over}


async def test_admin_adds_company_with_admin_entry_source(client):  # noqa: F811
    admin = await _admin(client)
    t = _tag()
    r = await client.post("/admin/manufacturers", headers=admin, json=company(t))
    assert r.status_code == 201, r.text
    d = r.json()
    org = d["manufacturer"]["id"]
    assert d["manufacturer"]["onboardingSource"] == "admin_entry" and d["onboarding"]["sourceLabel"] == "Admin Entry"
    assert d["manufacturer"]["reviewStatus"] == "NOT_STARTED"            # not approved
    assert d["members"] == []                                            # no owner
    assert tuple(await _org(client, org)) == ("admin_entry", None, "ADMIN_ASSISTED")
    assert await _events(client, org) == [("created", "admin_entry", "admin", True, "-")]
    hist = await client.sql("""SELECT field_changed, reason, changed_by IS NOT NULL FROM admin_change_history
                               WHERE manufacturer_id=CAST(:o AS uuid)""", o=org)
    assert [tuple(h) for h in hist] == [("Company created", "Met at trade fair", True)]
    saved = (await client.sql("""SELECT op.registration_id, op.company_category, op.country_name, f.city
                                 FROM organization_profiles op JOIN facilities f ON f.organization_id=op.organization_id
                                 WHERE op.organization_id=CAST(:o AS uuid)""", o=org))[0]
    assert tuple(saved) == (f"REG{t}", "Automotive & Machinery", "India", "Hosur")
    assert d["onboarding"]["history"][0]["label"] == "Company added by an admin"
    # listed for onboarding search, invisible to Visionaries
    found = (await client.get("/manufacturer/companies/search", headers=hdr(client, f"user_s_{t}"),
                              params={"q": f"Admin Added {t}"})).json()
    assert [i["id"] for i in found["items"]] == [org]
    assert not await visible(client, org)


async def test_retries_and_duplicates_never_create_a_second_company(client):  # noqa: F811
    admin = await _admin(client)
    t = _tag()
    key = {"Idempotency-Key": f"form-{t}"}
    first = await client.post("/admin/manufacturers", headers={**admin, **key}, json=company(t))
    again = await client.post("/admin/manufacturers", headers={**admin, **key}, json=company(t))
    assert first.status_code == 201 and again.status_code == 200
    org = first.json()["manufacturer"]["id"]
    assert again.json()["manufacturer"]["id"] == org
    assert len(await _events(client, org)) == 1
    # same company without the key: refused, with the existing id
    dup = await client.post("/admin/manufacturers", headers=admin, json=company(t, website=""))
    assert dup.status_code == 409 and dup.json()["code"] == "duplicate_company" and dup.json()["existingId"] == org
    # same name, nothing else to compare: ambiguous, refused
    amb = await client.post("/admin/manufacturers", headers=admin, json={"name": f"Admin Added {t}"})
    assert amb.status_code == 409 and amb.json()["code"] == "ambiguous_company"
    # same name in another city is a different company
    other = await client.post("/admin/manufacturers", headers=admin,
                              json=company(t, city="Pune", website="", registration_id=""))
    assert other.status_code == 201 and other.json()["manufacturer"]["id"] != org
    assert (await client.sql("SELECT count(*) FROM organizations WHERE display_name=:n", n=f"Admin Added {t}"))[0][0] == 2


async def test_permissions_validation_and_source_spoofing(client):  # noqa: F811
    t = _tag()
    for role, expected in (("platform_operator", 201), ("support_specialist", 403), ("verification_analyst", 403)):
        h = await _role_admin(client, role)
        r = await client.post("/admin/manufacturers", headers=h, json=company(f"{t}{role[:3]}"))
        assert r.status_code == expected, (role, r.text)
    plain = hdr(client, f"user_plain_{t}")
    assert (await client.post("/admin/manufacturers", headers=plain, json=company(t))).status_code == 403
    assert (await client.post("/admin/manufacturers", headers={"Authorization": ""}, json=company(t))).status_code == 401
    admin = await _admin(client)
    for key in ("onboarding_source", "source", "entry_source", "import_batch_id"):
        r = await client.post("/admin/manufacturers", headers=admin, json={**company(t), key: "database_import"})
        assert r.status_code == 422, key
    assert (await client.post("/admin/manufacturers", headers=admin, json={**company(t), "name": " "})).status_code == 422
    assert (await client.sql("SELECT count(*) FROM organizations WHERE display_name=:n", n=f"Admin Added {t}"))[0][0] == 0


async def test_admin_entry_company_claimed_and_approved_keeps_its_source(client):  # noqa: F811
    admin = await _admin(client)
    t = _tag()
    org = (await client.post("/admin/manufacturers", headers=admin, json=company(t))).json()["manufacturer"]["id"]
    sub = f"user_claim_{t}"
    h = hdr(client, sub)
    r = await client.post("/manufacturer/account", headers=h, json=account(f"Admin Added {t}", companyId=org))
    assert r.status_code == 201, r.text
    sub_row = (await client.sql("""SELECT kind, source FROM manufacturer_submissions
                                   WHERE target_organization_id=CAST(:o AS uuid)""", o=org))[0]
    assert tuple(sub_row) == ("claim", "web_dashboard")
    await complete_profile(client, h)
    assert (await approve_company(client, org)).status_code == 200
    assert (await _org(client, org))[0] == "admin_entry"
    assert [e[:2] for e in await _events(client, org)] == [
        ("created", "admin_entry"), ("submitted", "web_dashboard"), ("decision", "admin_review"),
        ("merged", "admin_review")]
    assert await visible(client, org)  # approved AND complete
