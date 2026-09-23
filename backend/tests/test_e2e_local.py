"""End-to-end test of every endpoint the frontend calls, against a real Postgres
loaded with XY_Database_Schema.sql + migrations.

Run:  E2E_DATABASE_URL=postgresql+asyncpg://postgres@localhost:5433/xy \
      PYTHONPATH=. python -m pytest tests/test_e2e_local.py -q
Skipped automatically when E2E_DATABASE_URL is not set.
"""
import base64
import hashlib
import os
import time
import uuid

import pytest

DB = os.environ.get("E2E_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB, reason="E2E_DATABASE_URL not set")

PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()
PNG2 = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"1" * 64).decode()


@pytest.fixture
async def client(monkeypatch):
    import httpx
    import jwt
    from cryptography.hazmat.primitives.asymmetric import rsa
    from sqlalchemy import text

    from app.core import auth, clerk
    from app.core.database import engine
    from app.main import app
    from app.storage import supabase

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class FakeJwks:
        def get_signing_key_from_jwt(self, _):
            return type("K", (), {"key": key.public_key()})()

    monkeypatch.setattr(auth, "_jwks_client", lambda url: FakeJwks())
    uploads = []

    async def fake_upload(self, image, prefix):
        uploads.append(prefix)
        k = f"{prefix}/{uuid.uuid4()}.{image.extension}"
        return supabase.UploadedObject(k, k.rsplit("/", 1)[-1], image.content_type, len(image.raw),
                                       image.checksum, self.public_url(k))

    monkeypatch.setattr(supabase.SupabaseStorage, "upload", fake_upload)
    user = f"user_{uuid.uuid4().hex[:10]}"

    async def fake_profile(self, actor):
        return {"email": f"{actor.clerk_user_id}@example.com", "phone": None, "first_name": "Jordan",
                "last_name": "Lee", "organization_name": "Jordan Lee"}

    monkeypatch.setattr(clerk.ClerkManagement, "actor_profile", fake_profile)

    from app.identity import auth as identity_auth

    async def fake_fetch_user(clerk_user_id, settings):
        return {"first_name": "Jordan", "last_name": "Lee", "primary_email_address_id": "e1",
                "email_addresses": [{"id": "e1", "email_address": f"{clerk_user_id}@example.com",
                                     "verification": {"status": "verified"}}]}

    monkeypatch.setattr(identity_auth, "_fetch_clerk_user", fake_fetch_user)
    token = jwt.encode({"sub": user, "iat": int(time.time()), "exp": int(time.time()) + 600,
                        "iss": os.environ["CLERK_ISSUER"], "azp": "http://localhost:3000"},
                       key, algorithm="RS256")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t/api/v1",
                                 headers={"Authorization": f"Bearer {token}"}) as c:
        c.uploads = uploads
        c.user = user
        c.make_token = lambda: jwt.encode(
            {"sub": user, "iat": int(time.time()), "exp": int(time.time()) + 600,
             "iss": os.environ["CLERK_ISSUER"], "azp": "http://localhost:3000"}, key, algorithm="RS256")
        c.sql = lambda q, **p: _sql(engine, text(q), p)
        yield c
    await engine.dispose()


async def _sql(engine, q, p):
    async with engine.begin() as conn:
        r = await conn.execute(q, p)
        return r.fetchall() if r.returns_rows else None


