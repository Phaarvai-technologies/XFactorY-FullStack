"""End-to-end test of the Visionaries portal API against a real Postgres loaded with
XY_Database_Schema.sql + migrations (including 012_visionary_portal.sql).

Covers: the four flow steps, manufacturer discovery, request drafts, sending a request,
the manufacturer seeing and answering it in its own dashboard, persistence across
sign-ins, validation, and ownership/permission checks.

Run:  E2E_DATABASE_URL=postgresql+asyncpg://postgres@localhost:5433/xy \
      PYTHONPATH=. python -m pytest tests/test_visionary_e2e.py -q
Skipped automatically when E2E_DATABASE_URL is not set.
"""
import uuid

import pytest

from test_e2e_local import DB, PNG, client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not DB, reason="E2E_DATABASE_URL not set")

ACCOUNT = {"firstName": "Meera", "lastName": "Iyer", "contact": "9876543210", "dob": "1990-01-15",
           "companyName": "Kaveri Moulding Works", "companyType": "Consumer Products",
           "country": "India", "phone": "+91 98765 43210", "capacity": "12,500 units/month"}
PROFILE = {
    "company": {"name": "Kaveri Moulding Works", "logo": PNG, "cover": None, "about": "Injection moulded cups.",
                "vision": "", "estYear": "2009", "employees": "80", "businessType": "Private Limited",
                "orgSize": "Medium (50–249 employees)"},
    "location": {"address": "7 SIDCO Estate", "city": "Chennai", "state": "Tamil Nadu", "country": "India",
                 "zip": "600032", "pin": None, "sez": "Not in SEZ", "serviceableAreas": []},
    "certifications": [{"name": "ISO 9001", "body": "BSI", "fileName": "", "status": "Pending"}],
    "infra": {"electricity": "", "water": "", "storage": "", "packaging": "", "waste": "", "qa": ""},
    "faqs": [],
}
MACHINE = {"industry": "Packaging", "subcategory": "Paper cups", "type": "Injection Moulding", "capacity": "5000",
           "age": "3", "condition": "Good", "technical": "Engel 220T", "images": [], "rawMatStatus": "",
           "materialDetails": "PP", "laborType": "", "workerCount": "", "workerRoles": "", "logistics": [],
           "logisticsPartner": "", "pricing": {"hour": "", "day": "", "month": "", "unit": "", "batch": ""},
           "insurance": ""}
VISIONARY = {"name": "Priya Raman", "role": "Entrepreneur", "org": "Brew Co", "location": "Chennai",
             "intro": "Cups for cafés."}
IDEA = {"project": "Customized Coffee Cups", "idea": "Branded cups for cafés.",
        "product": "Printed paper coffee cups", "industry": "Food & Beverage"}
NEEDS = {"manufacturing_location": "Chennai", "quantity": {"value": 1000, "unit": "units"},
         "budget": {"amount": 200000, "currency": "INR"}, "timeline": "1_3_months",
         "additional_requirements": "Food-grade ink"}


def auth(client, sub):
    return {"Authorization": f"Bearer {client.token_for(sub)}"}


async def make_manufacturer(client, publish=True):
    """The fixture's own user becomes a manufacturer with a published machine."""
    assert (await client.post("/manufacturer/account", json=ACCOUNT)).status_code == 201
    assert (await client.put("/manufacturer/profile", json=PROFILE)).status_code == 200
    if publish:
        r = await client.post("/manufacturer/machinery", json={**MACHINE, "status": "Published"})
        assert r.status_code == 201, r.text
        r = await client.post("/manufacturer/machinery", json={**MACHINE, "type": "Lathe", "status": "Draft"})
        assert r.status_code == 201, r.text
    org = (await client.sql("""SELECT o.id FROM organizations o JOIN memberships m ON m.organization_id=o.id
                               JOIN users u ON u.id=m.user_id WHERE u.clerk_user_id=:c
                               AND o.organization_type='manufacturer'""", c=client.user))[0][0]
    return str(org)


