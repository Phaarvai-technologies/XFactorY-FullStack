"""Unit tests (no database) for the onboarding-source rules and every backfill classification branch."""
import csv
from pathlib import Path

import pytest

from app.backfill_onboarding_source import (Decision, classify_company, classify_user, read_evidence, summary,
                                            write_report)
from app.core import onboarding_source as src
from app.schemas.manufacturer import AccountPayload

ORG = "11111111-1111-1111-1111-111111111111"


def facts(**over):
    base = {"id": ORG, "display_name": "Acme", "app_created": False, "clerk_org": False, "entry_source": "MANUFACTURER",
            "record_type": "REAL", "is_archived": False, "created_at": "2026-01-01", "registration_id": None,
            "entry_source_admin_edited": False, "imported_event": False, "new_company_submission": False,
            "details_form_submitted": False, "category_saved": False, "workspace_for_other_company": False,
            "creator_is_owner": False}
    return {**base, **over}


def company(f, ids=frozenset(), regs=None, accept=False):
    d = classify_company(f, set(ids), regs or {}, accept)
    return d.outcome, d.rule, d.proposed


# ------------------------------------------------------------------ onboarding_source module
def test_available_and_unavailable_channels():
    assert src.require("database_import") == "database_import"
    assert src.require("web_dashboard") == "web_dashboard"
    assert src.require("admin_entry") == "admin_entry"
    for name in ("ai_voice_call", "ground_sales", "admin_review", "", "WEB_DASHBOARD"):
        with pytest.raises(src.SourceUnavailable):
            src.require(name)


def test_labels():
    assert [src.label(k) for k in ("database_import", "web_dashboard", "ai_voice_call", "ground_sales", "admin_entry")] \
        == ["Database Import", "Web Dashboard", "AI Voice Call", "Ground Sales", "Admin Entry"]
    assert src.label(None) == src.label("") == "Unknown"
    assert src.label("something_new") == "something_new"


@pytest.mark.parametrize("key", sorted(src.CLIENT_SOURCE_KEYS))
def test_every_client_source_key_is_rejected(key):
    with pytest.raises(ValueError, match="assigned by X!Y"):
        src.reject_client_source({"companyName": "A", key: "web_dashboard"})


def test_bodies_without_source_pass_through_unchanged():
    body = {"companyName": "A"}
    assert src.reject_client_source(body) is body
    assert src.reject_client_source(["not", "a", "dict"]) == ["not", "a", "dict"]


def test_account_payload_rejects_source_and_accepts_normal_body():
    good = {"firstName": "A", "lastName": "B", "contact": "a@b.co", "dob": "1990-01-01", "companyName": "C",
            "companyType": "Other", "country": "India", "phone": "9876543210"}
    assert AccountPayload(**good).companyName == "C"
    with pytest.raises(ValueError):
        AccountPayload(**good, onboardingSource="ai_voice_call")


# ------------------------------------------------------------------ company classification
def test_import_evidence_rules():
    assert company(facts(), ids={ORG}) == ("assign", "E1", "database_import")
    assert company(facts(registration_id="GST-9"), regs={"gst-9": 1}) == ("assign", "E1", "database_import")
    assert company(facts(imported_event=True)) == ("assign", "I1", "database_import")
    assert company(facts(entry_source="IMPORTED")) == ("assign", "I2", "database_import")


def test_registration_id_listed_twice_is_a_conflict():
    assert company(facts(registration_id="GST-9"), regs={"gst-9": 2})[:2] == ("conflict", "E1")


def test_registration_id_not_listed_is_not_evidence():
    assert company(facts(registration_id="GST-9"), regs={"other": 1})[0] == "needs_confirmation"


def test_import_evidence_on_an_app_created_company_is_a_conflict():
    assert company(facts(app_created=True, entry_source="IMPORTED"))[:2] == ("conflict", "X1")
    assert company(facts(app_created=True), ids={ORG})[:2] == ("conflict", "X1")
    assert company(facts(app_created=True, new_company_submission=True, imported_event=True))[:2] == ("conflict", "X1")


def test_web_dashboard_rules():
    assert company(facts(app_created=True, new_company_submission=True)) == ("assign", "W1", "web_dashboard")
    legacy = facts(app_created=True, details_form_submitted=True, category_saved=True, creator_is_owner=True)
    assert company(legacy) == ("assign", "W2", "web_dashboard")


@pytest.mark.parametrize("missing", ["details_form_submitted", "category_saved", "creator_is_owner"])
def test_legacy_dashboard_rule_needs_every_condition(missing):
    f = facts(app_created=True, details_form_submitted=True, category_saved=True, creator_is_owner=True)
    f[missing] = False
    assert company(f)[:2] == ("unresolved", "U-PLACEHOLDER")


def test_claim_workspace_is_never_a_company():
    f = facts(app_created=True, details_form_submitted=True, category_saved=True, creator_is_owner=True,
              workspace_for_other_company=True)
    d = classify_company(f, set(), {}, False)
    assert (d.outcome, d.rule) == ("unresolved", "U-PLACEHOLDER") and "claimed" in d.evidence["why"]


