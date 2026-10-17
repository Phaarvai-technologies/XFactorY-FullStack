"""Admin approval of submitted company details (staging) + Visionary eligibility.

Real Postgres (E2E_DATABASE_URL), real HTTP endpoints, decisions through the real admin API."""
import asyncio
import os
import uuid
from pathlib import Path

import pytest

from test_e2e_local import PNG, approve_company, client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


def _tag():
    return uuid.uuid4().hex[:6]


def account(name, **over):
    return {"firstName": "Asha", "lastName": "Rao", "contact": "asha@factory.in", "dob": "1990-02-02",
            "companyName": name, "companyType": "Automotive & Machinery", "country": "India",
            "phone": "+91 90000 11111", "capacity": "500 units/month", **over}


PROFILE = {  # every remaining required section
    "company": {"logo": PNG, "about": "Precision castings.", "estYear": "2001", "employees": "40"},
    "location": {"address": "Plot 9, SIPCOT", "city": "Hosur", "state": "Tamil Nadu", "country": "India"},
    "certifications": [{"name": "ISO 9001", "body": "TUV", "fileName": "", "status": "Pending"}],
    "infra": {"electricity": "250 kVA"},
    "faqs": [{"q": "MOQ?", "a": "200"}],
}
MACHINE = {"industry": "Metal", "subcategory": "Casting", "type": "Die Casting", "capacity": "100", "age": "2",
           "condition": "Good", "technical": "", "images": [], "rawMatStatus": "", "materialDetails": "",
           "laborType": "", "workerCount": "", "workerRoles": "", "logistics": [], "logisticsPartner": "",
           "pricing": {"hour": "", "day": "", "month": "", "unit": "", "batch": ""}, "insurance": "",
           "status": "Published"}


def hdr(c, sub):
    return {"Authorization": f"Bearer {c.token_for(sub)}"}


async def own_org(c, sub):
    return str((await c.sql("""SELECT o.id FROM organizations o JOIN memberships m ON m.organization_id=o.id
                               AND m.status='active' JOIN users u ON u.id=m.user_id
                               WHERE u.clerk_user_id=:s AND NOT o.is_archived""", s=sub))[0][0])


async def submissions(c, org):
    return await c.sql("""SELECT kind, status, reviewed_by_user_id IS NOT NULL, reviewed_at IS NOT NULL,
                                 review_feedback, applied_at IS NOT NULL
                          FROM manufacturer_submissions WHERE target_organization_id=CAST(:o AS uuid)
                          ORDER BY created_at""", o=org)


async def complete_profile(c, h):
    r = await c.patch("/manufacturer/profile", headers=h, json=PROFILE)
    assert r.status_code == 200, r.text
    r = await c.post("/manufacturer/machinery", headers=h, json=MACHINE)
    assert r.status_code == 201, r.text


async def visible(c, org) -> bool:
    v = hdr(c, f"vis_{_tag()}")
    listed = org in {m["id"] for m in (await c.get("/visionary/manufacturers", headers=v)).json()}
    page = (await c.get(f"/visionary/manufacturers/{org}", headers=v)).status_code
    assert (page == 200) == listed, (page, listed)  # search and direct profile access agree
    return listed


async def booking_status(c, org) -> int:
    v = hdr(c, f"vis_{_tag()}")
    assert (await c.put("/visionary/project/idea", headers=v, json={
        "project": "Brackets", "idea": "Steel brackets", "product": "Bracket", "industry": "Automotive"})).status_code == 200
    r = await c.post("/visionary/requests", headers=v, json={
        "manufacturer_id": org, "machine": "Die Casting", "quantity": {"value": 10, "unit": "units"},
        "required_duration": "1_week", "manufacturing_location": "Hosur",
        "budget": {"amount": 1000, "currency": "INR"}, "timeline": "immediately"})
    return r.status_code


async def eligibility(c, h) -> dict:
    return (await c.get("/manufacturer/bootstrap", headers=h)).json()["approval"]