async def test_full_frontend_flow(client):
    # --- no token
    import httpx
    r = await client.get("/manufacturer/bootstrap", headers={"Authorization": ""})
    assert r.status_code == 401

    # --- first dashboard load: user synced, no account yet
    r = await client.get("/manufacturer/bootstrap")
    assert r.status_code == 200, r.text
    assert r.json()["accountExists"] is False

    # --- AccountScreen submit (exact AccountSubmission)
    r = await client.post("/manufacturer/account", json={
        "firstName": "Jordan", "lastName": "Ellis", "contact": "9876543210", "dob": "1992-06-20",
        "companyName": "Ellis Manufacturing", "companyType": "Automotive & Machinery",
        "country": "Other", "phone": "+91 98765 43210", "capacity": "12,500 units/month"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["accountExists"] is True
    acc = body["state"]["account"]
    assert acc == {"firstName": "Jordan", "lastName": "Ellis", "companyName": "Ellis Manufacturing",
                   "companyType": "Automotive & Machinery", "country": "Other", "dob": "1992-06-20",
                   "phone": "+91 98765 43210", "capacity": "12,500 units/month"}
    assert body["state"]["contact"] == {"email": "", "phone": "+91 98765 43210"}
    assert body["state"]["bookings"] == []

    # --- ProfileWizard saves (same logo sent repeatedly -> uploaded once)
    profile = {
        "company": {"name": "Ellis Manufacturing", "logo": PNG, "cover": None, "about": "We machine parts.",
                    "vision": "Quality", "estYear": "2005", "employees": "120", "businessType": "Private Limited",
                    "orgSize": "Medium (50–249 employees)"},
        "location": {"address": "12 Industrial Rd", "city": "Chennai", "state": "Tamil Nadu", "country": "India",
                     "zip": "600001", "pin": "13.0827, 80.2707", "sez": "Within SEZ",
                     "serviceableAreas": ["Chennai", "Bengaluru"]},
        "certifications": [{"name": "ISO 9001", "body": "BSI", "fileName": "iso.pdf", "status": "Pending"},
                           {"name": "CE", "body": "TUV", "fileName": "", "status": "Pending"}],
        "infra": {"electricity": "3-phase 400kVA", "water": "", "storage": "", "packaging": "", "waste": "", "qa": "CMM"},
        "faqs": [{"q": "MOQ?", "a": "100"}, {"q": "Lead time?", "a": "2 weeks"}],
    }
    for _ in range(3):
        r = await client.put("/manufacturer/profile", json=profile)
        assert r.status_code == 200, r.text
    assert len(client.uploads) == 1, client.uploads
    pd = r.json()["profileData"]
    assert pd["company"]["logo"].startswith("https://proj.supabase.co/storage/v1/object/public/manufacturer-assets/")
    assert pd["location"]["pin"] == "13.0827, 80.2707"
    assert pd["location"]["country"] == "India"
    assert pd["location"]["serviceableAreas"] == ["Chennai", "Bengaluru"]
    assert [c["name"] for c in pd["certifications"]] == ["ISO 9001", "CE"]
    assert pd["certifications"][0]["fileName"] == "iso.pdf"
    assert pd["faqs"] == profile["faqs"]
    assert pd["infra"]["qa"] == "CMM"
    epic2 = r.json()["state"]["epic2"]
    assert epic2["companyDetailsDone"] and epic2["locationDone"] and epic2["infraDone"]

    # remove an FAQ + a certification; logo now the public URL (must be kept)
    profile["faqs"] = [{"q": "Lead time?", "a": "2 weeks"}]
    profile["certifications"] = profile["certifications"][1:]
    profile["company"]["logo"] = pd["company"]["logo"]
    r = await client.put("/manufacturer/profile", json=profile)
    pd = r.json()["profileData"]
    assert pd["faqs"] == [{"q": "Lead time?", "a": "2 weeks"}]
    assert [c["name"] for c in pd["certifications"]] == ["CE"]
    assert pd["company"]["logo"] is not None
    geo = await client.sql("SELECT ST_Y(location::geometry), ST_X(location::geometry) FROM facilities "
                           "WHERE map_pin='13.0827, 80.2707'")
    assert round(geo[-1][0], 4) == 13.0827

    # --- MachineryWizard publish (exact MachineryDraft + status)
    draft = {"industry": "Automotive", "subcategory": "Machining", "type": "5-axis CNC mill", "capacity": "100",
             "age": "5", "condition": "Good", "technical": "Haas UMC-750",
             "images": [{"src": PNG2, "primary": False}, {"src": PNG, "primary": True}],
             "rawMatStatus": "Provided", "materialDetails": "Al 6061", "laborType": "Skilled", "workerCount": "3",
             "workerRoles": "Operator", "logistics": ["Local", "National"], "logisticsPartner": "BlueDart",
             "pricing": {"hour": "1500", "day": "", "month": "", "unit": "", "batch": ""}, "insurance": "Yes"}
    r = await client.post("/manufacturer/machinery", json={**draft, "status": "Published"})
    assert r.status_code == 201, r.text
    r = await client.post("/manufacturer/machinery", json={**draft, "type": "Lathe", "images": [], "status": "Draft"})
    machinery = r.json()["state"]["machinery"]
    assert [m["type"] for m in machinery] == ["Lathe", "5-axis CNC mill"]
    cnc = machinery[1]
    assert cnc["status"] == "Published" and cnc["capacity"] == "100" and cnc["age"] == "5"
    assert cnc["logistics"] == ["Local", "National"] and cnc["pricing"]["hour"] == "1500"
    assert [i["primary"] for i in sorted(cnc["images"], key=lambda i: not i["primary"])] == [True, False]
    for key in draft:
        if key != "images":
            assert cnc[key] == draft[key], key

    for status in ("Unpublished", "Published", "Archived"):
        r = await client.patch(f"/manufacturer/machinery/{cnc['id']}/status", json={"status": status})
        assert r.status_code == 200 and r.json()["state"]["machinery"][1]["status"] == status
    r = await client.patch(f"/manufacturer/machinery/{uuid.uuid4()}/status", json={"status": "Published"})
    assert r.status_code == 404

    # --- availability (calendar keys are `${y}-${m}-${d}`)
    avail = {"calendar": {"2026-8-22": "available", "2026-8-23": "blocked"},
             "recurring": {"days": ["Mon", "Tue"], "start": "09:00", "end": "17:00"},
             "capacity": {"machine": "Lathe", "count": "2", "start": "2026-09-01", "end": "2026-09-30"}}
    r = await client.put("/manufacturer/availability", json=avail)
    assert r.status_code == 200, r.text
    s = r.json()["state"]
    assert s["calendar"] == avail["calendar"] and s["recurring"] == avail["recurring"]
    assert s["capacity"] == avail["capacity"]

    # --- booking requests (seed two from a buyer org)
    org = (await client.sql("SELECT organization_id FROM facilities WHERE map_pin='13.0827, 80.2707' "
                            "ORDER BY created_at DESC LIMIT 1"))[0][0]
    buyer = (await client.sql("INSERT INTO organizations(display_name,organization_type,status) "
                              "VALUES ('Orion Textiles','buyer','active') RETURNING id"))[0][0]
    ids = []
    for n in range(2):
        eng = (await client.sql("INSERT INTO engagements(demand_organization_id,supply_organization_id) "
                                "VALUES (:b,:m) RETURNING id", b=buyer, m=org))[0][0]
        ids.append(str((await client.sql(
            "INSERT INTO manufacturer_booking_requests(request_number,engagement_id,demand_organization_id,"
            "manufacturer_organization_id,requested_start_date,requirements) VALUES "
            "(:n,:e,:b,:m,'2026-09-20','CNC Machining — batch run') RETURNING id",
            n=f"BR-{uuid.uuid4().hex[:8]}", e=eng, b=buyer, m=org))[0][0]))
    r = await client.get("/manufacturer/bootstrap")
    bk = {b["id"]: b for b in r.json()["state"]["bookings"]}
    assert bk[ids[0]] == {"id": ids[0], "buyer": "Orion Textiles", "item": "CNC Machining — batch run",
                          "date": "Sep 20, 2026", "status": "New"}
    r = await client.patch(f"/manufacturer/booking-requests/{ids[0]}", json={"status": "accepted"})
    assert {b["id"]: b["status"] for b in r.json()["state"]["bookings"]}[ids[0]] == "Booked"
    r = await client.patch(f"/manufacturer/booking-requests/{ids[0]}", json={"status": "declined"})
    assert {b["id"]: b["status"] for b in r.json()["state"]["bookings"]}[ids[0]] == "Cancelled"
    r = await client.patch(f"/manufacturer/booking-requests/{ids[1]}", json={"status": "declined"})
    assert {b["id"]: b["status"] for b in r.json()["state"]["bookings"]}[ids[1]] == "Cancelled"
    r = await client.patch(f"/manufacturer/booking-requests/{ids[1]}", json={"status": "accepted"})
    assert r.status_code == 422
    events = await client.sql("SELECT count(*) FROM manufacturer_booking_request_events "
                              "WHERE booking_request_id=CAST(:i AS uuid)", i=ids[0])
    assert events[0][0] == 3  # created, confirmed, cancelled

    # --- validation errors use FastAPI's {detail}
    r = await client.post("/manufacturer/account", json={"firstName": ""})
    assert r.status_code == 422 and "detail" in r.json()


async def test_token_with_clerk_organization(client, monkeypatch):
    """If Clerk Organizations are enabled later, `org_id` in the JWT is honoured."""
    from app.core import auth

    org = f"org_{uuid.uuid4().hex[:10]}"
    original = auth.jwt.decode

    def decode(*args, **kwargs):
        claims = original(*args, **kwargs)
        return {**claims, "o": {"id": org}}

    monkeypatch.setattr(auth.jwt, "decode", decode)
    r = await client.get("/manufacturer/bootstrap")
    assert r.status_code == 200, r.text
    rows = await client.sql("SELECT organization_type FROM organizations WHERE clerk_organization_id=:o", o=org)
    assert rows[0][0] == "manufacturer"


ACCOUNT = {"firstName": "Priya", "lastName": "Raman", "contact": "priya@factory.in", "dob": "1990-04-02",
           "companyName": "Raman Precision", "companyType": "Automotive & Machinery", "country": "India",
           "phone": "", "capacity": "5000 units/month"}


async def test_returning_manufacturer_keeps_roles_and_saved_details(client):
    """Sign up -> roles -> Manufacturer details once -> sign out -> sign in again."""
    # New user opens the roles page: nothing selected yet, no manufacturer account.
    r = await client.get("/identity/me")
    assert r.status_code == 200, r.text
    assert r.json()["roles"] == [] and r.json()["manufacturerAccountExists"] is False

    # Selects Manufacturer (+ Visionary) and presses Continue -> goes to the details form.
    r = await client.put("/identity/me/roles", json={"roles": ["manufacturer", "visionary"]})
    assert r.status_code == 200, r.text
    assert r.json() == {"roles": ["manufacturer", "visionary"], "manufacturerAccountExists": False}

    # Fills the Manufacturer details form once.
    r = await client.post("/manufacturer/account", json=ACCOUNT)
    assert r.status_code == 201, r.text

    # --- signs out, closes the browser, signs in again: a brand-new session token.
    client.headers["Authorization"] = f"Bearer {client.make_token()}"

    # Roles page shows the saved roles, and knows the account already exists.
    r = await client.get("/identity/me")
    assert r.json()["roles"] == ["manufacturer", "visionary"]
    assert r.json()["manufacturerAccountExists"] is True

    # Continue with Manufacturer -> dashboard with the saved data (form not shown again).
    r = await client.put("/identity/me/roles", json={"roles": ["manufacturer", "visionary"]})
    assert r.json()["manufacturerAccountExists"] is True
    r = await client.get("/manufacturer/bootstrap")
    body = r.json()
    assert body["accountExists"] is True
    assert body["state"]["account"]["companyName"] == "Raman Precision"
    assert body["state"]["account"]["capacity"] == "5000 units/month"
    assert body["state"]["contact"]["email"] == "priya@factory.in"

    # Deselecting a role is saved too.
    r = await client.put("/identity/me/roles", json={"roles": ["manufacturer"]})
    assert r.json()["roles"] == ["manufacturer"]
    r = await client.get("/identity/me")
    assert r.json()["roles"] == ["manufacturer"]


async def test_sample_bookings_come_from_the_database(client):
    r = await client.post("/manufacturer/account", json=ACCOUNT)
    assert r.status_code == 201, r.text
    assert r.json()["state"]["bookings"] == []  # new manufacturer: empty list

    from pathlib import Path

    from app.core.database import engine

    seed = Path(__file__).resolve().parents[1] / "database" / "seeds" / "sample_booking_requests.sql"
    async with engine.begin() as conn:
        await conn.exec_driver_sql(seed.read_text(encoding="utf-8"))
    added = await client.sql("SELECT xy_seed_sample_bookings(:e)", e=f"{client.user}@example.com")
    assert added[0][0] == 4
    again = await client.sql("SELECT xy_seed_sample_bookings(:e)", e=f"{client.user}@example.com")
    assert again[0][0] == 0  # idempotent

    r = await client.get("/manufacturer/bootstrap")
    bookings = [{k: v for k, v in b.items() if k != "id"} for b in r.json()["state"]["bookings"]]
    # Exactly the frontend's former INITIAL_BOOKINGS, now read from the database.
    assert bookings == [
        {"buyer": "Orion Textiles", "item": "CNC Machining — batch run", "date": "Sep 20, 2026", "status": "New"},
        {"buyer": "BluePeak Foods", "item": "Cold storage — 2 weeks", "date": "Sep 25, 2026", "status": "Reserved"},
        {"buyer": "Vertex Auto Parts", "item": "Injection molding line", "date": "Oct 2, 2026", "status": "Booked"},
        {"buyer": "Nimbus Packaging", "item": "Warehouse space — 500 sq ft", "date": "Sep 18, 2026",
         "status": "Cancelled"},
    ]

    # Accept the Reserved one ("Confirm booking") and cancel the Booked one.
    ids = {b["buyer"]: b["id"] for b in r.json()["state"]["bookings"]}
    r = await client.patch(f"/manufacturer/booking-requests/{ids['BluePeak Foods']}", json={"status": "accepted"})
    r = await client.patch(f"/manufacturer/booking-requests/{ids['Vertex Auto Parts']}", json={"status": "declined"})
    status = {b["buyer"]: b["status"] for b in r.json()["state"]["bookings"]}
    assert status["BluePeak Foods"] == "Booked" and status["Vertex Auto Parts"] == "Cancelled"
