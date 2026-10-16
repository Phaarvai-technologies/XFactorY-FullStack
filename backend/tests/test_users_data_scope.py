"""Users tab Data filter: real / demo / all, driven by the linked company's record type (set by an
admin). Real PostgreSQL through the real admin API (E2E_DATABASE_URL)."""
import os
import uuid

import pytest

from test_e2e_local import client  # noqa: F401  (shared fixture)
from test_manufacturer_approval import account, hdr, own_org
from test_onboarding_source import _admin

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


async def _owner(c, sub, name):
    assert (await c.post("/manufacturer/account", headers=hdr(c, sub), json=account(name))).status_code == 201
    return await own_org(c, sub)


async def _list(c, admin, **params):
    r = await c.get("/admin/users", headers=admin, params=params)
    assert r.status_code == 200, r.text
    return r.json()


async def test_users_data_filter_real_demo_all(client):  # noqa: F811
    admin = await _admin(client)
    t = uuid.uuid4().hex[:6]
    real_sub, demo_sub, test_sub, plain_sub = (f"user_ds_{k}_{t}" for k in ("real", "demo", "test", "plain"))
    await _owner(client, real_sub, f"DS Real Co {t}")
    demo_org = await _owner(client, demo_sub, f"DS Demo Co {t}")
    test_org = await _owner(client, test_sub, f"DS Test Co {t}")
    assert (await client.get("/identity/me", headers=hdr(client, plain_sub))).status_code == 200   # no company
    for org, kind in ((demo_org, "DEMO"), (test_org, "TEST")):
        r = await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=admin, json={"record_type": kind})
        assert r.status_code == 200, r.text

    emails = lambda body: {row["email"] for row in body["rows"]}  # noqa: E731
    everyone = await _list(client, admin, q=t)
    assert emails(everyone) == {f"{s}@example.com" for s in (real_sub, demo_sub, test_sub, plain_sub)}
    assert everyone["dataCounts"] == {"real": 2, "demo": 2, "all": 4} and everyone["total"] == 4
    assert (await _list(client, admin, q=t, data="all"))["total"] == 4          # explicit all == default

    real = await _list(client, admin, q=t, data="real")
    assert emails(real) == {f"{real_sub}@example.com", f"{plain_sub}@example.com"} and real["total"] == 2
    demo = await _list(client, admin, q=t, data="demo")
    assert emails(demo) == {f"{demo_sub}@example.com", f"{test_sub}@example.com"} and demo["total"] == 2
    assert demo["dataCounts"] == everyone["dataCounts"]                          # counts ignore the Data filter
    # each linked company carries its own record type (for the badge)
    by_email = {r["email"]: r for r in demo["rows"]}
    assert by_email[f"{demo_sub}@example.com"]["companies"][0]["recordType"] == "DEMO"
    assert by_email[f"{test_sub}@example.com"]["companies"][0]["recordType"] == "TEST"

    # combines with other filters; counts follow them
    no_profile = await _list(client, admin, q=t, onboarding_status="NO_PROFILE", data="real")
    assert emails(no_profile) == {f"{plain_sub}@example.com"}
    assert no_profile["dataCounts"] == {"real": 1, "demo": 0, "all": 1}

    # reclassifying a company moves its user between Real and Demo; no user data changes
    r = await client.patch(f"/admin/manufacturers/{demo_org}/admin-fields", headers=admin, json={"record_type": "REAL"})
    assert r.status_code == 200
    assert f"{demo_sub}@example.com" in emails(await _list(client, admin, q=t, data="real"))
    assert (await _list(client, admin, q=t))["dataCounts"] == {"real": 3, "demo": 1, "all": 4}

    # invalid value refused; admin only
    assert (await client.get("/admin/users", headers=admin, params={"data": "fake"})).status_code == 422
    assert (await client.get("/admin/users", headers=hdr(client, real_sub), params={"data": "demo"})).status_code == 403
