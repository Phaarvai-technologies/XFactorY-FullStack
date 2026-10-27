"""Manufacturers tab shows approved companies (and imported / admin-added ones) only; companies a user
submitted stay in Onboarding & review until approved. Admins mark manufacturers and Visionaries as
demo data. Real PostgreSQL through the real API (E2E_DATABASE_URL)."""
import os
import tempfile
import uuid
from pathlib import Path

import pytest

from test_e2e_local import approve_company, client  # noqa: F401  (shared fixture)
from test_manufacturer_approval import account, hdr, own_org
from test_onboarding_source import _admin, _import

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


async def _ids(c, admin, q, **params):
    r = await c.get("/admin/manufacturers", headers=admin, params={"q": q, "page_size": 100, **params})
    assert r.status_code == 200, r.text
    return {row["id"] for row in r.json()["rows"]}


async def _queue(c, admin, q):
    r = await c.get("/admin/review-queue", headers=admin, params={"q": q})
    assert r.status_code == 200, r.text
    return {row["id"] for row in r.json()["rows"]}


async def test_manufacturers_tab_lists_only_approved_or_admin_sourced(client):  # noqa: F811
    admin = await _admin(client)
    t = uuid.uuid4().hex[:6]
    # a registered user who only signed up has no company anywhere
    plain = f"user_lst_plain_{t}"
    assert (await client.get("/identity/me", headers=hdr(client, plain))).status_code == 200
    # users submit companies through manufacturer onboarding
    subs = {}
    for k in ("pending", "approved", "rejected"):
        sub = f"user_lst_{k}_{t}"
        assert (await client.post("/manufacturer/account", headers=hdr(client, sub),
                                  json=account(f"LST {k} Works {t}"))).status_code == 201
        subs[k] = await own_org(client, sub)
    with tempfile.TemporaryDirectory() as d:
        imported = (await _import(Path(d), t, name=f"LST Imported {t}")).inserted[0][2]
    added = (await client.post("/admin/manufacturers", headers=admin,
                               json={"name": f"LST Added {t}", "country": "India", "city": "Pune"})).json()["manufacturer"]["id"]

    # before any decision: user companies are in the review queue, not in Manufacturers
    assert await _ids(client, admin, f"LST") >= {imported, added}
    listed = await _ids(client, admin, t)
    assert listed == {imported, added}
    assert await _ids(client, admin, t, listing="awaiting") == set(subs.values())
    assert await _ids(client, admin, t, listing="all") == {imported, added, *subs.values()}
    assert set(subs.values()) <= await _queue(client, admin, t)

    # approval puts the company in the Manufacturers tab; rejection keeps it out
    assert (await approve_company(client, subs["approved"])).status_code == 200
    assert (await approve_company(client, subs["rejected"], decision="REJECTED", reason="Not verified")).status_code == 200
    assert await _ids(client, admin, t) == {imported, added, subs["approved"]}
    assert await _ids(client, admin, t, listing="awaiting") == {subs["pending"], subs["rejected"]}
    # the company detail still opens for any company (links from Users / review)
    assert (await client.get(f"/admin/manufacturers/{subs['pending']}", headers=admin)).status_code == 200
    assert (await client.get("/admin/manufacturers", headers=admin, params={"listing": "bogus"})).status_code == 422

    # mark a listed manufacturer as demo: it moves to the Demo filter, the person too
    r = await client.patch(f"/admin/manufacturers/{subs['approved']}/admin-fields", headers=admin,
                           json={"record_type": "DEMO", "reason": "Checked with the company"})
    assert r.status_code == 200 and r.json()["manufacturer"]["recordType"] == "DEMO"
    assert await _ids(client, admin, t, record_type=["DEMO", "TEST"]) == {subs["approved"]}
    assert await _ids(client, admin, t, record_type=["REAL"]) == {imported, added}
    users = (await client.get("/admin/users", headers=admin, params={"q": f"user_lst_approved_{t}", "data": "demo"})).json()
    assert [u["email"] for u in users["rows"]] == [f"user_lst_approved_{t}@example.com"]
    # and back to real
    await client.patch(f"/admin/manufacturers/{subs['approved']}/admin-fields", headers=admin, json={"record_type": "REAL", "reason": "Checked with the company"})
    assert subs["approved"] in await _ids(client, admin, t, record_type=["REAL"])


