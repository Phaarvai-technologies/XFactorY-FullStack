"""Admin -> manufacturer notifications: Needs correction (with the note), admin field edits and
notes marked "Show to manufacturer" reach the manufacturer's bell + popup; private notes never do.
Real PostgreSQL; skipped without E2E_DATABASE_URL."""
import os
import uuid

import pytest

from test_admin import make_admin, new_manufacturer, no_clerk  # noqa: F401  (fixture)
from test_e2e_local import client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


async def test_admin_actions_notify_the_manufacturer(client, no_clerk):  # noqa: F811
    admin = await make_admin(client, f"admin_{uuid.uuid4().hex[:8]}")
    sub, mh, org = await new_manufacturer(client, f"Kaveri Plastics {uuid.uuid4().hex[:6]}")
    other_sub, other_h, other_org = await new_manufacturer(client, f"Other Co {uuid.uuid4().hex[:6]}")

    r = await client.get("/manufacturer/notifications", headers=mh)
    assert r.status_code == 200, r.text
    assert r.json() == {"items": [], "unread": 0, "popup": None, "correction": None}

    # A private note stays private
    r = await client.post(f"/admin/manufacturers/{org}/notes", headers=admin, json={"note": "Owner sounded unsure"})
    assert r.status_code == 201 and r.json()["notes"][0]["shared"] is False
    assert (await client.get("/manufacturer/notifications", headers=mh)).json()["unread"] == 0

    # Needs correction + note -> notification, popup, correction box with the note
    r = await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=admin,
                           json={"review_status": "NEEDS_CORRECTION", "reason": "Upload a clearer ISO certificate"})
    assert r.status_code == 200, r.text
    # A shared note
    r = await client.post(f"/admin/manufacturers/{org}/notes", headers=admin,
                          json={"note": "The certificate must show the expiry date.", "share": True})
    assert r.status_code == 201
    assert [n["shared"] for n in r.json()["notes"]][:2] == [True, True]   # shared note + correction note
    # An admin edit
    r = await client.patch(f"/admin/manufacturers/{org}/fields", headers=admin,
                           json={"field": "company.about", "value": "Injection moulded food containers",
                                 "reason": "Typo in the description"})
    assert r.status_code == 200, r.text

    n = (await client.get("/manufacturer/notifications", headers=mh)).json()
    kinds = [i["kind"] for i in n["items"]]
    assert kinds == ["profile_edit", "admin_note", "needs_correction"], kinds
    assert n["unread"] == 3 and n["popup"] == {"count": 3, "needsCorrection": True}
    nc = n["items"][2]
    assert nc["title"] == "Your profile needs a few corrections" and nc["body"] == "Upload a clearer ISO certificate"
    assert "Injection moulded food containers" in n["items"][0]["body"] and "Typo" in n["items"][0]["body"]
    assert n["correction"]["reason"] == "Upload a clearer ISO certificate"
    notes = [x["note"] for x in n["correction"]["notes"]]
    assert notes == ["The certificate must show the expiry date."]   # the reason itself is not repeated
    assert "Owner sounded unsure" not in str(n)

    # Other companies see nothing
    assert (await client.get("/manufacturer/notifications", headers=other_h)).json()["unread"] == 0

    # "Later" hides the popup but keeps them unread
    n = (await client.post("/manufacturer/notifications/popup-seen", headers=mh)).json()
    assert n["popup"] is None and n["unread"] == 3
    # Opening one marks it read; then all
    n = (await client.post("/manufacturer/notifications/read", headers=mh, json={"ids": [nc["id"]]})).json()
    assert n["unread"] == 2 and n["items"][2]["read"] is True
    # ...cannot touch another user's notifications
    await client.post("/manufacturer/notifications/read", headers=other_h, json={})
    assert (await client.get("/manufacturer/notifications", headers=mh)).json()["unread"] == 2
    n = (await client.post("/manufacturer/notifications/read", headers=mh, json={})).json()
    assert n["unread"] == 0 and all(i["read"] for i in n["items"])

    # Reviewed: the correction box goes away, the history stays
    await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=admin, json={"review_status": "REVIEWED"})
    n = (await client.get("/manufacturer/notifications", headers=mh)).json()
    assert n["correction"] is None and len(n["items"]) == 3

    # Signed out -> 401
    assert (await client.get("/manufacturer/notifications", headers={"Authorization": ""})).status_code == 401
