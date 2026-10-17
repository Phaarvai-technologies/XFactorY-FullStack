"""Manufacturer company import, search, selection and the authorized save path (real Postgres).

Run with E2E_DATABASE_URL set (see test_e2e_local.py)."""
import os
import uuid
from pathlib import Path

import pytest

from test_e2e_local import approve_company, client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")

ACCOUNT = {"firstName": "Jo", "lastName": "Owner", "contact": "jo@example.com", "dob": "1990-01-01",
           "companyType": "Automotive & Machinery", "country": "India", "phone": "9876543210", "capacity": ""}


def _tag() -> str:
    return uuid.uuid4().hex[:6]


async def _import(tmp_path: Path, csv_text: str):
    from app.core.database import SessionFactory
    from app.import_manufacturers import import_rows, read_rows
    path = tmp_path / f"m{_tag()}.csv"
    path.write_text(csv_text, encoding="utf-8")
    async with SessionFactory() as session:
        report = await import_rows(session, read_rows(path))
        await session.commit()
    return report


def _hdr(c, sub):
    return {"Authorization": f"Bearer {c.token_for(sub)}"}


async def _org_count(c) -> int:
    return (await c.sql("SELECT count(*) FROM organizations"))[0][0]


async def _search(c, q, sub=None):
    r = await c.get("/manufacturer/companies/search", params={"q": q}, headers=_hdr(c, sub) if sub else None)
    assert r.status_code == 200, r.text
    return r.json()["items"]


# ---------------------------------------------------------------- import
async def test_import_is_idempotent_and_never_matches_by_name_alone(client, tmp_path):  # noqa: F811
    t = _tag()
    csv_text = (
        "Company Name,Country,City,State,Category,Website,GSTIN,Capacity\n"
        f"Apex Forge {t},India,Pune,Maharashtra,Automotive & Machinery,https://www.apex{t}.in/about,,500 units\n"
        f"Apex Forge {t},India,Chennai,Tamil Nadu,Automotive & Machinery,,,\n"          # same name, other city
        f"  apex   FORGE {t} ,India,Pune,,,,,\n"                                         # same as row 1 -> present
        f"Bolt Works {t},,,,,,REG{t},\n"
        f"Renamed Bolt {t},,,,,,reg{t},\n"                                               # same registration id
        f"Apex Forge {t},,,,,,,\n"                                                       # name only -> ambiguous
        ",India,Pune,,,,,\n"                                                             # invalid
    )
    before = await _org_count(client)
    first = await _import(tmp_path, csv_text)
    assert [r[1] for r in first.inserted] == [f"Apex Forge {t}", f"Apex Forge {t}", f"Bolt Works {t}"]
    assert [r[0] for r in first.present] == [4, 6]
    assert [r[0] for r in first.ambiguous] == [7] and [r[0] for r in first.invalid] == [8]
    assert await _org_count(client) == before + 3

    again = await _import(tmp_path, csv_text)  # repeated import: nothing new
    assert again.inserted == [] and len(again.present) == 5
    assert await _org_count(client) == before + 3

    row = (await client.sql("""SELECT o.status, o.entry_source, o.website_domain, op.production_capacity_label,
                                      f.city, (SELECT count(*) FROM memberships m WHERE m.organization_id=o.id)
                               FROM organizations o JOIN organization_profiles op ON op.organization_id=o.id
                               JOIN facilities f ON f.organization_id=o.id AND f.is_headquarters
                               WHERE o.id=CAST(:id AS uuid)""", id=first.inserted[0][2]))[0]
    assert tuple(row) == ("claim_pending", "IMPORTED", f"apex{t}.in", "500 units", "Pune", 0)  # no owner