async def test_visionary_flow_end_to_end(client):
    org = await make_manufacturer(client)
    v = auth(client, f"vis_{uuid.uuid4().hex[:10]}")

    # --- signed out
    assert (await client.get("/visionary/me", headers={"Authorization": ""})).status_code == 401

    # --- first visit: nothing saved yet
    r = await client.get("/visionary/me", headers=v)
    assert r.status_code == 200, r.text
    assert r.json() == {"profile": None, "idea": None, "stage": "", "requirements": None, "requests": []}

    # --- step 1: validation, then save
    r = await client.put("/visionary/profile", headers=v, json={**VISIONARY, "name": "  "})
    assert r.status_code == 422
    r = await client.put("/visionary/profile", headers=v, json={**VISIONARY, "intro": "x" * 301})
    assert r.status_code == 422
    r = await client.put("/visionary/profile", headers=v, json=VISIONARY)
    assert r.status_code == 200, r.text
    assert r.json()["profile"] == VISIONARY

    # --- step 2: "Save & Next" needs all fields; "Previous" keeps partial input
    r = await client.put("/visionary/project/idea", headers=v, json={**IDEA, "product": "", "complete": True})
    assert r.status_code == 422
    r = await client.put("/visionary/project/stage", headers=v, json={"stage": "Design Stage"})
    assert r.status_code == 409  # no project yet
    r = await client.put("/visionary/project/idea", headers=v, json={**IDEA, "product": "", "complete": False})
    assert r.status_code == 200 and r.json()["idea"]["product"] == ""
    r = await client.put("/visionary/project/idea", headers=v, json=IDEA)
    assert r.status_code == 200 and r.json()["idea"] == IDEA

    # --- step 3
    assert (await client.put("/visionary/project/stage", headers=v, json={"stage": "Someday"})).status_code == 422
    r = await client.put("/visionary/project/stage", headers=v, json={"stage": "Prototype Stage"})
    assert r.status_code == 200 and r.json()["stage"] == "Prototype Stage"

    # --- step 4
    r = await client.put("/visionary/project/requirements", headers=v, json={**NEEDS, "timeline": ""})
    assert r.status_code == 422
    r = await client.put("/visionary/project/requirements", headers=v,
                         json={**NEEDS, "quantity": {"value": -5, "unit": "units"}})
    assert r.status_code == 422
    r = await client.put("/visionary/project/requirements", headers=v, json=NEEDS)
    assert r.status_code == 200, r.text
    assert r.json()["requirements"] == NEEDS
    status = await client.sql("""SELECT op.status FROM opportunities op JOIN visionary_projects vp
                                 ON vp.opportunity_id=op.id WHERE op.title='Customized Coffee Cups'
                                 ORDER BY op.created_at DESC LIMIT 1""")
    assert status[0][0] == "active"

    # --- find a manufacturer: only published machines, public fields only
    r = await client.get("/visionary/manufacturers", headers=v)
    assert r.status_code == 200, r.text
    card = next(m for m in r.json() if m["id"] == org)
    assert card["name"] == "Kaveri Moulding Works" and card["location"] == "Chennai, Tamil Nadu"
    assert card["machines"] == ["Injection Moulding"] and card["products"] == ["Paper cups"]
    assert card["capabilities"] == "Packaging" and card["category"] == "Consumer Products"
    assert card["capacity"] == 12500 and card["availability"] == "Available" and card["verified"] is False
    assert card["logo"].startswith("https://proj.supabase.co/storage/v1/object/public/")
    r = await client.get(f"/visionary/manufacturers/{org}", headers=v)
    assert r.status_code == 200
    profile = r.json()["profile"]
    assert profile["address"] == "" and "7 SIDCO" not in r.text and "9876543210" not in r.text
    assert profile["established"] == "2009" and profile["materials"] == ["PP"]
    assert profile["certifications"] == [{"name": "ISO 9001", "body": "BSI", "status": "Pending"}]
    assert (await client.get(f"/visionary/manufacturers/{uuid.uuid4()}", headers=v)).status_code == 404
    assert (await client.get("/visionary/manufacturers/not-a-uuid", headers=v)).status_code == 404

    # --- request form "Save" (draft), kept on the server
    assert (await client.get(f"/visionary/manufacturers/{org}/draft", headers=v)).json() is None
    r = await client.put(f"/visionary/manufacturers/{org}/draft", headers=v,
                         json={"machine": "Injection Moulding", "quantity": {"value": 500, "unit": "units"},
                               "required_duration": "", "manufacturing_location": "Chennai",
                               "budget": {"amount": 0, "currency": "INR"}, "timeline": "",
                               "additional_requirements": ""})
    assert r.status_code == 200, r.text
    draft = (await client.get(f"/visionary/manufacturers/{org}/draft", headers=v)).json()
    assert draft["machine"] == "Injection Moulding" and draft["quantity"]["value"] == 500

    # --- send: validation
    send = {"manufacturer_id": org, "machine": "Injection Moulding", "quantity": {"value": 1000, "unit": "units"},
            "required_duration": "1_month", "manufacturing_location": "Chennai",
            "budget": {"amount": 200000, "currency": "INR"}, "timeline": "1_3_months",
            "additional_requirements": "Food-grade ink"}
    assert (await client.post("/visionary/requests", headers=v,
                              json={**send, "machine": "Lathe"})).status_code == 422  # unpublished machine
    assert (await client.post("/visionary/requests", headers=v,
                              json={**send, "required_duration": "forever"})).status_code == 422
    assert (await client.post("/visionary/requests", headers=v,
                              json={**send, "budget": {"amount": 0, "currency": "INR"}})).status_code == 422
    assert (await client.post("/visionary/requests", headers=v,
                              json={**send, "manufacturer_id": str(uuid.uuid4())})).status_code == 404

    # --- send
    r = await client.post("/visionary/requests", headers=v, json=send)
    assert r.status_code == 201, r.text
    sent = r.json()
    assert sent["status"] == "submitted" and sent["request_id"].startswith("REQ-")
    assert sent["manufacturer_name"] == "Kaveri Moulding Works" and sent["visionary"] == "Priya Raman"
    assert sent["project_name"] == "Customized Coffee Cups" and sent["quantity"] == {"value": 1000, "unit": "units"}
    assert (await client.get(f"/visionary/manufacturers/{org}/draft", headers=v)).json() is None

    # --- the manufacturer sees it in its existing dashboard and accepts it
    r = await client.get("/manufacturer/bootstrap")
    booking = r.json()["state"]["bookings"][0]
    assert booking["buyer"] == "Brew Co" and booking["status"] == "New"
    assert booking["item"] == "Injection Moulding — Customized Coffee Cups (1,000 units)"
    r = await client.patch(f"/manufacturer/booking-requests/{booking['id']}", json={"status": "accepted"})
    assert r.status_code == 200, r.text

    # --- persisted: a new sign-in (new token) gets everything back, with the new status
    r = await client.get("/visionary/me", headers=v)
    me = r.json()
    assert me["profile"] == VISIONARY and me["idea"] == IDEA and me["stage"] == "Prototype Stage"
    assert me["requirements"] == NEEDS
    assert [x["status"] for x in me["requests"]] == ["Accepted"]
    assert (await client.get(f"/visionary/requests/{sent['id']}", headers=v)).json()["status"] == "Accepted"

    # --- database: request linked to engagement, opportunity and both organizations
    row = (await client.sql("""
        SELECT e.request_type, e.opportunity_id IS NOT NULL, demand.organization_type, br.unit_code,
               br.requested_capacity, op.status, d.machine_id IS NOT NULL,
               (SELECT count(*) FROM engagement_participants ep WHERE ep.engagement_id=e.id),
               (SELECT count(*) FROM marketplace_role_selections s JOIN users u ON u.id=s.user_id
                 JOIN visionary_profiles p ON p.user_id=u.id
                 WHERE p.organization_id=demand.id AND s.role_selected='demand_requester' AND s.status='active')
        FROM manufacturer_booking_requests br
        JOIN engagements e ON e.id=br.engagement_id
        JOIN organizations demand ON demand.id=br.demand_organization_id
        JOIN visionary_request_details d ON d.booking_request_id=br.id
        JOIN opportunities op ON op.id=e.opportunity_id
        WHERE br.id=:id""", id=sent["id"]))[0]
    assert tuple(row) == ("availability_request", True, "buyer", "units", 1000, "matched", True, 2, 1)

    # --- other Visionaries cannot see or touch it
    w = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    assert (await client.get(f"/visionary/requests/{sent['id']}", headers=w)).status_code == 404
    assert (await client.get("/visionary/requests", headers=w)).json() == []
    assert (await client.get("/visionary/me", headers=w)).json()["profile"] is None
    assert (await client.get(f"/visionary/manufacturers/{org}/draft", headers=w)).json() is None


