"""Manufacturer profile: serviceable areas, certifications and the capacity plan are
saved and come back exactly as entered (save -> database -> reload), against a real
Postgres. Skipped when E2E_DATABASE_URL is not set."""
import pytest

from test_e2e_local import DB, client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not DB, reason="E2E_DATABASE_URL not set")

ACCOUNT = {"firstName": "Ravi", "lastName": "Kumar", "contact": "9876501234", "dob": "1988-03-12",
           "companyName": "Ravi Precision", "companyType": "Automotive & Machinery",
           "country": "India", "phone": "", "capacity": "800 units/month"}


async def bootstrap(client):
    r = await client.get("/manufacturer/bootstrap")
    assert r.status_code == 200, r.text
    return r.json()


async def test_serviceable_areas_and_certifications_round_trip(client):
    assert (await client.post("/manufacturer/account", json=ACCOUNT)).status_code == 201

    # Location step: serviceable areas sent together with the address (as the wizard does)
    r = await client.patch("/manufacturer/profile", json={
        "location": {"address": "4 Ring Rd", "city": "Coimbatore", "country": "India",
                     "serviceableAreas": ["Coimbatore", "Tamil Nadu", "South India"]},
        "progress": {"step": 3, "completed": True, "nextStep": 4}})
    assert r.status_code == 200, r.text
    data = await bootstrap(client)
    assert data["profileData"]["location"]["serviceableAreas"] == ["Coimbatore", "Tamil Nadu", "South India"]
    assert data["state"]["serviceableAreas"] == ["Coimbatore", "Tamil Nadu", "South India"]

    # Removing one area is saved too; other location fields are untouched
    r = await client.patch("/manufacturer/profile", json={
        "location": {"serviceableAreas": ["Coimbatore", "South India"]}})
    assert r.status_code == 200, r.text
    loc = (await bootstrap(client))["profileData"]["location"]
    assert loc["serviceableAreas"] == ["Coimbatore", "South India"] and loc["city"] == "Coimbatore"

    # Certifications: names come back exactly as typed, even when another spelling of the
    # same name already exists as a shared type ("ISO 9001" vs "iso 9001").
    await client.sql("INSERT INTO certification_types(code,name) VALUES ('ISO_9001','ISO 9001') "
                     "ON CONFLICT (code) DO NOTHING")
    certs = [{"name": "iso 9001", "body": "BSI", "fileName": "iso.pdf", "status": "Pending"},
             {"name": "ISO 9001:2015", "body": "TUV", "fileName": "", "status": "Pending"}]
    r = await client.patch("/manufacturer/profile", json={
        "certifications": certs, "progress": {"step": 4, "completed": True, "nextStep": 5}})
    assert r.status_code == 200, r.text
    data = await bootstrap(client)
    assert data["profileData"]["certifications"] == certs
    assert data["profileProgress"]["checklist"]["certsDone"] is True   # dashboard marks it
    assert 4 in data["profileProgress"]["completedSteps"]

    # Saving the same list again does not duplicate rows
    r = await client.patch("/manufacturer/profile", json={"certifications": certs})
    assert (await bootstrap(client))["profileData"]["certifications"] == certs


async def test_capacity_plan_uses_own_machinery(client):
    assert (await client.post("/manufacturer/account", json=ACCOUNT)).status_code == 201
    machine = {"industry": "Automotive", "subcategory": "Machining", "type": "VMC 850", "capacity": "",
               "age": "", "condition": "", "technical": "", "images": [], "rawMatStatus": "",
               "materialDetails": "", "laborType": "", "workerCount": "", "workerRoles": "", "logistics": [],
               "logisticsPartner": "", "pricing": {"hour": "", "day": "", "month": "", "unit": "", "batch": ""},
               "insurance": ""}
    assert (await client.post("/manufacturer/machinery", json={**machine, "status": "Published"})).status_code == 201
    data = await bootstrap(client)
    assert [m["type"] for m in data["state"]["machinery"]] == ["VMC 850"]   # what the select lists

    plan = {"machine": "VMC 850", "count": "2", "start": "2026-11-01", "end": "2026-11-30"}
    r = await client.patch("/manufacturer/availability", json={"capacity": plan})
    assert r.status_code == 200, r.text
    assert (await bootstrap(client))["state"]["capacity"] == plan

    # Another manufacturer sees only its own machinery
    other = {"Authorization": f"Bearer {client.token_for('user_other_mfr_' + client.user)}"}
    r = await client.post("/manufacturer/account", headers=other, json={**ACCOUNT, "companyName": "Other Co"})
    assert r.status_code == 201, r.text
    r = await client.get("/manufacturer/bootstrap", headers=other)
    assert r.json()["state"]["machinery"] == [] and r.json()["state"]["capacity"] is None