def test_unresolved_reasons():
    d = classify_company(facts(app_created=True), set(), {}, False)
    assert d.rule == "U-PLACEHOLDER" and "no company details were ever submitted" in d.evidence["why"]
    d = classify_company(facts(clerk_org=True), set(), {}, False)
    assert d.rule == "U-CLERK-ORG" and "Clerk organization" in d.evidence["why"]
    d = classify_company(facts(entry_source="IMPORTED", entry_source_admin_edited=True), set(), {}, False)
    assert d.rule == "U-ADMIN-EDIT" and d.proposed is None


def test_admin_edited_import_mark_with_real_evidence_still_assigns():
    assert company(facts(entry_source="IMPORTED", entry_source_admin_edited=True), ids={ORG})[:2] == ("assign", "E1")


def test_direct_database_load_needs_confirmation():
    assert company(facts()) == ("needs_confirmation", "D1", "database_import")
    assert company(facts(), accept=True) == ("assign", "D1", "database_import")
    assert company(facts(entry_source="ADMIN_ASSISTED"))[:2] == ("needs_confirmation", "D1")


def test_admin_entry_is_never_proposed_without_a_creation_event():
    for f in (facts(), facts(entry_source="ADMIN_ASSISTED"), facts(app_created=True)):
        for accept in (False, True):
            assert classify_company(f, set(), {}, accept).proposed != "admin_entry"


# ------------------------------------------------------------------ user classification
def user(**over):
    return {"id": ORG, "email": "a@b.co", "staff_account": False, "registration_method": None, "registered": False,
            **over}


@pytest.mark.parametrize("over,expected", [
    ({"staff_account": True}, ("assign", "U1", "admin_portal")),
    ({"registered": True, "registration_method": "manual"}, ("assign", "U2", "web_signup")),
    ({"registered": True, "registration_method": "google"}, ("assign", "U2", "web_signup")),
    ({"registered": True, "registration_method": "legacy"}, ("assign", "U3", "legacy_account")),
    ({"registered": True, "registration_method": "legacy_terms"}, ("assign", "U3", "legacy_account")),
    ({"registered": False, "registration_method": "google"}, ("unresolved", "U-NONE", None)),
    ({"registered": True, "registration_method": "mystery"}, ("unresolved", "U-NONE", None)),
    ({}, ("unresolved", "U-NONE", None)),
])
def test_user_rules(over, expected):
    d = classify_user(user(**over))
    assert (d.outcome, d.rule, d.proposed) == expected


# ------------------------------------------------------------------ evidence file, report, summary
def test_evidence_file_ids_and_registration_ids(tmp_path):
    p = tmp_path / "e.csv"
    p.write_text(f"Organization_ID,registration_id\n{ORG.upper()},GST-1\n,gst-1\n,GST-2\n")
    ids, regs = read_evidence(p)
    assert ids == {ORG} and regs == {"gst-1": 2, "gst-2": 1}
    assert read_evidence(None) == (set(), {})


def test_evidence_file_rejects_bad_ids(tmp_path):
    p = tmp_path / "e.csv"
    p.write_text("organization_id\nnot-a-uuid\n")
    with pytest.raises(SystemExit):
        read_evidence(p)


def test_report_and_summary(tmp_path):
    ds = [Decision("company", ORG, "Acme", "onboarding_source", "database_import", "assign", "I2",
                   {"evidence": ["a", "b"]}),
          Decision("user", ORG, "a@b.co", "registration_channel", None, "unresolved", "U-NONE", {"why": "not registered"})]
    p = tmp_path / "r.csv"
    write_report(ds, p)
    rows = list(csv.reader(Path(p).open()))
    assert rows[1][5:9] == ["database_import", "assign", "I2", "a; b"]
    assert rows[2][5:9] == ["", "unresolved", "U-NONE", "not registered"]
    lines = summary(ds)
    assert len(lines) == 2 and any("I2" in x and x.rstrip().endswith("1") for x in lines)


# ------------------------------------------------------------------ admin entry + staged creations
def test_admin_creation_event_is_admin_entry():
    assert company(facts(admin_created_event=True)) == ("assign", "A1", "admin_entry")


def test_admin_creation_event_conflicting_with_other_evidence():
    assert company(facts(admin_created_event=True, entry_source="IMPORTED"))[:2] == ("conflict", "X1")
    assert company(facts(admin_created_event=True, app_created=True))[:2] == ("conflict", "X1")


def test_unapproved_new_company_waits_for_approval():
    d = classify_company(facts(app_created=True, unapproved_new_company_submission=True), set(), {}, False)
    assert (d.outcome, d.rule, d.proposed) == ("unresolved", "U-NOT-APPROVED", None)
    assert "copied to the company automatically when it is approved" in d.evidence["why"]


def test_approval_or_edits_alone_never_give_admin_entry():
    # approvals / admin edits are not creation evidence: no admin event -> not admin_entry
    for f in (facts(entry_source="ADMIN_ASSISTED"), facts(entry_source_admin_edited=True)):
        assert classify_company(f, set(), {}, True).proposed != "admin_entry"
