"""Step-by-step saving of the multi-step forms (real PostgreSQL; skipped without E2E_DATABASE_URL).

Company Profile wizard (5 steps), Machinery wizard (7 steps) and Availability."""
import asyncio
import os
import uuid

import pytest

from test_e2e_local import ACCOUNT, PNG, PNG2, client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")

ORG = """(SELECT o.id FROM organizations o JOIN memberships m ON m.organization_id=o.id
          JOIN users us ON us.id=m.user_id WHERE us.clerk_user_id=:u AND o.organization_type='manufacturer')"""


async def count(client, sql):
    return (await client.sql(sql, u=client.user))[0][0]


async def step(client, body, expect=200):
    r = await client.patch("/manufacturer/profile", json=body)
    assert r.status_code == expect, r.text
    return r.json()


async def test_company_profile_saves_every_step(client):
    assert (await client.post("/manufacturer/account", json=ACCOUNT)).status_code == 201
    p = (await client.get("/manufacturer/bootstrap")).json()["profileProgress"]
    assert p["completedSteps"] == [] and p["resumeStep"] == 1 and p["status"] == "draft" and p["percentage"] == 15

    # Step 1 (Get started) -> the draft progress record is created
    p = (await step(client, {"progress": {"step": 1, "completed": True}}))["profileProgress"]
    assert p["completedSteps"] == [1] and p["currentStep"] == 2 and p["status"] == "draft"
    assert await count(client, f"SELECT count(*) FROM manufacturer_form_progress WHERE organization_id={ORG}") == 1

    # Step 2 fails server validation -> 422 and NOTHING from the request is saved
    r = await client.patch("/manufacturer/profile", json={"company": {"name": "Only Name Ltd"},
                                                           "progress": {"step": 2, "completed": True}})
    assert r.status_code == 422 and "about your company" in r.json()["detail"]
    body = (await client.get("/manufacturer/bootstrap")).json()
    assert body["profileData"]["company"]["name"] == ACCOUNT["companyName"]          # not saved
    assert body["profileProgress"]["completedSteps"] == [1]                            # not advanced

    # Step 2 valid -> saved; dashboard percentage comes from saved data
    body = await step(client, {"company": {"name": "Raman Precision", "about": "Precision parts"},
                               "progress": {"step": 2, "completed": True}})
    assert body["profileData"]["company"]["about"] == "Precision parts"
    assert body["profileProgress"]["completedSteps"] == [1, 2] and body["profileProgress"]["resumeStep"] == 3
    assert body["profileProgress"]["percentage"] == 32 and body["profileProgress"]["checklist"]["companyDetailsDone"]

    # Skip step 3: position saved, step NOT completed; resume still points at it
    p = (await step(client, {"progress": {"step": 3, "completed": False}}))["profileProgress"]
    assert p["currentStep"] == 4 and p["completedSteps"] == [1, 2] and p["resumeStep"] == 3

    # Steps 4 and 5
    await step(client, {"certifications": [{"name": "ISO 9001", "body": "BSI", "fileName": "", "status": "Pending"}],
                        "progress": {"step": 4, "completed": True}})
    p = (await step(client, {"infra": {"water": "Borewell"}, "faqs": [{"q": "MOQ?", "a": "100"}],
                             "progress": {"step": 5, "completed": True}}))["profileProgress"]
    assert p["completedSteps"] == [1, 2, 4, 5] and p["status"] == "draft" and p["resumeStep"] == 3

    # Refresh and sign in again -> continue from the last incomplete step (3)
    client.headers["Authorization"] = f"Bearer {client.make_token()}"
    p = (await client.get("/manufacturer/bootstrap")).json()["profileProgress"]
    assert p["resumeStep"] == 3 and p["completedSteps"] == [1, 2, 4, 5]

    # Duplicate submission of the same step: no duplicate step, no duplicate record
    loc = {"location": {"address": "Plot 12", "city": "Chennai", "country": "India"},
           "progress": {"step": 3, "completed": True}}
    await asyncio.gather(*(client.patch("/manufacturer/profile", json=loc) for _ in range(3)))
    p = (await client.get("/manufacturer/bootstrap")).json()["profileProgress"]
    assert sorted(p["completedSteps"]) == [1, 2, 3, 4, 5] and p["status"] == "completed" and p["percentage"] == 100
    assert await count(client, f"SELECT count(*) FROM manufacturer_form_progress WHERE organization_id={ORG}") == 1
    assert await count(client, f"SELECT count(*) FROM facilities WHERE organization_id={ORG} AND is_headquarters") == 1
    row = await client.sql(f"""SELECT completion_percentage, location_completed FROM manufacturer_onboarding
                               WHERE organization_id={ORG}""", u=client.user)
    assert tuple(row[0]) == (100, True)


