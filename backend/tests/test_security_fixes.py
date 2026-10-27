"""Security fixes: admin role checks, approval-first gate, webhook email, uploads, health check."""
import base64
import json
import time
import uuid

import pytest

from test_e2e_local import client  # noqa: F401  (shared fixture)
from test_manufacturer_approval import MACHINE, PROFILE, account, hdr, own_org


def _tag():
    return uuid.uuid4().hex[:6]


async def _role(c, role):
    sub = f"adm_{role[:6]}_{_tag()}"
    h = hdr(c, sub)
    assert (await c.get("/identity/me", headers=h)).status_code == 200
    await c.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                   SELECT id, :r FROM users WHERE clerk_user_id=:s""", r=role, s=sub)
    return sub, h


async def _uid(c, sub):
    return str((await c.sql("SELECT id FROM users WHERE clerk_user_id=:s", s=sub))[0][0])


@pytest.fixture
def approval_first():
    """Approval first is always on now (migration 025); kept so the tests read the same."""


async def _new_company(c, name=None):
    sub = f"mfr_{_tag()}"
    h = hdr(c, sub)
    r = await c.post("/manufacturer/account", headers=h, json=account(name or f"Gate Co {_tag()}"))
    assert r.status_code == 201, r.text
    return sub, h, await own_org(c, sub)


# ---------------------------------------------------------------- admin roles
async def test_only_administrators_suspend_and_lower_roles_cannot_lock_out_admins(client):  # noqa: F811
    boss_sub, boss = await _role(client, "platform_administrator")
    for role in ("verification_analyst", "support_specialist", "platform_operator"):
        _, low = await _role(client, role)
        r = await client.post(f"/admin/users/{await _uid(client, boss_sub)}/suspend", headers=low,
                              json={"reason": "probe"})
        assert r.status_code == 403, (role, r.text)
        assert (await client.get("/admin/me", headers=boss)).status_code == 200
    user_sub, _, _ = await _new_company(client)
    r = await client.post(f"/admin/users/{await _uid(client, user_sub)}/suspend", headers=boss,
                          json={"reason": "Spam reports"})
    assert r.status_code == 200


async def test_built_in_administrator_cannot_be_suspended(client, monkeypatch):  # noqa: F811
    from app.core.config import get_settings
    builtin_sub, _ = await _role(client, "platform_administrator")
    monkeypatch.setattr(get_settings(), "admin_default_email", f"{builtin_sub}@example.com")
    _, boss = await _role(client, "platform_administrator")
    r = await client.post(f"/admin/users/{await _uid(client, builtin_sub)}/suspend", headers=boss,
                          json={"reason": "probe"})
    assert r.status_code == 422


async def test_review_archive_and_classification_roles(client):  # noqa: F811
    _, _, org = await _new_company(client)
    _, support = await _role(client, "support_specialist")
    _, analyst = await _role(client, "verification_analyst")
    _, operator = await _role(client, "platform_operator")
    fields = f"/admin/manufacturers/{org}/admin-fields"
    assert (await client.patch(fields, headers=support, json={"review_status": "REVIEWED"})).status_code == 403
    assert (await client.post(f"/admin/manufacturers/{org}/archive", headers=support,
                              json={"reason": "x"})).status_code == 403
    assert (await client.post(f"/admin/manufacturers/{org}/archive", headers=analyst,
                              json={"reason": "x"})).status_code == 403
    for h in (support, analyst):
        assert (await client.patch(fields, headers=h, json={"record_type": "DEMO", "reason": "x"})).status_code == 403
    # still allowed: viewing and internal notes for every role, review decisions for reviewers
    assert (await client.get(f"/admin/manufacturers/{org}", headers=support)).status_code == 200
    assert (await client.post(f"/admin/manufacturers/{org}/notes", headers=support,
                              json={"note": "Called the company"})).status_code == 201
    assert (await client.patch(fields, headers=analyst, json={"review_status": "REVIEWED"})).status_code == 200
    assert (await client.patch(fields, headers=operator,
                               json={"record_type": "DEMO", "reason": "Sales demo"})).status_code == 200


# ---------------------------------------------------------------- approval first
async def test_pending_applicant_cannot_use_remaining_sections_until_approved(client, approval_first):  # noqa: F811
    sub, h, org = await _new_company(client)
    assert (await client.get("/manufacturer/bootstrap", headers=h)).json()["approval"]["status"] == "pending"
    blocked = [
        await client.patch("/manufacturer/profile", headers=h, json=PROFILE),
        await client.put("/manufacturer/profile", headers=h, json={"company": {}, "location": {}}),
        await client.post("/manufacturer/machinery", headers=h, json=MACHINE),
        await client.post("/manufacturer/machinery/drafts", headers=h, json={"clientKey": str(uuid.uuid4())}),
        await client.patch("/manufacturer/availability", headers=h, json={"calendar": {"2026-11-01": "blocked"}}),
    ]
    assert [r.status_code for r in blocked] == [403] * 5, [r.text for r in blocked]
    # still available: dashboard, notifications, and resubmitting the details form
    assert (await client.get("/manufacturer/notifications", headers=h)).status_code == 200
    assert (await client.post("/manufacturer/account", headers=h,
                              json=account((await client.get("/manufacturer/bootstrap", headers=h))
                                           .json()["state"]["account"]["companyName"]))).status_code == 201

    _, boss = await _role(client, "platform_administrator")
    assert (await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=boss,
                               json={"review_status": "REVIEWED"})).status_code == 200
    assert (await client.patch("/manufacturer/profile", headers=h, json=PROFILE)).status_code == 200
    assert (await client.post("/manufacturer/machinery", headers=h, json=MACHINE)).status_code == 201


async def test_rejected_and_corrections_stay_locked(client, approval_first):  # noqa: F811
    _, boss = await _role(client, "platform_administrator")
    for decision in ("NEEDS_CORRECTION", "REJECTED"):
        _, h, org = await _new_company(client)
        r = await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=boss,
                               json={"review_status": decision, "reason": "Please fix the phone number",
                                     # a correction names the fields to fix (admin chooses them)
                                     **({"correction_fields": ["companyPhone"]} if decision == "NEEDS_CORRECTION" else {})})
        assert r.status_code == 200, r.text
        assert (await client.patch("/manufacturer/profile", headers=h, json=PROFILE)).status_code == 403


async def test_direct_call_before_details_form_creates_nothing(client, approval_first):  # noqa: F811
    sub = f"fresh_{_tag()}"
    h = hdr(client, sub)
    assert (await client.patch("/manufacturer/profile", headers=h, json={"company": {"about": "x"}})).status_code == 403
    assert (await client.post("/manufacturer/machinery", headers=h, json=MACHINE)).status_code == 403
    rows = await client.sql("""SELECT count(*) FROM memberships m JOIN users u ON u.id=m.user_id
                               WHERE u.clerk_user_id=:s""", s=sub)
    assert rows[0][0] == 0


async def test_accounts_from_before_approval_keep_working(client, approval_first):  # noqa: F811
    sub, h, org = await _new_company(client)
    # an account saved before admin approval existed: details saved, never submitted for review
    await client.sql("DELETE FROM manufacturer_submission_events WHERE submission_id IN "
                     "(SELECT id FROM manufacturer_submissions WHERE target_organization_id=CAST(:o AS uuid))", o=org)
    await client.sql("DELETE FROM manufacturer_submissions WHERE target_organization_id=CAST(:o AS uuid)", o=org)
    await client.sql("UPDATE manufacturer_onboarding SET status='in_progress' WHERE organization_id=CAST(:o AS uuid)",
                     o=org)
    assert (await client.patch("/manufacturer/profile", headers=h, json=PROFILE)).status_code == 200


# ---------------------------------------------------------------- smaller fixes
async def test_upload_must_really_be_an_image(client):  # noqa: F811
    _, h, org = await _new_company(client)
    _, boss = await _role(client, "platform_administrator")       # approval first: unlock the profile
    assert (await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=boss,
                               json={"review_status": "REVIEWED"})).status_code == 200
    fake = "data:image/png;base64," + base64.b64encode(b"<svg onload=alert(1)>").decode()
    r = await client.patch("/manufacturer/profile", headers=h, json={"company": {"logo": fake}})
    assert r.status_code == 422 and "valid PNG" in r.text


async def test_webhook_does_not_store_an_unverified_email(client, monkeypatch):  # noqa: F811
    from svix.webhooks import Webhook

    from app.core.config import get_settings
    secret = "whsec_" + base64.b64encode(b"x" * 24).decode()
    monkeypatch.setattr(get_settings(), "clerk_webhook_signing_secret", secret)
    sub, _, _ = await _new_company(client)

    async def send(email, status):
        body = json.dumps({"type": "user.updated", "data": {
            "id": sub, "first_name": "Asha", "last_name": "Rao", "primary_email_address_id": "e2",
            "email_addresses": [{"id": "e2", "email_address": email, "verification": {"status": status}}]}})
        msg_id, ts = f"msg_{_tag()}", int(time.time())
        from datetime import datetime, timezone
        sig = Webhook(secret).sign(msg_id, datetime.fromtimestamp(ts, tz=timezone.utc), body)
        r = await client.post("/webhooks/clerk", content=body, headers={
            "svix-id": msg_id, "svix-timestamp": str(ts), "svix-signature": sig, "content-type": "application/json"})
        assert r.status_code == 200, r.text
        return str((await client.sql("SELECT email FROM users WHERE clerk_user_id=:s", s=sub))[0][0])

    assert await send("boss@phaarvai.com", "unverified") == f"{sub}@example.com"
    assert await send(f"new_{sub}@example.com", "verified") == f"new_{sub}@example.com"


async def test_readiness_check_hides_database_errors(client, monkeypatch):  # noqa: F811
    import httpx

    from app import main

    async def broken(_engine):
        raise RuntimeError("password authentication failed for db.internal-host")

    monkeypatch.setattr(main, "missing_schema", broken)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://t") as raw:
        r = await raw.get("/health/ready")
    assert r.status_code == 503 and "internal-host" not in r.text


async def test_approved_claim_unlocks_the_claimed_company(client, approval_first, tmp_path):  # noqa: F811
    from pathlib import Path

    from app.core.database import SessionFactory
    from app.import_manufacturers import import_rows, read_rows
    t = _tag()
    path = Path(tmp_path) / "m.csv"
    path.write_text(f"name,country,city,category,capacity\nClaim Cast {t},India,Hosur,Automotive & Machinery,700 t\n")
    async with SessionFactory() as session:
        seeded = (await import_rows(session, read_rows(path))).inserted[0][2]
        await session.commit()
    sub = f"claimer_{t}"
    h = hdr(client, sub)
    r = await client.post("/manufacturer/account", headers=h, json=account(f"Claim Cast {t}", companyId=seeded))
    assert r.status_code == 201, r.text
    assert (await client.patch("/manufacturer/profile", headers=h, json=PROFILE)).status_code == 403
    _, boss = await _role(client, "platform_administrator")
    assert (await client.patch(f"/admin/manufacturers/{seeded}/admin-fields", headers=boss,
                               json={"review_status": "REVIEWED"})).status_code == 200
    assert (await client.patch("/manufacturer/profile", headers=h, json=PROFILE)).status_code == 200
    assert await own_org(client, sub) == seeded

