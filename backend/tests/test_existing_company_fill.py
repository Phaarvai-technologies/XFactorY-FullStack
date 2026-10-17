"""Existing company selected on the onboarding form: saved values are read-only, missing ones may be
supplied, kept in the pending application, and written on approval only where still missing.

Run with E2E_DATABASE_URL set (see test_e2e_local.py)."""
import json
import os

import pytest

from test_application_first import _t, admin, application_id, apply, approved_company, boot, company_row, decide, hdr
from test_e2e_local import client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


def me(sub, org, **company):
    """Personal information + the selected company's id (+ values for its missing fields)."""
    return {"firstName": "Ravi", "lastName": "Kumar", "personalEmail": f"{sub}@gmail.com", "dob": "1991-03-03",
            "companyId": org, **company}


async def ashok_leyland(c):
    """A company with category and location saved, but no phone and no production capacity."""
    t = _t()
    org = str((await c.sql("""INSERT INTO organizations (display_name, organization_type, status, entry_source)
                              VALUES (:n, 'manufacturer', 'claim_pending', 'IMPORTED') RETURNING id""",
                           n=f"Ashok Leyland {t}"))[0][0])
    await c.sql("""INSERT INTO organization_profiles (organization_id, company_category, country_name, contact_phone,
                                                      production_capacity_label, stated_production_capacity)
                   VALUES (CAST(:o AS uuid), 'Automotive & Machinery', 'India', '   ', NULL, NULL)""", o=org)
    return org, f"Ashok Leyland {t}"


async def payload(c, sub):
    raw = (await c.sql("""SELECT s.payload FROM manufacturer_submissions s JOIN users u ON u.id=s.submitted_by_user_id
                          WHERE u.clerk_user_id=:s ORDER BY s.created_at DESC LIMIT 1""", s=sub))[0][0]
    return raw if isinstance(raw, dict) else json.loads(raw)


async def test_saved_fields_locked_missing_fields_supplied_and_phone_required(client):  # noqa: F811
    org, name = await ashok_leyland(client)
    sub = f"user_al_{_t()}"
    d = (await client.get(f"/manufacturer/companies/{org}", headers=hdr(client, sub))).json()
    assert (d["companyType"], d["country"], d["phone"], d["capacity"]) == ("Automotive & Machinery", "India", "", "")
    assert set(d["missing"]) == {"companyPhone", "capacity"}           # whitespace-only phone = missing
    before = await company_row(client, org)

    # the phone is required because the company has none
    r = await apply(client, sub, me(sub, org))
    assert r.status_code == 422 and r.json()["field"] == "companyPhone"
    r = await apply(client, sub, me(sub, org, companyPhone="+1 555 000 1234"))
    assert r.status_code == 422 and r.json()["field"] == "companyPhone"
    # saved values cannot be overwritten, even by a modified request
    for key, value in (("companyType", "Textile & Apparel"), ("country", "Germany"), ("companyName", "Other Co")):
        r = await apply(client, sub, me(sub, org, companyPhone="9876543210", **{key: value}))
        assert r.status_code == 422 and r.json()["field"] == key and r.json()["code"] in (
            "company_read_only", "stale_selection"), (key, r.text)
    # sending the saved value unchanged is fine; capacity stays optional
    r = await apply(client, sub, me(sub, org, companyType="Automotive & Machinery", companyPhone="98765 43210"))
    assert r.status_code == 201, r.text
    assert await company_row(client, org) == before                    # nothing written before approval
    p = await payload(client, sub)
    assert p["additions"] == {"contactPhone": "+919876543210"}
    assert p["companyType"] == "Automotive & Machinery" and p["contactPhone"] == "+919876543210"
    assert p["applicant"]["personalEmail"] == f"{sub}@gmail.com" and p["contactEmail"] is None
    assert (await boot(client, sub))["onboarding"]["access"] == {"unlocked": False, "status": "pending"}