async def test_machinery_wizard_saves_every_step(client):
    assert (await client.post("/manufacturer/account", json=ACCOUNT)).status_code == 201
    key = str(uuid.uuid4())
    step1 = {"clientKey": key, "industry": "Automotive & Machinery", "type": "5-axis CNC mill",
             "capacity": "100", "condition": "Good", "progress": {"step": 1, "completed": True}}

    # Validation failure -> 422, no record created
    r = await client.post("/manufacturer/machinery/drafts", json={**step1, "type": ""})
    assert r.status_code == 422
    assert await count(client, f"SELECT count(*) FROM machines WHERE organization_id={ORG}") == 0

    # Step 1 -> draft created once, even for repeated/concurrent submissions
    results = await asyncio.gather(*(client.post("/manufacturer/machinery/drafts", json=step1) for _ in range(3)))
    assert all(x.status_code == 201 for x in results), [x.text for x in results]
    body = results[0].json()
    draft = body["machineryDraft"]
    assert draft["resumeStep"] == 2 and draft["data"]["type"] == "5-axis CNC mill"
    assert body["state"]["machinery"] == []                  # an unfinished wizard is not a listing
    assert await count(client, f"SELECT count(*) FROM machines WHERE organization_id={ORG}") == 1
    mid = draft["id"]

    async def save(payload, expect=200):
        r = await client.patch(f"/manufacturer/machinery/{mid}", json=payload)
        assert r.status_code == expect, r.text
        return r.json()

    # Step 2 images, step 3 raw materials, step 4 labour: only changed fields each time
    body = await save({"images": [{"src": PNG, "primary": True}, {"src": PNG2, "primary": False}],
                       "progress": {"step": 2, "completed": True}})
    images = body["machineryDraft"]["data"]["images"]
    assert len(images) == 2 and images[0]["src"].startswith("https://")
    await save({"materialDetails": "Al 6061", "progress": {"step": 3, "completed": True}})
    body = await save({"workerCount": "3", "progress": {"step": 4, "completed": True}})
    d = body["machineryDraft"]
    assert d["data"]["capacity"] == "100" and d["data"]["condition"] == "Good"   # step-1 values untouched
    assert d["data"]["materialDetails"] == "Al 6061" and d["resumeStep"] == 5

    # Refresh / sign in again -> resume the same draft at the last incomplete step
    client.headers["Authorization"] = f"Bearer {client.make_token()}"
    d = (await client.get("/manufacturer/bootstrap")).json()["machineryDraft"]
    assert d["id"] == mid and d["resumeStep"] == 5 and d["completedSteps"] == [1, 2, 3, 4]

    # Resumed wizard sends the image URLs back unchanged -> no re-upload, same files
    uploads = len(client.uploads)
    await save({"images": d["data"]["images"], "logistics": ["Local", "National"],
                "progress": {"step": 5, "completed": True}})
    assert len(client.uploads) == uploads
    # Clearing a field explicitly; a required field can't be blanked
    await save({"capacity": "", "pricing": {"hour": "1500", "day": "", "month": "", "unit": "", "batch": ""},
                "progress": {"step": 6, "completed": True}})
    await save({"type": ""}, expect=422)

    # Step 7: Publish -> listing appears, draft closed
    body = await save({"finish": "Published"})
    assert body["machineryDraft"] is None
    [m] = body["state"]["machinery"]
    assert m["id"] == mid and m["status"] == "Published" and m["capacity"] == "" and m["pricing"]["hour"] == "1500"
    assert m["materialDetails"] == "Al 6061" and m["logistics"] == ["Local", "National"] and len(m["images"]) == 2
    status = await client.sql("SELECT status, completed_steps FROM manufacturer_form_progress WHERE record_id=CAST(:m AS uuid)",
                              u=client.user, m=mid)
    assert status[0][0] == "completed" and 7 in status[0][1]
    assert await count(client, f"SELECT count(*) FROM machines WHERE organization_id={ORG}") == 1


async def test_availability_patch_only_changes_what_was_sent(client):
    assert (await client.post("/manufacturer/account", json=ACCOUNT)).status_code == 201
    rec = {"days": ["Mon", "Tue"], "start": "09:00", "end": "17:00"}
    cap = {"machine": "Lathe", "count": "2", "start": "2026-10-01", "end": "2026-10-31"}
    await client.patch("/manufacturer/availability", json={"calendar": {"2026-10-1": "available"}})
    await client.patch("/manufacturer/availability", json={"recurring": rec})
    s = (await client.patch("/manufacturer/availability", json={"capacity": cap})).json()["state"]
    assert s["calendar"] == {"2026-10-1": "available"} and s["recurring"] == rec and s["capacity"] == cap
