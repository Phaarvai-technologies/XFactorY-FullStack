"""Demo vs real manufacturer data (organizations.record_type): defaults, who may change it, where
DEMO records are hidden, and how imports / admin entry treat demo-real matches.

Real PostgreSQL through the real HTTP API (E2E_DATABASE_URL)."""
import os
import uuid
from pathlib import Path

import pytest

from test_e2e_local import approve_company, client  # noqa: F401  (shared fixture)
from test_manufacturer_approval import account, booking_status, complete_profile, eligibility, hdr, own_org, visible

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


def _tag():
    return uuid.uuid4().hex[:6]


async def _role(c, role="platform_administrator"):
    sub = f"admin_{role[:8]}_{_tag()}"
    h = hdr(c, sub)
    assert (await c.get("/identity/me", headers=h)).status_code == 200
    await c.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                   SELECT id, :r FROM users WHERE clerk_user_id=:s""", r=role, s=sub)
    return h


async def _record_type(c, org):
    return (await c.sql("SELECT record_type FROM organizations WHERE id=CAST(:o AS uuid)", o=org))[0][0]


async def _classify(c, h, org, record_type, reason="Checked with the company"):
    return await c.patch(f"/admin/manufacturers/{org}/admin-fields", headers=h,
                         json={"record_type": record_type, "reason": reason})


async def _import(rows_csv: str, tmp_path, record_type: str):
    from app.core.database import SessionFactory
    from app.import_manufacturers import import_rows, read_rows
    path = Path(tmp_path) / f"m_{_tag()}.csv"
    path.write_text(rows_csv)
    async with SessionFactory() as session:
        report = await import_rows(session, read_rows(path), reference=path.name, record_type=record_type)
        await session.commit()
    return report


async def _approved_complete_manufacturer(c, name):
    sub = f"user_dr_{_tag()}"
    h = hdr(c, sub)
    assert (await c.post("/manufacturer/account", headers=h, json=account(name))).status_code == 201
    org = await own_org(c, sub)
    await complete_profile(c, h)
    assert (await approve_company(c, org)).status_code == 200
    return sub, h, org


# ---------------------------------------------------------------- 1. defaults
async def test_self_registration_creates_real_records(client):  # noqa: F811
    sub = f"user_self_{_tag()}"
    h = hdr(client, sub)
    assert (await client.post("/manufacturer/account", headers=h, json=account(f"Self Reg {_tag()}"))).status_code == 201
    assert await _record_type(client, await own_org(client, sub)) == "REAL"


# ---------------------------------------------------------------- 2. demo is never shown to Visionaries
async def test_demo_manufacturer_is_hidden_from_visionaries_and_not_bookable(client):  # noqa: F811
    _, h, org = await _approved_complete_manufacturer(client, f"Visible Cast {_tag()}")
    assert await visible(client, org) and (await eligibility(client, h))["eligibility"]["visibleToVisionaries"]

    admin = await _role(client)
    r = await _classify(client, admin, org, "DEMO", "Sample company used for sales demos")
    assert r.status_code == 200 and r.json()["manufacturer"]["recordType"] == "DEMO"
    # approval, completeness and ownership are untouched; only visibility changes
    assert r.json()["manufacturer"]["reviewStatus"] == "REVIEWED" and r.json()["manufacturer"]["completeness"] == 100
    assert len(r.json()["members"]) == 1
    assert not await visible(client, org)                        # search list + profile page
    assert await booking_status(client, org) == 404               # booking / drafts
    e = (await eligibility(client, h))["eligibility"]
    assert e["approved"] and e["complete"] and not e["visibleToVisionaries"] and not e["bookingAvailable"]

    # audit trail: who, old -> new, reason
    hist = await client.sql("""SELECT field_changed, old_value, new_value, reason, changed_by IS NOT NULL
                               FROM admin_change_history WHERE manufacturer_id=CAST(:o AS uuid)
                                 AND field_changed='Record type' ORDER BY created_at""", o=org)
    assert [tuple(x) for x in hist] == [("Record type", "REAL", "DEMO", "Sample company used for sales demos", True)]

    # admins can still inspect it; switching back restores visibility
    assert (await client.get(f"/admin/manufacturers/{org}", headers=admin)).status_code == 200
    assert (await _classify(client, admin, org, "REAL", "Confirmed real")).status_code == 200
    assert await visible(client, org)


# ---------------------------------------------------------------- 3. who may change it
async def test_only_administrators_and_operators_change_classification_with_a_reason(client):  # noqa: F811
    _, _, org = await _approved_complete_manufacturer(client, f"Guarded Co {_tag()}")
    for role in ("verification_analyst", "support_specialist"):
        r = await _classify(client, await _role(client, role), org, "DEMO")
        assert r.status_code == 403, (role, r.text)
    operator = await _role(client, "platform_operator")
    r = await _classify(client, operator, org, "DEMO", reason="  ")
    assert r.status_code == 422 and "reason" in r.json()["detail"]
    assert await _record_type(client, org) == "REAL"             # nothing changed by refused requests
    assert (await _classify(client, operator, org, "DEMO")).status_code == 200
    assert await _record_type(client, org) == "DEMO"
    # other admin fields stay open to every admin role (unchanged behaviour)
    analyst = await _role(client, "verification_analyst")
    r = await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=analyst,
                           json={"referral_source": "Trade fair"})
    assert r.status_code == 200


# ---------------------------------------------------------------- 4. onboarding company lookup
async def test_onboarding_lookup_hides_demo_companies_except_your_own(client, tmp_path):  # noqa: F811
    t = _tag()
    rep = await _import(f"name,country,city\nLookup Demo {t},India,Hosur\nLookup Real {t},India,Hosur\n",
                        tmp_path, "DEMO")
    demo_id = rep.inserted[0][2]
    rep2 = await _import(f"name,country,city\nLookup Real {t},India,Hosur\n", tmp_path, "REAL")
    assert rep2.conflicts and rep2.conflicts[0][4] == "DEMO" and not rep2.inserted   # same company as a DEMO row
    rep3 = await _import(f"name,country,city\nLookup Other {t},India,Chennai\n", tmp_path, "REAL")
    real_id = rep3.inserted[0][2]

    other = hdr(client, f"user_lk_{_tag()}")
    found = {i["id"] for i in (await client.get("/manufacturer/companies/search", headers=other,
                                                params={"q": f"Lookup"})).json()["items"]}
    assert real_id in found and demo_id not in found
    assert (await client.get(f"/manufacturer/companies/{demo_id}", headers=other)).status_code == 404
    r = await client.post("/manufacturer/account", headers=other,
                          json=account(f"Lookup Demo {t}", companyId=demo_id))
    assert r.status_code in (404, 409, 422), r.text            # a DEMO record cannot be claimed / selected

    # an owner whose approved company was classified DEMO keeps access to it; others no longer see it
    _, h, mine = await _approved_complete_manufacturer(client, f"Own Demo {t}")
    assert (await client.get(f"/manufacturer/companies/{mine}", headers=other)).status_code == 200
    assert (await _classify(client, await _role(client), mine, "DEMO")).status_code == 200
    assert (await client.get(f"/manufacturer/companies/{mine}", headers=h)).json()["access"] == "owner"
    assert (await client.get(f"/manufacturer/companies/{mine}", headers=other)).status_code == 404
    mine_found = (await client.get("/manufacturer/companies/search", headers=h, params={"q": f"Own Demo {t}"})).json()
    assert [i["id"] for i in mine_found["items"]] == [mine]
    assert (await client.get("/manufacturer/bootstrap", headers=h)).status_code == 200


# ---------------------------------------------------------------- 5. imports
async def test_import_sets_the_chosen_type_and_never_converts_the_other_type(client, tmp_path):  # noqa: F811
    t = _tag()
    row = f"name,country,city,website\nImport Twin {t},India,Coimbatore,https://twin{t}.example\n"
    demo = await _import(row, tmp_path, "DEMO")
    demo_id = demo.inserted[0][2]
    assert await _record_type(client, demo_id) == "DEMO"

    real = await _import(row, tmp_path, "REAL")                   # same company, real data
    assert real.inserted == [] and real.present == []
    assert [(c[2], c[4]) for c in real.conflicts] == [(demo_id, "DEMO")]
    assert await _record_type(client, demo_id) == "DEMO"          # existing record untouched
    count = await client.sql("SELECT count(*) FROM organizations WHERE display_name=:n", n=f"Import Twin {t}")
    assert count[0][0] == 1                                       # no second copy

    fresh = await _import(f"name,country,city\nImport Fresh {t},India,Madurai\n", tmp_path, "REAL")
    fresh_id = fresh.inserted[0][2]
    assert await _record_type(client, fresh_id) == "REAL"
    again = await _import(f"name,country,city\nImport Fresh {t},India,Madurai\n", tmp_path, "REAL")
    assert again.inserted == [] and [p[2] for p in again.present] == [fresh_id]   # existing dedup rule
    events = await client.sql("""SELECT details->>'record_type' FROM manufacturer_submission_events
                                 WHERE organization_id=CAST(:o AS uuid) AND event='imported'""", o=fresh_id)
    assert [e[0] for e in events] == ["REAL"]

    # a company present as both REAL and DEMO is a plain duplicate for a REAL import (no conflict)
    blocked = await _import(f"name,country,city\nBoth Kinds {t},India,Salem\n", tmp_path, "DEMO")
    twin_real = await _import(f"name,country,city\nBoth Kinds {t},India,Salem\n", tmp_path, "REAL")
    assert blocked.inserted and twin_real.conflicts and not twin_real.inserted   # REAL vs earlier DEMO: conflict
    demo_twin = blocked.inserted[0][2]
    real_twin = str(uuid.uuid4())                                  # an older REAL copy loaded outside the importer
    await client.sql("""INSERT INTO organizations (id, display_name, organization_type, status, entry_source, record_type)
                        VALUES (CAST(:i AS uuid), :n, 'manufacturer', 'claim_pending', 'IMPORTED', 'REAL')""",
                     i=real_twin, n=f"Both Kinds {t}")
    await client.sql("""INSERT INTO facilities (organization_id, name, is_headquarters, city, country_name)
                        VALUES (CAST(:i AS uuid), 'HQ', true, 'Salem', 'India')""", i=real_twin)
    both = await _import(f"name,country,city\nBoth Kinds {t},India,Salem\n", tmp_path, "REAL")
    assert both.conflicts == [] and [p[2] for p in both.present] == [real_twin]   # same-type match wins
    assert await _record_type(client, demo_twin) == "DEMO"

    # archived demo sample data no longer blocks the real import
    admin = await _role(client)
    assert (await client.post(f"/admin/manufacturers/{demo_id}/archive", headers=admin,
                              json={"reason": "unrelated sample"})).status_code == 200
    real2 = await _import(row, tmp_path, "REAL")
    assert len(real2.inserted) == 1 and await _record_type(client, real2.inserted[0][2]) == "REAL"


async def test_import_requires_an_explicit_record_type(tmp_path):
    from app.import_manufacturers import import_rows, main
    path = Path(tmp_path) / "x.csv"
    path.write_text("name\nX\n")
    with pytest.raises(SystemExit) as exc:
        await main([str(path), "--dry-run"])                         # --record-type is required
    assert exc.value.code == 2
    with pytest.raises(ValueError):
        await import_rows(None, [], record_type="TEST")


# ---------------------------------------------------------------- 6. admin entry
async def test_admin_entry_chooses_real_or_demo_and_reports_conflicts(client):  # noqa: F811
    admin = await _role(client)
    t = _tag()
    base = {"name": f"Entry Twin {t}", "country": "India", "city": "Hosur", "reason": "Sales demo"}
    r = await client.post("/admin/manufacturers", headers=admin, json={**base, "record_type": "DEMO"})
    assert r.status_code == 201 and r.json()["manufacturer"]["recordType"] == "DEMO"
    demo_id = r.json()["manufacturer"]["id"]
    r = await client.post("/admin/manufacturers", headers=admin, json={**base, "record_type": "REAL"})
    assert r.status_code == 409 and r.json()["code"] == "classification_conflict" and r.json()["existingId"] == demo_id
    r = await client.post("/admin/manufacturers", headers=admin,
                          json={**base, "name": f"Entry Real {t}", "record_type": "REAL"})
    assert r.status_code == 201 and r.json()["manufacturer"]["recordType"] == "REAL"
    r = await client.post("/admin/manufacturers", headers=admin, json={**base, "name": f"Entry Default {t}"})
    assert r.json()["manufacturer"]["recordType"] == "REAL"        # API default stays REAL
    r = await client.post("/admin/manufacturers", headers=admin, json={**base, "name": f"X {t}", "record_type": "TEST"})
    assert r.status_code == 422


# ---------------------------------------------------------------- 7. admin list tabs
async def test_admin_list_tabs_counts_search_and_pagination(client, tmp_path):  # noqa: F811
    t = _tag()
    await _import("name,country,city\n" + "".join(f"Tab Real {t} {i},India,City{i}\n" for i in range(3)),
                  tmp_path, "REAL")
    await _import("name,country,city\n" + "".join(f"Tab Demo {t} {i},India,City{i}\n" for i in range(2)),
                  tmp_path, "DEMO")
    admin = await _role(client, "support_specialist")              # any admin can view
    allr = (await client.get("/admin/manufacturers", headers=admin, params={"q": f"Tab % {t}"})).json()
    assert allr["total"] == 5 and allr["recordTypeCounts"] == {"REAL": 3, "DEMO": 2, "TEST": 0}
    real = (await client.get("/admin/manufacturers", headers=admin,
                             params={"q": f"{t}", "record_type": "REAL", "page_size": 5})).json()
    assert real["total"] == 3 and {r["recordType"] for r in real["rows"]} == {"REAL"}
    assert real["recordTypeCounts"] == {"REAL": 3, "DEMO": 2, "TEST": 0}   # counts ignore the tab itself
    demo = (await client.get("/admin/manufacturers", headers=admin,
                             params={"q": f"{t}", "record_type": ["DEMO", "TEST"], "page_size": 5})).json()
    assert demo["total"] == 2 and {r["recordType"] for r in demo["rows"]} == {"DEMO"}
    page2 = (await client.get("/admin/manufacturers", headers=admin,
                              params={"q": f"{t}", "page_size": 5, "page": 2})).json()
    assert page2["rows"] == [] and page2["total"] == 5


async def test_review_queue_real_demo_and_all(client, tmp_path):  # noqa: F811
    t = _tag()
    await _import("name,country,city\n" + "".join(f"Queue Real {t} {i},India,City{i}\n" for i in range(3)),
                  tmp_path, "REAL")
    await _import("name,country,city\n" + "".join(f"Queue Demo {t} {i},India,City{i}\n" for i in range(2)),
                  tmp_path, "DEMO")
    admin = await _role(client, "support_specialist")

    async def queue(**params):
        r = await client.get("/admin/review-queue", headers=admin, params={"q": t, **params})
        assert r.status_code == 200
        return [row["recordType"] for row in r.json()["rows"]]

    assert await queue() == ["REAL"] * 3                                   # default: real data only
    assert await queue(data="demo") == ["DEMO"] * 2                         # demo data only
    assert await queue(data="all") == ["DEMO", "DEMO", "REAL", "REAL", "REAL"]   # demo first, never cut off
    assert await queue(include_test=True) == await queue(data="all")      # older link form still works
    assert (await client.get("/admin/review-queue", headers=admin, params={"data": "x"})).status_code == 422