# ---------------------------------------------------------------- search
async def test_newly_imported_companies_are_searchable_live_and_ranked(client, tmp_path):  # noqa: F811
    t = _tag()
    await _import(tmp_path, "name,country,city\n"
                            f"Zeta {t} Plastics,India,Surat\n"
                            f"{t} Zeta Moulding,India,Vapi\n"
                            f"Zeta {t},Germany,Berlin\n"
                            f"Zeta {t},India,Delhi\n"
                            f"100%_{t} Pure,India,Pune\n")
    items = await _search(client, f"  ZETA {t.upper()}  ")  # trimmed, case-insensitive, no redeploy
    names = [(i["companyName"], i["country"]) for i in items]
    # exact names first, then "starts with", then other partial matches
    assert names[:2] == [(f"Zeta {t}", "Germany"), (f"Zeta {t}", "India")] or \
           names[:2] == [(f"Zeta {t}", "India"), (f"Zeta {t}", "Germany")]
    assert names[2] == (f"Zeta {t} Plastics", "India")
    assert (f"{t} Zeta Moulding", "India") not in names  # "zeta {t}" is not inside "{t} zeta moulding"
    same = [i for i in items if i["companyName"] == f"Zeta {t}"]
    assert len({i["id"] for i in same}) == 2 and {i["city"] for i in same} == {"Berlin", "Delhi"}  # not merged
    assert all(i["claimed"] is False and "phone" not in i for i in items)
    by_tag = [i["companyName"] for i in await _search(client, t)]
    assert by_tag[0] == f"{t} Zeta Moulding"                     # name starts with the text
    assert set(by_tag[1:4]) == {f"Zeta {t}", f"Zeta {t} Plastics"}  # a word starts with it
    assert by_tag[-1] == f"100%_{t} Pure"                         # other partial match last
    # LIKE wildcards in the text are literal
    assert [i["companyName"] for i in await _search(client, f"100%_{t}")] == [f"100%_{t} Pure"]
    assert await _search(client, f"100%x{t}") == []


async def test_placeholder_organizations_are_not_companies(client):  # noqa: F811
    sub = f"user_ph_{_tag()}"
    assert (await client.get("/manufacturer/bootstrap", headers=_hdr(client, sub))).status_code == 200
    # bootstrap created the user's empty placeholder named after the person ("Jordan Lee")
    placeholder = str((await client.sql(
        """SELECT o.id FROM organizations o JOIN memberships m ON m.organization_id=o.id
           JOIN users u ON u.id=m.user_id WHERE u.clerk_user_id=:s""", s=sub))[0][0])
    hits = await _search(client, "Jordan Lee")
    assert placeholder not in [h["id"] for h in hits]