# ---------------------------------------------------------------- 1. one pending submission
async def test_submitting_details_creates_one_pending_submission_and_stages_it(client):  # noqa: F811
    t, sub = _tag(), f"user_ap1_{_tag()}"
    h = hdr(client, sub)
    results = await asyncio.gather(*[client.post("/manufacturer/account", headers=h, json=account(f"Alpha Cast {t}"))
                                     for _ in range(3)])  # double / triple submit
    assert [r.status_code for r in results] == [201, 201, 201]
    org = await own_org(client, sub)
    assert [tuple(x) for x in await submissions(client, org)] == [("new_company", "pending", False, False, None, False)]
    # main record unchanged (staged), the owner sees what they entered, admin sees it awaiting review
    main = (await client.sql("SELECT display_name FROM organizations WHERE id=CAST(:o AS uuid)", o=org))[0][0]
    assert main != f"Alpha Cast {t}"
    boot = (await client.get("/manufacturer/bootstrap", headers=h)).json()
    assert boot["state"]["account"]["companyName"] == f"Alpha Cast {t}" and boot["approval"]["status"] == "pending"
    q_admin = f"admin_q_{_tag()}"
    ah = hdr(client, q_admin)
    await client.get("/identity/me", headers=ah)
    await client.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                        SELECT id, 'verification_analyst' FROM users WHERE clerk_user_id=:s""", s=q_admin)
    queue = (await client.get("/admin/review-queue", headers=ah, params={"q": t})).json()["rows"]
    assert [(r["id"], r["companyName"], r["reviewStatus"]) for r in queue] == [(org, f"Alpha Cast {t}", "SUBMITTED")]
    d = (await client.get(f"/admin/manufacturers/{org}", headers=ah)).json()
    fields = {f["key"]: (f["submitted"], f["current"]) for f in d["pendingSubmission"]["fields"]}
    assert fields["companyName"][0] == f"Alpha Cast {t}" and d["pendingSubmission"]["kind"] == "new_company"
    assert fields["companyName"][1] == main  # "current record" = the unchanged main record
    assert d["pendingSubmission"]["submittedBy"]["email"]


# ---------------------------------------------------------------- 2-4. pending -> approve -> complete
async def test_sections_locked_while_pending_and_both_conditions_are_needed(client):  # noqa: F811
    t, sub = _tag(), f"user_ap2_{_tag()}"
    h = hdr(client, sub)
    assert (await client.post("/manufacturer/account", headers=h, json=account(f"Beta Forge {t}"))).status_code == 201
    org = await own_org(client, sub)

    # approval first: every remaining section is locked while pending (also through the API)
    blocked = [await client.patch("/manufacturer/profile", headers=h, json=PROFILE),
               await client.post("/manufacturer/machinery", headers=h, json=MACHINE),
               await client.patch("/manufacturer/availability", headers=h, json={"calendar": {"2026-11-01": "blocked"}})]
    assert [r.status_code for r in blocked] == [403, 403, 403]
    assert all("awaiting admin approval" in r.text for r in blocked)
    e = await eligibility(client, h)
    assert e["status"] == "pending" and e["eligibility"]["approved"] is False
    assert e["access"]["unlocked"] is False and e["access"]["message"] == \
        "Your manufacturer application is awaiting admin approval."
    assert e["eligibility"]["visibleToVisionaries"] is False and e["eligibility"]["bookingAvailable"] is False
    assert not await visible(client, org) and await booking_status(client, org) == 404

    # approval merges the reviewed details into the main record, once
    r = await approve_company(client, org, reason="Looks good")
    assert r.status_code == 200, r.text
    assert (await eligibility(client, h))["access"]["unlocked"] is True
    await complete_profile(client, h)  # the remaining sections are open now
    row = (await client.sql("""SELECT o.display_name, op.company_category, op.country_name, op.production_capacity_label,
                                      op.contact_email, mo.status, mo.reviewed_by_user_id IS NOT NULL
                               FROM organizations o JOIN organization_profiles op ON op.organization_id=o.id
                               JOIN manufacturer_onboarding mo ON mo.organization_id=o.id
                               WHERE o.id=CAST(:o AS uuid)""", o=org))[0]
    # the applicant's personal email never becomes the company's contact email
    assert tuple(row) == (f"Beta Forge {t}", "Automotive & Machinery", "India", "500 units/month",
                          None, "approved", True)
    assert [tuple(x) for x in await submissions(client, org)] == [("new_company", "approved", True, True, "Looks good", True)]
    # approved AND 100% complete -> visible, searchable, bookable
    e = await eligibility(client, h)
    assert e["eligibility"] == {"approved": True, "complete": True, "completeness": 100,
                                "visibleToVisionaries": True, "bookingAvailable": True}
    assert await visible(client, org) and await booking_status(client, org) == 201
    # repeated approval does nothing (nothing pending)
    again = await approve_company(client, org)
    assert again.status_code == 422
    assert len(await submissions(client, org)) == 1


async def test_approval_without_complete_profile_is_not_enough(client):  # noqa: F811
    t, sub = _tag(), f"user_ap3_{_tag()}"
    h = hdr(client, sub)
    assert (await client.post("/manufacturer/account", headers=h, json=account(f"Gamma Mould {t}"))).status_code == 201
    org = await own_org(client, sub)
    await client.post("/manufacturer/machinery", headers=h, json=MACHINE)
    assert (await approve_company(client, org)).status_code == 200
    e = (await eligibility(client, h))["eligibility"]
    assert e["approved"] is True and e["complete"] is False and e["completeness"] < 100
    assert not await visible(client, org) and await booking_status(client, org) == 404
    await complete_profile(client, h)  # now both hold
    assert await visible(client, org)


async def test_complete_profile_without_approval_is_not_enough(client):  # noqa: F811
    """A fully complete main record whose approval is withdrawn (or rejected) is not eligible."""
    t, sub = _tag(), f"user_ap4_{_tag()}"
    h = hdr(client, sub)
    assert (await client.post("/manufacturer/account", headers=h, json=account(f"Delta Press {t}"))).status_code == 201
    org = await own_org(client, sub)
    assert (await approve_company(client, org)).status_code == 200
    await complete_profile(client, h)
    assert await visible(client, org)
    r = await approve_company(client, org, decision="NEEDS_CORRECTION", reason="Re-check certificates")
    assert r.status_code == 200, r.text
    e = (await eligibility(client, h))["eligibility"]
    assert e["complete"] is True and e["approved"] is False
    assert not await visible(client, org) and await booking_status(client, org) == 404


# ---------------------------------------------------------------- 5. rejections, corrections, retries
async def test_rejection_and_corrections_never_overwrite_or_duplicate(client):  # noqa: F811
    t, sub = _tag(), f"user_ap5_{_tag()}"
    h = hdr(client, sub)
    assert (await client.post("/manufacturer/account", headers=h, json=account(f"Eps Tools {t}"))).status_code == 201
    org = await own_org(client, sub)
    before = (await client.sql("SELECT display_name FROM organizations WHERE id=CAST(:o AS uuid)", o=org))[0][0]

    r = await approve_company(client, org, decision="NEEDS_CORRECTION")
    assert r.status_code == 422  # feedback is required
    r = await approve_company(client, org, decision="NEEDS_CORRECTION", reason="Use the registered company name",
                              correction_fields=["companyName"])
    assert r.status_code == 200 and r.json()["manufacturer"]["reviewStatus"] == "NEEDS_CORRECTION"
    e = await eligibility(client, h)
    assert e["feedback"] == "Use the registered company name"
    assert e["access"]["status"] == "changes_requested" and e["access"]["unlocked"] is False
    assert e["access"]["application"]["correctionFields"] == ["companyName"]
    # only the listed field may change
    r = await client.post("/manufacturer/account", headers=h, json=account(f"Eps Tools Pvt Ltd {t}", capacity="9 t"))
    assert r.status_code == 422 and "Production capacity" in r.text
    # corrected resubmission updates the same submission (no duplicate)
    assert (await client.post("/manufacturer/account", headers=h,
                              json=account(f"Eps Tools Pvt Ltd {t}"))).status_code == 201
    subs = await submissions(client, org)
    assert [(x[0], x[1]) for x in subs] == [("new_company", "pending")]
    # resubmission alone never unlocks
    assert (await client.patch("/manufacturer/profile", headers=h, json=PROFILE)).status_code == 403

    r = await approve_company(client, org, decision="REJECTED")
    assert r.status_code == 422  # a reason is required
    r = await approve_company(client, org, decision="REJECTED", reason="Not a manufacturer")
    assert r.status_code == 200 and r.json()["manufacturer"]["reviewStatus"] == "REJECTED"
    assert (await client.sql("SELECT display_name FROM organizations WHERE id=CAST(:o AS uuid)", o=org))[0][0] == before
    subs = await submissions(client, org)
    assert [tuple(x) for x in subs] == [("new_company", "rejected", True, True, "Not a manufacturer", False)]
    # rejected: everything stays locked; the applicant sees the reason and when to apply again
    assert (await client.patch("/manufacturer/profile", headers=h, json=PROFILE)).status_code == 403
    assert not await visible(client, org)
    e = await eligibility(client, h)
    assert e["access"]["status"] == "rejected" and e["access"]["application"]["feedback"] == "Not a manufacturer"
    assert e["access"]["reapplyAt"] and e["access"]["canReapply"] is False
    # a fresh application only 24 hours after the rejection (enforced by the backend)
    r = await client.post("/manufacturer/account", headers=h, json=account(f"Eps Tools {t}"))
    assert r.status_code == 409 and "apply again from" in r.json()["detail"]
    assert len(await submissions(client, org)) == 1
    await client.sql("""UPDATE manufacturer_submissions SET reviewed_at = now() - interval '25 hours'
                        WHERE target_organization_id = CAST(:o AS uuid)""", o=org)
    assert (await eligibility(client, h))["access"]["canReapply"] is True
    # the new attempt is a new submission (the rejected one is kept as history)
    assert (await client.post("/manufacturer/account", headers=h, json=account(f"Eps Tools {t}"))).status_code == 201
    assert [x[1] for x in await submissions(client, org)] == ["rejected", "pending"]


async def test_claim_of_seeded_company_rejected_or_approved(client, tmp_path):  # noqa: F811
    from app.core.database import SessionFactory
    from app.import_manufacturers import import_rows, read_rows
    t = _tag()
    path = Path(tmp_path) / "m.csv"
    path.write_text(f"name,country,city,category,capacity\nSeeded Cast {t},India,Hosur,Automotive & Machinery,700 t\n")
    async with SessionFactory() as session:
        seeded = (await import_rows(session, read_rows(path))).inserted[0][2]
        await session.commit()

    # seeded companies are selectable in onboarding search but never visible to Visionaries
    a = f"user_cl_{_tag()}"
    ha = hdr(client, a)
    found = (await client.get("/manufacturer/companies/search", headers=ha, params={"q": f"Seeded Cast {t}"})).json()
    assert [i["id"] for i in found["items"]] == [seeded]
    assert not await visible(client, seeded)

    def snap():
        return client.sql("""SELECT o.display_name, o.status, op.company_category, op.production_capacity_label,
                                    (SELECT count(*) FROM memberships m WHERE m.organization_id=o.id AND m.status='active')
                             FROM organizations o JOIN organization_profiles op ON op.organization_id=o.id
                             WHERE o.id=CAST(:o AS uuid)""", o=seeded)
    original = await snap()
    r = await client.post("/manufacturer/account", headers=ha, json=account(f"Seeded Cast {t}", companyId=seeded,
                                                                          capacity="1 t", companyType="Other"))
    assert r.status_code == 201, r.text
    # approval first: the claimant cannot build a profile while the claim is pending
    assert (await client.patch("/manufacturer/profile", headers=ha, json=PROFILE)).status_code == 403
    assert await snap() == original  # nothing written to the seeded company before approval
    assert (await approve_company(client, seeded, decision="REJECTED", reason="Could not verify")).status_code == 200
    assert await snap() == original  # rejected claim: untouched
    assert not await visible(client, seeded)

    # another user claims it and is approved: saved values kept, missing ones filled, ownership
    # granted (the company had none); the profile is completed after approval -> eligible
    b = f"user_cl2_{_tag()}"
    hb = hdr(client, b)
    assert (await client.post("/manufacturer/account", headers=hb, json=account(
        f"Seeded Cast {t}", companyId=seeded, capacity="1 t", companyType="Other"))).status_code == 201
    workspace = await own_org(client, b)
    assert workspace != seeded
    assert (await approve_company(client, seeded)).status_code == 200
    await complete_profile(client, hb)
    row = (await snap())[0]
    assert tuple(row) == (f"Seeded Cast {t}", "active", "Automotive & Machinery", "700 t", 1)
    merged = (await client.sql("""SELECT op.about_company, f.city,
                                         (SELECT count(*) FROM organization_certifications c WHERE c.organization_id=o.id),
                                         (SELECT count(*) FROM machines m WHERE m.organization_id=o.id)
                                  FROM organizations o JOIN organization_profiles op ON op.organization_id=o.id
                                  JOIN facilities f ON f.organization_id=o.id AND f.is_headquarters
                                  WHERE o.id=CAST(:o AS uuid)""", o=seeded))[0]
    assert tuple(merged) == ("Precision castings.", "Hosur", 1, 1)
    ws = (await client.sql("SELECT is_archived FROM organizations WHERE id=CAST(:o AS uuid)", o=workspace))[0][0]
    assert ws is True  # workspace retired, not deleted
    assert await own_org(client, b) == seeded
    assert await visible(client, seeded)


# ---------------------------------------------------------------- 10. rules in one place
def test_eligibility_rules_are_centralized(monkeypatch):
    from app.core import eligibility
    assert eligibility.evaluate("approved", 100)["visibleToVisionaries"] is True
    assert eligibility.evaluate("approved", 99)["visibleToVisionaries"] is False
    assert eligibility.evaluate("submitted", 100)["bookingAvailable"] is False
    assert "completeness >= 100" in eligibility.sql_condition("visionary_visible")
    # changing a rule later is a one-line edit: e.g. approval alone
    monkeypatch.setitem(eligibility.RULES, "visionary_visible", ("approved",))
    assert eligibility.evaluate("approved", 10)["visibleToVisionaries"] is True
    assert "completeness" not in eligibility.sql_condition("visionary_visible")
    assert eligibility.evaluate("approved", 10)["bookingAvailable"] is False