async def test_permissions_and_discovery_rules(client):
    org = await make_manufacturer(client)

    # A manufacturer cannot send a request to its own company.
    assert (await client.put("/visionary/profile", json=VISIONARY)).status_code == 200
    assert (await client.put("/visionary/project/idea", json=IDEA)).status_code == 200
    r = await client.post("/visionary/requests", json={
        "manufacturer_id": org, "machine": "Injection Moulding", "quantity": {"value": 10, "unit": "units"},
        "required_duration": "1_week", "manufacturing_location": "Chennai",
        "budget": {"amount": 1000, "currency": "INR"}, "timeline": "immediately"})
    assert r.status_code == 403

    # No project yet -> request refused with a clear message.
    v = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    r = await client.post("/visionary/requests", headers=v, json={
        "manufacturer_id": org, "machine": "Injection Moulding", "quantity": {"value": 10, "unit": "units"},
        "required_duration": "1_week", "manufacturing_location": "Chennai",
        "budget": {"amount": 1000, "currency": "INR"}, "timeline": "immediately"})
    assert r.status_code == 409 and "project" in r.json()["detail"]

    # Archived by an admin -> no longer listed; suspended owner -> no longer listed.
    ids = lambda resp: {m["id"] for m in resp.json()}  # noqa: E731
    assert org in ids(await client.get("/visionary/manufacturers", headers=v))
    await client.sql("UPDATE organizations SET is_archived=true WHERE id=CAST(:o AS uuid)", o=org)
    assert org not in ids(await client.get("/visionary/manufacturers", headers=v))
    assert (await client.get(f"/visionary/manufacturers/{org}", headers=v)).status_code == 404
    await client.sql("UPDATE organizations SET is_archived=false WHERE id=CAST(:o AS uuid)", o=org)
    await client.sql("UPDATE users SET status='suspended' WHERE clerk_user_id=:c", c=client.user)
    assert org not in ids(await client.get("/visionary/manufacturers", headers=v))
    # ...and a suspended user cannot use the Visionary API either.
    assert (await client.get("/visionary/me")).status_code == 403
    await client.sql("UPDATE users SET status='active' WHERE clerk_user_id=:c", c=client.user)


async def test_manufacturer_without_machines_offers_catalog(client):
    org = await make_manufacturer(client, publish=False)
    v = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    assert (await client.put("/visionary/project/idea", headers=v, json=IDEA)).status_code == 200
    card = next(m for m in (await client.get("/visionary/manufacturers", headers=v)).json() if m["id"] == org)
    assert card["machines"] == []
    send = {"manufacturer_id": org, "machine": "CNC Milling", "quantity": {"value": 5, "unit": "units"},
            "required_duration": "2_weeks", "manufacturing_location": "Pune",
            "budget": {"amount": 5000, "currency": "INR"}, "timeline": "within_1_month"}
    r = await client.post("/visionary/requests", headers=v, json=send)
    assert r.status_code == 201, r.text
    # No visionary profile saved: the user's name is used as the requester.
    assert r.json()["visionary"] == "Jordan Lee"
    assert (await client.post("/visionary/requests", headers=v,
                              json={**send, "machine": "Teleporter"})).status_code == 422