async def _visionary(c, sub):
    assert (await c.get("/identity/me", headers=hdr(c, sub))).status_code == 200
    await c.sql("""INSERT INTO marketplace_role_selections (user_id, role_selected, status)
                   SELECT id, 'demand_requester', 'active' FROM users WHERE clerk_user_id=:s""", s=sub)
    return (await c.sql("SELECT id::text FROM users WHERE clerk_user_id=:s", s=sub))[0][0]


async def test_visionary_demo_marking_and_filter(client):  # noqa: F811
    admin = await _admin(client)
    t = uuid.uuid4().hex[:6]
    real_id = await _visionary(client, f"vis_real_{t}")
    demo_id = await _visionary(client, f"vis_demo_{t}")

    def ids(body):
        return {v["id"] for v in body["rows"]}

    async def vis(**params):
        r = await client.get("/admin/visionaries", headers=admin, params={"q": f"_{t}", **params})
        assert r.status_code == 200, r.text
        return r.json()

    before = await vis()
    assert ids(before) == {real_id, demo_id} and before["dataCounts"] == {"real": 2, "demo": 0, "all": 2}
    assert all(v["recordType"] == "REAL" for v in before["rows"])

    r = await client.patch(f"/admin/visionaries/{demo_id}/record-type", headers=admin,
                           json={"record_type": "DEMO", "reason": "Sales demo account"})
    assert r.status_code == 200 and r.json()["visionary"]["recordType"] == "DEMO"
    assert (await vis())["dataCounts"] == {"real": 1, "demo": 1, "all": 2}
    assert ids(await vis(data="demo")) == {demo_id}
    assert ids(await vis(data="real")) == {real_id}
    # recorded in the person's activity log
    log = await client.sql("""SELECT detail FROM user_activity_events WHERE user_id=CAST(:u AS uuid)
                              AND detail LIKE 'Data type changed%'""", u=demo_id)
    assert log and log[0][0] == "Data type changed from REAL to DEMO: Sales demo account"
    # the same person counts as demo in the Users tab
    users = (await client.get("/admin/users", headers=admin, params={"q": f"vis_demo_{t}"})).json()
    assert users["rows"][0]["userRecordType"] == "DEMO" and users["dataCounts"]["demo"] == 1
    assert (await client.get("/admin/users", headers=admin, params={"q": f"vis_demo_{t}", "data": "real"})).json()["total"] == 0

    # same value again: no new log row; back to REAL
    await client.patch(f"/admin/visionaries/{demo_id}/record-type", headers=admin, json={"record_type": "DEMO"})
    assert len(await client.sql("""SELECT 1 FROM user_activity_events WHERE user_id=CAST(:u AS uuid)
                                   AND detail LIKE 'Data type changed%'""", u=demo_id)) == 1
    r = await client.patch(f"/admin/visionaries/{demo_id}/record-type", headers=admin, json={"record_type": "REAL"})
    assert r.json()["visionary"]["recordType"] == "REAL"

    # validation, not found, admin only
    assert (await client.patch(f"/admin/visionaries/{demo_id}/record-type", headers=admin,
                               json={"record_type": "FAKE"})).status_code == 422
    assert (await client.patch(f"/admin/visionaries/{uuid.uuid4()}/record-type", headers=admin,
                               json={"record_type": "DEMO"})).status_code == 404
    assert (await client.patch(f"/admin/visionaries/{demo_id}/record-type", headers=hdr(client, f"vis_real_{t}"),
                               json={"record_type": "DEMO"})).status_code == 403
    assert (await client.get("/admin/visionaries", headers=admin, params={"data": "x"})).status_code == 422