# ---------------------------------------------------------------- select + save
async def test_selecting_loads_the_exact_record_and_unclaimed_companies_can_be_completed(client, tmp_path):  # noqa: F811
    t = _tag()
    rep = await _import(tmp_path, "name,country,city,category,capacity,phone\n"
                                  f"Nova Metals {t},India,Pune,Automotive & Machinery,900 t,+91 99999 00000\n"
                                  f"Nova Metals {t},India,Nagpur,Other,,\n")
    pune_id = rep.inserted[0][2]
    sub = f"user_sel_{_tag()}"
    h = _hdr(client, sub)
    assert (await client.get("/manufacturer/bootstrap", headers=h)).status_code == 200  # own placeholder first
    r = await client.get(f"/manufacturer/companies/{pune_id}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {"id": pune_id, "companyName": f"Nova Metals {t}", "companyType": "Automotive & Machinery",
                        "country": "India", "city": "Pune", "state": "", "capacity": "900 t",
                        # the company's phone is shown (read-only on the form); nothing missing
                        "phone": "+91 99999 00000", "missing": [], "access": "unclaimed", "canUpdate": True}
    assert (await client.get(f"/manufacturer/companies/{uuid.uuid4()}", headers=h)).status_code == 404

    assert (await client.get(f"/manufacturer/companies/{pune_id}", headers=h)).json()["canUpdate"] is True

    # Submitting details for the unclaimed seeded company = a claim awaiting admin approval:
    # the record is untouched, nobody becomes its owner, nothing is duplicated.
    before = await _org_count(client)
    snapshot = await client.sql("""SELECT o.display_name, o.status, op.company_category, op.production_capacity_label,
                                          op.contact_phone
                                   FROM organizations o JOIN organization_profiles op ON op.organization_id=o.id
                                   WHERE o.id=CAST(:id AS uuid)""", id=pune_id)
    r = await client.post("/manufacturer/account", headers=h, json={
        **ACCOUNT, "companyName": f"Nova Metals {t}", "companyId": pune_id, "capacity": "1 t",
        "companyType": "Other"})
    assert r.status_code == 201, r.text
    assert r.json()["approval"]["status"] == "pending" and r.json()["approval"]["kind"] == "claim"
    assert await client.sql("""SELECT o.display_name, o.status, op.company_category, op.production_capacity_label,
                                      op.contact_phone
                               FROM organizations o JOIN organization_profiles op ON op.organization_id=o.id
                               WHERE o.id=CAST(:id AS uuid)""", id=pune_id) == snapshot
    assert (await client.sql("SELECT count(*) FROM memberships WHERE organization_id=CAST(:i AS uuid)", i=pune_id))[0][0] == 0
    sub_row = (await client.sql("""SELECT s.kind, s.status, s.selected_company_id::text FROM manufacturer_submissions s
                                   JOIN users u ON u.id=s.submitted_by_user_id WHERE u.clerk_user_id=:c""", c=sub))
    assert [tuple(x) for x in sub_row] == [("claim", "pending", pune_id)]
    assert await _org_count(client) == before
    # a second user cannot file a competing claim meanwhile
    other = f"user_sel2_{_tag()}"
    r = await client.post("/manufacturer/account", headers=_hdr(client, other), json={
        **ACCOUNT, "companyName": f"Nova Metals {t}", "companyId": pune_id, "capacity": "5 t"})
    assert r.status_code == 409 and "awaiting" in r.json()["detail"]

    # Admin approves: saved values kept, missing ones filled, the claimant becomes the owner,
    # the claim is verified (status active); approving twice changes nothing.
    assert (await approve_company(client, pune_id)).status_code == 200
    row = (await client.sql("""SELECT o.display_name, o.status, op.company_category, op.production_capacity_label,
                                      op.contact_phone
                               FROM organizations o JOIN organization_profiles op ON op.organization_id=o.id
                               WHERE o.id=CAST(:id AS uuid)""", id=pune_id))[0]
    assert tuple(row) == (f"Nova Metals {t}", "active", "Automotive & Machinery", "900 t", "+91 99999 00000")
    members = await client.sql("""SELECT u.clerk_user_id, m.membership_role FROM memberships m JOIN users u ON u.id=m.user_id
                                  WHERE m.organization_id=CAST(:id AS uuid) AND m.status='active'""", id=pune_id)
    assert [tuple(m) for m in members] == [(sub, "owner")]
    again = await approve_company(client, pune_id)
    assert again.status_code in (200, 422)  # nothing pending any more: no second merge
    assert (await client.sql("SELECT count(*) FROM manufacturer_submissions WHERE target_organization_id=CAST(:i AS uuid) "
                             "AND applied_at IS NOT NULL", i=pune_id))[0][0] == 1
    # the dashboard now works on the claimed company
    boot = (await client.get("/manufacturer/bootstrap", headers=h)).json()
    assert boot["accountExists"] is True and boot["state"]["account"]["companyName"] == f"Nova Metals {t}"
    assert boot["approval"]["status"] == "approved"

    # later changes by the owner are staged again until approved
    r = await client.post("/manufacturer/account", headers=h, json={
        **ACCOUNT, "companyName": f"Nova Metals {t}", "companyId": pune_id, "capacity": "950 t",
        "companyType": "Automotive & Machinery"})
    assert r.status_code == 201 and r.json()["approval"]["kind"] == "update"
    assert (await client.sql("SELECT production_capacity_label FROM organization_profiles WHERE organization_id=CAST(:i AS uuid)",
                             i=pune_id))[0][0] == "900 t"
    assert (await approve_company(client, pune_id)).status_code == 200
    assert (await client.sql("SELECT production_capacity_label FROM organization_profiles WHERE organization_id=CAST(:i AS uuid)",
                             i=pune_id))[0][0] == "950 t"

    # name edited after selecting -> refused (the frontend clears the selection on edit)
    r = await client.post("/manufacturer/account", headers=h, json={
        **ACCOUNT, "companyName": "Something Else", "companyId": pune_id})
    assert r.status_code == 422