async def test_numeric_zero_capacity_is_a_saved_value(client):  # noqa: F811
    org, _ = await ashok_leyland(client)
    await client.sql("UPDATE organization_profiles SET stated_production_capacity = 0 "
                     "WHERE organization_id = CAST(:o AS uuid)", o=org)
    sub = f"user_zero_{_t()}"
    d = (await client.get(f"/manufacturer/companies/{org}", headers=hdr(client, sub))).json()
    assert d["capacity"] == "0" and "capacity" not in d["missing"]
    r = await apply(client, sub, me(sub, org, companyPhone="9876543210", capacity="500 units"))
    assert r.status_code == 422 and r.json()["field"] == "capacity"


async def test_approval_fills_only_fields_that_are_still_missing(client):  # noqa: F811
    adm = await admin(client)
    org, _ = await ashok_leyland(client)
    first, second = f"user_al1_{_t()}", f"user_al2_{_t()}"
    assert (await apply(client, first, me(first, org, companyPhone="9876543210", capacity="900 units"))).status_code == 201
    assert (await apply(client, second, me(second, org, companyPhone="9123456780"))).status_code == 201

    assert (await decide(client, adm, await application_id(client, first), decision="approve")).status_code == 200
    row = await company_row(client, org)
    assert (row["contact_phone"], row["production_capacity_label"]) == ("+919876543210", "900 units")
    assert row["company_category"] == "Automotive & Machinery" and row["country_name"] == "India"

    # the second applicant's phone arrived while the field was missing; it is not written over the
    # value the first approval supplied
    assert (await decide(client, adm, await application_id(client, second), decision="approve")).status_code == 200
    assert (await company_row(client, org))["contact_phone"] == "+919876543210"
    history = await client.sql("""SELECT e.details FROM manufacturer_submission_events e
                                  WHERE e.organization_id = CAST(:o AS uuid) AND e.event = 'merged'
                                  ORDER BY e.created_at""", o=org)
    details = [h[0] if isinstance(h[0], dict) else json.loads(h[0]) for h in history]
    assert [d["companyDetails"] for d in details] == [{"applied": ["companyPhone", "capacity"], "skipped": []},
                                                      {"applied": [], "skipped": ["companyPhone"]}]
    # both are now confirmed users of the one company record (no duplicate company)
    assert (await client.sql("SELECT count(*) FROM organizations WHERE display_name = (SELECT display_name "
                             "FROM organizations WHERE id = CAST(:o AS uuid))", o=org))[0][0] == 1
    for sub in (first, second):
        assert (await boot(client, sub))["onboarding"]["access"]["unlocked"] is True


async def test_rejected_application_writes_nothing(client):  # noqa: F811
    adm = await admin(client)
    org, _ = await ashok_leyland(client)
    sub = f"user_alr_{_t()}"
    before = await company_row(client, org)
    assert (await apply(client, sub, me(sub, org, companyPhone="9876543210"))).status_code == 201
    r = await decide(client, adm, await application_id(client, sub), decision="reject",
                     feedback="We could not confirm you work at this company.", internalNote="Called HR: unknown")
    assert r.status_code == 200, r.text
    assert await company_row(client, org) == before
    view = (await boot(client, sub))["onboarding"]
    assert view["access"]["status"] == "rejected" and view["application"]["feedback"].startswith("We could not")
    assert "Called HR" not in json.dumps(view)


async def test_search_shows_associated_users_only_as_permitted(client):  # noqa: F811
    adm = await admin(client)
    owner, org = await approved_company(client, adm)
    name = (await company_row(client, org))["display_name"]
    stranger = f"user_str_{_t()}"
    items = (await client.get("/manufacturer/companies/search", headers=hdr(client, stranger),
                              params={"q": name})).json()["items"]
    hit = next(i for i in items if i["id"] == org)
    assert hit["registeredUsers"] == 1 and hit["primaryUser"] is None   # a count, never names / emails
    assert "@" not in json.dumps(items)
    mine = next(i for i in (await client.get("/manufacturer/companies/search", headers=hdr(client, owner),
                                             params={"q": name})).json()["items"] if i["id"] == org)
    assert mine["primaryUser"] == "Owner Rao"