async def test_new_company_duplicates_are_refused_only_in_the_same_location(client, tmp_path):  # noqa: F811
    t = _tag()
    await _import(tmp_path, f"name,country,city\nKappa Tools {t},India,Pune\n")
    a = f"user_dup_{_tag()}"
    before = await _org_count(client)
    r = await client.post("/manufacturer/account", headers=_hdr(client, a),
                          json={**ACCOUNT, "companyName": f"  kappa TOOLS {t} ", "country": "India"})
    assert r.status_code == 409 and "already registered in this country" in r.json()["detail"]
    created = await _org_count(client) - before  # only the user's own placeholder (from first use)
    r = await client.post("/manufacturer/account", headers=_hdr(client, a),
                          json={**ACCOUNT, "companyName": f"Kappa Tools {t}", "country": "Germany"})
    assert r.status_code == 201, r.text  # same name, different country: a different company
    for _ in range(2):  # repeated submissions never add organizations
        assert (await client.post("/manufacturer/account", headers=_hdr(client, a),
                                  json={**ACCOUNT, "companyName": f"Kappa Tools {t}", "country": "Germany"})).status_code == 201
    assert await _org_count(client) - before == created
    own = (await client.sql("""SELECT o.id FROM organizations o JOIN memberships m ON m.organization_id=o.id
                               JOIN users u ON u.id=m.user_id WHERE u.clerk_user_id=:c""", c=a))[0][0]
    assert (await approve_company(client, str(own))).status_code == 200
    n = (await client.sql("SELECT count(*) FROM organizations WHERE lower(display_name)=lower(:n)", n=f"Kappa Tools {t}"))[0][0]
    assert n == 2  # the imported one (India) + the user's, approved (Germany)


async def test_owner_updates_their_selected_company_and_others_only_request_changes(client):  # noqa: F811
    t = _tag()
    owner = f"user_own_{_tag()}"
    r = await client.post("/manufacturer/account", headers=_hdr(client, owner),
                          json={**ACCOUNT, "companyName": f"Sigma Fab {t}", "capacity": "10 units"})
    assert r.status_code == 201, r.text
    assert await _search(client, f"Sigma Fab {t}", owner) == []  # awaiting approval: not a listed company yet
    own = (await client.sql("""SELECT o.id FROM organizations o JOIN memberships m ON m.organization_id=o.id
                               JOIN users u ON u.id=m.user_id WHERE u.clerk_user_id=:c""", c=owner))[0][0]
    assert (await approve_company(client, str(own))).status_code == 200
    org_id = (await _search(client, f"Sigma Fab {t}", owner))[0]
    assert org_id["ownedByYou"] is True and org_id["claimed"] is True
    details = (await client.get(f"/manufacturer/companies/{org_id['id']}", headers=_hdr(client, owner))).json()
    assert details["access"] == "owner" and details["canUpdate"] is True and details["capacity"] == "10 units"

    before = await _org_count(client)
    r = await client.post("/manufacturer/account", headers=_hdr(client, owner), json={
        **ACCOUNT, "companyName": f"Sigma Fab {t}", "companyId": org_id["id"], "capacity": "25 units"})
    assert r.status_code == 201, r.text
    assert (await approve_company(client, org_id["id"])).status_code == 200  # owner's change, approved
    row = (await client.sql("SELECT production_capacity_label FROM organization_profiles WHERE organization_id=CAST(:i AS uuid)",
                            i=org_id["id"]))[0][0]
    assert row == "25 units" and await _org_count(client) == before  # persisted, no duplicate

    other = f"user_oth_{_tag()}"
    seen = (await client.get(f"/manufacturer/companies/{org_id['id']}", headers=_hdr(client, other))).json()
    # the company's own phone is shown (read-only on the form) - business information, not a person's
    assert seen["access"] == "claimed" and seen["phone"] == "+919876543210" and seen["canUpdate"] is False
    r = await client.post("/manufacturer/account", headers=_hdr(client, other), json={
        **ACCOUNT, "companyName": f"Sigma Fab {t}", "companyId": org_id["id"], "capacity": "1 unit"})
    # No longer refused: staged as an update request for admin review (test_company_update_requests.py).
    assert r.status_code == 201, r.text
    assert r.json()["submitted"]["kind"] == "update_request"
    row = (await client.sql("SELECT production_capacity_label FROM organization_profiles WHERE organization_id=CAST(:i AS uuid)",
                            i=org_id["id"]))[0][0]
    assert row == "25 units"
    members = await client.sql("""SELECT u.clerk_user_id FROM memberships m JOIN users u ON u.id=m.user_id
                                  WHERE m.organization_id=CAST(:i AS uuid)""", i=org_id["id"])
    assert [m[0] for m in members] == [owner]  # selecting granted nothing


async def test_search_and_details_require_a_registered_user(client):  # noqa: F811
    sub = f"user_unreg_{_tag()}"
    client.unregistered.add(sub)
    for path in ["/manufacturer/companies/search?q=ab", f"/manufacturer/companies/{uuid.uuid4()}"]:
        r = await client.get(path, headers=_hdr(client, sub))
        assert r.status_code == 403 and r.json()["code"] == "registration_required"


async def test_companies_seeded_with_plain_defaults_are_searchable(client):  # noqa: F811
    """Rows loaded straight into the tables (entry_source left at its default 'MANUFACTURER',
    no creator, no profile/facility) must appear in search and load by id."""
    t = _tag()
    seeded = (await client.sql("""INSERT INTO organizations (display_name, legal_name, organization_type, status)
                                  VALUES (:n, :l, 'manufacturer', 'active') RETURNING id""",
                               n=f"Omega Castings {t}", l=f"Omega Castings Private Limited {t}"))[0][0]
    items = await _search(client, f"omega castings {t}")
    assert [i["id"] for i in items] == [str(seeded)]
    assert [i["id"] for i in await _search(client, f"private limited {t}")] == [str(seeded)]  # legal name
    d = (await client.get(f"/manufacturer/companies/{seeded}", headers=_hdr(client, f"user_sd_{_tag()}"))).json()
    assert d["companyName"] == f"Omega Castings {t}" and d["access"] == "unclaimed" and d["canUpdate"] is True


async def test_two_users_completing_the_same_unclaimed_company_at_once(client, tmp_path):  # noqa: F811
    import asyncio
    t = _tag()
    rep = await _import(tmp_path, f"name,country,city\nRace Fab {t},India,Hosur\n")
    org = rep.inserted[0][2]
    subs = [f"user_race{i}_{_tag()}" for i in range(2)]
    for sub in subs:
        assert (await client.get("/manufacturer/bootstrap", headers=_hdr(client, sub))).status_code == 200
    results = await asyncio.gather(*[client.post("/manufacturer/account", headers=_hdr(client, sub), json={
        **ACCOUNT, "companyName": f"Race Fab {t}", "companyId": org}) for sub in subs])
    assert sorted(r.status_code for r in results) == [201, 409]  # one claim awaits review, the other is refused
    assert (await client.sql("""SELECT count(*) FROM manufacturer_submissions WHERE target_organization_id=CAST(:i AS uuid)
                                AND status='pending'""", i=org))[0][0] == 1
    assert (await approve_company(client, org)).status_code == 200
    owners = await client.sql("SELECT count(*) FROM memberships WHERE organization_id=CAST(:i AS uuid) AND status='active'", i=org)
    assert owners[0][0] == 1
