"""Approval-first manufacturer onboarding: one applicant's application and its review.

Approval comes first. A signed-in user who wants to become a manufacturer submits BASIC details
(company information + their own personal information). Nothing else in the manufacturer
area - company profile, machinery, availability, bookings - opens until an X!Y admin approves
that application AND the user has the needed company permission (`access`). The rule is checked
by every manufacturer write API, not only by the frontend.

Two kinds of application (stored in `manufacturer_submissions`, the existing staging table):

  new_company  - no company selected: the details describe a NEW company. They stay staged on the
                 submission; the user's own organization (created for them at sign-up) receives
                 them only when an admin approves. The first approved registering user of a new
                 company is its primary user (owner) - the existing membership of that
                 organization, nothing is transferred.
  join_company - an EXISTING company selected from the list (by database id). Saved company
                 details are re-read on the backend and can never be overwritten by the
                 application (a value that differs from a saved one is refused). Details the
                 company does NOT have yet (missing = null / empty / whitespace) may be supplied:
                 they stay in the pending submission (`payload.additions`) and are written on
                 approval only to fields that are STILL missing then - never over a value another
                 approved submission supplied meanwhile. The company phone is required: the saved
                 one, or a supplied Indian number. Corrections to saved values follow the
                 admin-reviewed update process (`company_update_requests`). Approval links
                 the applicant to the company as a MEMBER; ownership is never transferred by
                 approval - an admin may explicitly make the applicant the primary user only when
                 the company has no owner. The company's own approval, owner and other members
                 are untouched by this applicant's review.
  (claim      - older open applications for an existing company are reviewed like join_company.)

Review (admins with DECIDE_ROLES only): approve, request corrections (the admin chooses the fields
the applicant may change; everything else stays as submitted), or reject (a user-facing reason,
kept apart from confidential internal notes). Each decision is applied once (row lock + status
check + optional "seen" stamp), recorded in the submission's history and sent to the applicant
only. Rejection locks only that application; the user's account, other roles and other users of
the company are unaffected. Reapplying after a rejection follows `Settings.manufacturer_reapply_
after_days` - NOT DECIDED YET; while unset, reapplying is not available.

Personal information (first / last name, personal email, date of birth) belongs to the user
record; the company's contact details are never filled from it.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import company_update_requests as update_requests
from app import manufacturer_approval as approval
from app import notifications
from app.core import onboarding_source

OPEN = ("pending", "changes_requested")
APPLICATION_KINDS = ("new_company", "join_company", "claim")
APPLICATION_KINDS_SQL = "('new_company', 'join_company', 'claim')"
# Who may decide an application (support specialists may read, not decide).
DECIDE_ROLES = ("platform_administrator", "platform_operator", "verification_analyst")
# Company membership roles that may work on the company's profile, listings and availability.
EDIT_ROLES = ("owner", "admin", "member")
EDIT_ROLES_SQL = "('owner', 'admin', 'member')"

PERSONAL_FIELDS = (("firstName", "First name"), ("lastName", "Last name"),
                   ("personalEmail", "Personal email"), ("dob", "Date of birth"))
COMPANY_FIELDS = (("companyName", "Company name"), ("companyType", "Company category"),
                  ("country", "Company location"), ("companyPhone", "Company phone number"),
                  ("capacity", "Production capacity"))
SELECTION = ("company", "Selected company")
LABELS = dict((*PERSONAL_FIELDS, *COMPANY_FIELDS, SELECTION))
COMPANY_KEYS = tuple(k for k, _ in COMPANY_FIELDS)
PERSONAL_KEYS = tuple(k for k, _ in PERSONAL_FIELDS)
# company form key -> key in the staged payload / update request
PAYLOAD_KEY = {"companyName": "companyName", "companyType": "companyType", "country": "country",
               "companyPhone": "contactPhone", "capacity": "capacity"}
LIMITS = {"companyName": 200, "companyType": 150, "country": 100, "capacity": 100,
          "firstName": 100, "lastName": 100, "personalEmail": 320}
KIND_LABELS = {"new_company": "New company", "join_company": "Join an existing company",
               "claim": "Existing company (older request)"}
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
DECISIONS = {"approve": "approved", "request_changes": "changes_requested", "reject": "rejected"}


class ApplicationError(Exception):
    """An action that cannot be carried out; `status` is the HTTP status, `code` a stable id."""

    def __init__(self, message: str, status: int = 409, code: str | None = None, field: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.field = field


def _json(value) -> dict:
    if value is None:
        return {}
    return json.loads(value) if isinstance(value, (str, bytes)) else dict(value)


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


# ------------------------------------------------------------------ validation
PHONE_HINT = "Enter a valid Indian phone number, e.g. +91 98765 43210 or 044 2345 6789."


def normalize_indian_phone(value: Any) -> str:
    """A company phone number in India, returned as +91 followed by the 10-digit national
    number (E.164). Accepts +91 / 91 / 0 prefixes, spaces, dashes, dots and brackets."""
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("Enter the company phone number.")
    if not re.fullmatch(r"\+?[0-9\s\-().]{7,20}", raw):
        raise ValueError(PHONE_HINT)
    digits = re.sub(r"\D", "", raw)
    if raw.startswith("+"):
        if not digits.startswith("91"):
            raise ValueError("Enter an Indian phone number (country code +91).")
        digits = digits[2:]
    elif len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] == "0" or len(set(digits)) == 1:
        raise ValueError(PHONE_HINT)
    return "+91" + digits


def valid_email(value: Any) -> str:
    email = str(value or "").strip()
    if not email:
        raise ValueError("Enter your personal email address.")
    if len(email) > LIMITS["personalEmail"] or not EMAIL_RE.match(email):
        raise ValueError("Enter a valid personal email address.")
    return email


def _text(key: str, value: Any, required: bool) -> str:
    value = _clean(value)
    if required and not value:
        raise ValueError(f"{LABELS[key]} is required.")
    if len(value) > LIMITS[key]:
        raise ValueError(f"{LABELS[key]} is too long.")
    return value


def _field(key: str, fn, *args):
    try:
        return fn(*args)
    except ValueError as exc:
        raise ApplicationError(str(exc), 422, "invalid_field", field=key) from exc


def _dob(value: Any) -> str:
    if isinstance(value, str):
        try:
            value = date.fromisoformat(value)
        except ValueError:
            raise ValueError("Enter a valid date of birth.") from None
    if not value:
        raise ValueError("Date of birth is required.")
    if value > date.today():
        raise ValueError("Date of birth cannot be in the future.")
    if value.year < 1900:
        raise ValueError("Enter a valid date of birth.")
    return value.isoformat()


def personal_values(data: dict) -> dict:
    """The registering user's own details (validated on the backend, whatever the client did)."""
    return {"firstName": _field("firstName", _text, "firstName", data.get("firstName"), True),
            "lastName": _field("lastName", _text, "lastName", data.get("lastName"), True),
            "personalEmail": _field("personalEmail", valid_email, data.get("personalEmail")),
            "dob": _field("dob", _dob, data.get("dob"))}


def company_values(data: dict) -> dict:
    """A NEW company's details (all required; phone normalized to +91)."""
    return {"companyName": _field("companyName", _text, "companyName", data.get("companyName"), True),
            "companyType": _field("companyType", _text, "companyType", data.get("companyType"), True),
            "country": _field("country", _text, "country", data.get("country"), True),
            "companyPhone": _field("companyPhone", normalize_indian_phone, data.get("companyPhone")),
            "capacity": _field("capacity", _text, "capacity", data.get("capacity"), False)}


def correctable(kind: str) -> tuple[str, ...]:
    """Fields an admin may ask the applicant to correct, per application kind. For an existing
    company the company fields are corrected through a staged company correction, never directly."""
    if kind == "new_company":
        return (*PERSONAL_KEYS, *COMPANY_KEYS)
    return (*PERSONAL_KEYS, SELECTION[0], *COMPANY_KEYS)


def _form_values(payload: dict, target_id: Any) -> dict:
    """Comparable form values of a staged payload (to find what a resubmission changed)."""
    applicant = payload.get("applicant") or {}
    values = {k: _clean(applicant.get(k)) for k in PERSONAL_KEYS}
    values.update({k: _clean(payload.get(PAYLOAD_KEY[k])) for k in COMPANY_KEYS})
    values["company"] = str(payload.get("companyId") or target_id or "")
    return values


# ------------------------------------------------------------------ reads
APPLICATION_COLUMNS = """
    s.id, s.kind, s.status, s.payload, s.organization_id, s.target_organization_id, s.selected_company_id,
    s.submitted_by_user_id, s.review_feedback, s.reviewed_at, s.reviewed_by_user_id, s.applied_at,
    s.correction_fields, s.created_at, s.updated_at, s.submitted_at, s.source, s.admin_notes
"""


def _row(r) -> dict | None:
    if r is None:
        return None
    out = dict(r)
    out["payload"] = _json(out.get("payload"))
    out["correction_fields"] = list(out.get("correction_fields") or [])
    return out


def from_json(value) -> dict | None:
    """An application read as JSON (row_to_json in the dashboard snapshot)."""
    if not value:
        return None
    row = _json(value)
    for key in ("reviewed_at", "updated_at", "created_at", "submitted_at", "applied_at"):
        if isinstance(row.get(key), str):
            row[key] = datetime.fromisoformat(row[key])
    return _row(row)


async def latest_for_user(db: AsyncSession, user_id: UUID, lock: bool = False) -> dict | None:
    r = (await db.execute(text(f"""
        SELECT {APPLICATION_COLUMNS}, t.display_name AS target_name
        FROM manufacturer_submissions s JOIN organizations t ON t.id = s.target_organization_id
        WHERE s.submitted_by_user_id = :u AND s.kind IN {APPLICATION_KINDS_SQL} AND s.status <> 'draft'
        ORDER BY s.created_at DESC, s.updated_at DESC LIMIT 1
        {"FOR UPDATE OF s" if lock else ""}
    """), {"u": user_id})).mappings().first()
    return _row(r)


async def get(db: AsyncSession, submission_id: str, lock: bool = False) -> dict | None:
    r = (await db.execute(text(f"""
        SELECT {APPLICATION_COLUMNS} FROM manufacturer_submissions s
        WHERE s.id = CAST(:id AS uuid) AND s.kind IN {APPLICATION_KINDS_SQL}
        {"FOR UPDATE" if lock else ""}
    """), {"id": submission_id})).mappings().first()
    return _row(r)


def reapply_policy(settings, application: dict | None) -> dict:
    """Whether a rejected applicant may apply again. The waiting period is a configuration value
    that has NOT been decided yet: unset means "not available" (never silently immediate)."""
    days = getattr(settings, "manufacturer_reapply_after_days", None)
    if not application or application["status"] != "rejected":
        return {"configured": days is not None, "allowed": True, "availableFrom": None}
    if days is None:
        return {"configured": False, "allowed": False, "availableFrom": None}
    decided = application.get("reviewed_at") or application.get("updated_at")
    if isinstance(decided, str):
        decided = datetime.fromisoformat(decided)
    available = (decided or datetime.now(timezone.utc)) + timedelta(days=days)
    return {"configured": True, "allowed": datetime.now(timezone.utc) >= available, "availableFrom": available}


async def access(db: AsyncSession, user_id: UUID, org_id: UUID, settings=None,
                 application: dict | None = None, fetched: bool = False) -> dict:
    """May this user use the remaining manufacturer sections of `org_id` (their current company)?

    Unlocked only when BOTH hold:
      * the user's onboarding is approved: their latest application is approved for this
        company, or the company itself is approved / an established company (imported, added by
        an admin, or an account from before approvals existed), and no application of theirs for
        this company is waiting or was rejected;
      * the user has an active membership with an editing role (owner / admin / member)."""
    from app.repositories.manufacturer import AWAITING_APPROVAL_SQL  # avoid an import cycle

    if not fetched:
        application = await latest_for_user(db, user_id)
    row = (await db.execute(text(f"""
        SELECT m.membership_role AS role, mo.status AS company_status, {AWAITING_APPROVAL_SQL} AS awaiting
        FROM organizations o
        LEFT JOIN memberships m ON m.organization_id = o.id AND m.user_id = :u AND m.status = 'active'
        LEFT JOIN manufacturer_onboarding mo ON mo.organization_id = o.id
        WHERE o.id = :o
    """), {"u": user_id, "o": org_id})).mappings().first() or {}
    return evaluate_access(application, org_id, row.get("role"), row.get("company_status"), row.get("awaiting"),
                           settings)


def evaluate_access(app: dict | None, org_id, role: str | None, company_status: str | None,
                    awaiting: bool | None, settings=None) -> dict:
    """The access rule of `access`, from values already read (the dashboard reads them in its one
    snapshot query)."""
    company_ok = company_status == "approved" or awaiting is False
    app_here = app is not None and str(app["target_organization_id"]) == str(org_id)
    if company_ok and not (app_here and app["status"] != "approved"):
        status = "approved"          # an approved / established company, nothing of theirs pending here
    elif app_here:
        status = app["status"]       # their application for this company decides
    elif app is not None and app["status"] != "approved":
        status = app["status"]       # waiting / rejected application (for another company)
    else:
        status = "not_submitted"
    unlocked = status == "approved" and role in EDIT_ROLES
    if status == "approved" and not unlocked:
        status = "no_permission"
    return {"unlocked": unlocked, "status": status, "role": role,
            "reapply": reapply_policy(settings, app) if app is not None else None}


async def require_unlocked(db: AsyncSession, user_id: UUID, org_id: UUID) -> None:
    state = await access(db, user_id, org_id)
    if state["unlocked"]:
        return
    message = {
        "pending": "Your manufacturer application is awaiting X!Y approval. This section opens once it is approved.",
        "changes_requested": "X!Y asked for corrections to your application. Send the corrections first; "
                             "this section opens once the application is approved.",
        "rejected": "Your manufacturer application was not approved, so this section is not available.",
        "no_permission": "Your access to this company does not include editing it. Ask the company's primary user.",
    }.get(state["status"], "Submit your basic details for X!Y approval first.")
    raise ApplicationError(message, 403, f"onboarding_{state['status']}")


# ------------------------------------------------------------------ drafts
DRAFT_KEYS = (*PERSONAL_KEYS, *COMPANY_KEYS, "companyId", "companyCorrections")


async def get_draft(db: AsyncSession, user_id: UUID) -> dict | None:
    r = (await db.execute(text("SELECT payload, updated_at FROM manufacturer_application_drafts WHERE user_id = :u"),
                          {"u": user_id})).mappings().first()
    return {"values": _json(r["payload"]), "savedAt": r["updated_at"]} if r else None


async def save_draft(db: AsyncSession, user_id: UUID, values: dict) -> dict:
    """Keeps the unsent form (only known keys, as text). Never reviewed, never grants access."""
    clean: dict[str, Any] = {}
    for key in DRAFT_KEYS:
        if key not in values or values[key] is None:
            continue
        if key == "companyCorrections":
            corr = values[key] if isinstance(values[key], dict) else {}
            clean[key] = {k: str(v)[:LIMITS.get(k, 30)] for k, v in corr.items() if k in COMPANY_KEYS and v}
        else:
            clean[key] = str(values[key])[:LIMITS.get(key, 64)]
    await db.execute(text("""
        INSERT INTO manufacturer_application_drafts (user_id, payload, updated_at)
        VALUES (:u, CAST(:p AS jsonb), now())
        ON CONFLICT (user_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
    """), {"u": user_id, "p": json.dumps(clean)})
    return await get_draft(db, user_id)


async def delete_draft(db: AsyncSession, user_id: UUID) -> None:
    await db.execute(text("DELETE FROM manufacturer_application_drafts WHERE user_id = :u"), {"u": user_id})


# ------------------------------------------------------------------ applicant: submit
async def _company_record(db: AsyncSession, company_id: str) -> dict | None:
    from app.repositories.manufacturer import LISTED_COMPANY_SQL
    locked = (await db.execute(text(f"""
        SELECT o.id FROM organizations o WHERE o.id = CAST(:c AS uuid) AND {LISTED_COMPANY_SQL}
        FOR UPDATE OF o
    """), {"c": company_id})).first()
    if locked is None:
        return None
    r = (await db.execute(text("""
        SELECT o.id, o.display_name, op.company_category, op.country_name, op.country_code,
               op.production_capacity_label, op.stated_production_capacity, op.contact_phone,
               f.city, f.state_province, f.country_name AS facility_country
        FROM organizations o
        LEFT JOIN organization_profiles op ON op.organization_id = o.id
        LEFT JOIN LATERAL (SELECT city, state_province, country_name FROM facilities
                           WHERE organization_id = o.id AND is_headquarters AND status <> 'suspended'
                           LIMIT 1) f ON true
        WHERE o.id = :id
    """), {"id": locked.id})).mappings().first()
    return dict(r)


def present(value: Any) -> bool:
    """A saved value counts as present unless it is None, "" or whitespace only. Numbers (also
    0) are present."""
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    return True


def saved_capacity(label: Any, number: Any) -> str:
    """Production capacity as shown: the saved label, else the saved number (0 included)."""
    if present(label):
        return str(label).strip()
    if number is None:
        return ""
    value = float(number)
    return str(int(value)) if value.is_integer() else f"{value:g}"


def _saved_company(rec: dict) -> dict:
    """The selected company's saved values ("" = missing)."""
    def keep(value: Any) -> str:
        return str(value).strip() if present(value) else ""
    return {"companyName": keep(rec["display_name"]), "companyType": keep(rec["company_category"]),
            "country": keep(rec["country_name"]) or keep(rec["facility_country"]),
            "companyPhone": keep(rec["contact_phone"]),
            "capacity": saved_capacity(rec["production_capacity_label"], rec["stated_production_capacity"])}


def _missing_value(key: str, sent: Any) -> str:
    """A value supplied for a company field the selected company does not have yet. Same rules as
    a new company: category and location required, Indian phone required, capacity optional."""
    if key == "companyPhone":
        return _field(key, normalize_indian_phone, sent)
    return _field(key, _text, key, sent, key in ("companyType", "country"))


async def submit(db: AsyncSession, *, ctx: dict, data: dict, settings) -> dict:
    """The applicant's basic details: a new application, an idempotent retry, or the corrections
    an admin asked for. Caller holds the per-user lock and commits. Returns what was done."""
    from app.repositories.manufacturer import COUNTRY_CODES, capacity_number, normalize_company_name

    user_id, workspace = ctx["user_id"], ctx["organization_id"]
    personal = personal_values(data)
    company_id = str(data["companyId"]) if data.get("companyId") else None
    corrections_in = {k: v for k, v in (data.get("companyCorrections") or {}).items()
                      if k in COMPANY_KEYS and _clean(v)}
    if company_id and corrections_in:
        # X!Y asked for changes to a company correction this user suggested: only that staged
        # request is updated (whatever the state of their application).
        returned = await db.scalar(text("""
            SELECT id FROM manufacturer_submissions WHERE submitted_by_user_id = :u AND kind = 'update_request'
              AND target_organization_id = CAST(:c AS uuid) AND status = 'changes_requested'
        """), {"u": user_id, "c": company_id})
        if returned:
            await db.execute(text("SELECT 1 FROM organizations WHERE id = CAST(:c AS uuid) FOR UPDATE"), {"c": company_id})
            request = await _stage_correction(db, user_id, workspace, company_id, corrections_in)
            name = await db.scalar(text("SELECT display_name FROM organizations WHERE id = CAST(:c AS uuid)"),
                                   {"c": company_id})
            return {"kind": "update_request", "submissionId": None, "event": None, "companyId": company_id,
                    "companyName": name, "requestId": str(request["id"]) if request else None,
                    "names_changed": False}
    state = await access(db, user_id, workspace, settings)
    if state["unlocked"] or state["status"] == "no_permission":
        raise ApplicationError("Your manufacturer account is already approved.", 409, "already_approved")
    previous = await latest_for_user(db, user_id, lock=True)

    # ---- which company, with which values (existing company: re-read, never from the client)
    if company_id:
        if str(company_id) == str(workspace):
            raise ApplicationError("Select your company from the list, or add it as a new company.", 422)
        rec = await _company_record(db, company_id)
        if rec is None:
            raise ApplicationError("The selected company was not found. Please search again.", 404, "company_not_found")
        member = await db.scalar(text("""
            SELECT 1 FROM memberships WHERE organization_id = :c AND user_id = :u AND status = 'active'
        """), {"c": rec["id"], "u": user_id})
        if member:
            raise ApplicationError("You are already linked to this company.", 409, "already_member")
        saved = _saved_company(rec)
        if data.get("companyName") and normalize_company_name(data["companyName"]) != normalize_company_name(saved["companyName"]):
            raise ApplicationError("The company name does not match the selected company. Select it again from the list.",
                                   422, "stale_selection", field="companyName")
        additions: dict[str, str] = {}
        for key in COMPANY_KEYS:
            sent = data.get(key)
            if key == "companyName" or saved[key]:
                # Saved value: read-only. A client cannot change the shared record here (a value
                # that differs is refused, whatever the frontend sent).
                if not present(sent):
                    continue
                same = (_clean(sent).lower() == _clean(saved[key]).lower()) if key != "companyPhone" else \
                    (_phone_or_none(sent) == _phone_or_none(saved[key]))
                if not same:
                    raise ApplicationError(
                        f"{LABELS[key]} is already saved for this company and cannot be changed here. "
                        "Corrections to saved company details are reviewed by X!Y.", 422, "company_read_only",
                        field=key)
                continue
            # Missing on the company record: the applicant may supply it (phone required).
            value = _missing_value(key, sent) if (present(sent) or key != "capacity") else ""
            if value:
                additions[key] = value
        kind, target = "join_company", rec["id"]
        code = None
        if "country" in additions:
            code = COUNTRY_CODES.get(additions["country"].lower())
            if code and not await db.scalar(text("SELECT 1 FROM countries WHERE code = :c"), {"c": code}):
                code = None
        payload = {"companyId": str(rec["id"]), "companyName": saved["companyName"],
                   "companyType": additions.get("companyType") or saved["companyType"],
                   "country": additions.get("country") or saved["country"],
                   "countryCode": code if "country" in additions else rec["country_code"],
                   "capacity": additions.get("capacity") or saved["capacity"],
                   "capacityNumber": capacity_number(additions["capacity"]) if "capacity" in additions else None,
                   "contactPhone": additions.get("companyPhone") or saved["companyPhone"] or None,
                   "contactEmail": None,
                   # Values the company does not have yet: written on approval, only where still missing.
                   "additions": {PAYLOAD_KEY[k]: v for k, v in additions.items()}}
    else:
        if corrections_in:
            raise ApplicationError("Corrections can only be suggested for an existing company.", 422)
        values = company_values(data)
        name, country = normalize_company_name(values["companyName"]), values["country"].lower()
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
                         {"k": f"xy-company:{name}|{country}"})
        from app.repositories.manufacturer import LISTED_COMPANY_SQL
        clash = await db.scalar(text(f"""
            SELECT o.id FROM organizations o
            LEFT JOIN organization_profiles op ON op.organization_id = o.id
            LEFT JOIN facilities f ON f.organization_id = o.id AND f.is_headquarters AND f.status <> 'suspended'
            WHERE {LISTED_COMPANY_SQL} AND o.id <> :w
              AND lower(regexp_replace(btrim(o.display_name), '\\s+', ' ', 'g')) = :n
              AND lower(btrim(COALESCE(op.country_name, f.country_name, ''))) = :c
            LIMIT 1
        """), {"w": workspace, "n": name, "c": country})
        if clash is None:
            clash = await db.scalar(text("""
                SELECT 1 FROM manufacturer_submissions s
                WHERE s.status IN ('pending', 'changes_requested') AND s.kind = 'new_company'
                  AND s.submitted_by_user_id <> :u
                  AND lower(regexp_replace(btrim(s.payload->>'companyName'), '\\s+', ' ', 'g')) = :n
                  AND lower(btrim(COALESCE(s.payload->>'country', ''))) = :c
                LIMIT 1
            """), {"u": user_id, "n": name, "c": country})
        if clash is not None:
            raise ApplicationError("A company with this name is already registered in this country. "
                                   "Select it from the list, or check the name and location.", 409, "duplicate_company")
        code = COUNTRY_CODES.get(country)
        if code and not await db.scalar(text("SELECT 1 FROM countries WHERE code = :c"), {"c": code}):
            code = None
        kind, target = "new_company", workspace
        payload = {"companyName": values["companyName"], "companyType": values["companyType"],
                   "country": values["country"], "countryCode": code, "capacity": values["capacity"],
                   "capacityNumber": capacity_number(values["capacity"]),
                   "contactPhone": values["companyPhone"], "contactEmail": None}
    payload["applicant"] = personal

    # ---- open / rejected previous application rules
    allowed_fields: list[str] | None = None
    if previous is not None and previous["status"] in OPEN:
        before = _form_values(previous["payload"], previous["target_organization_id"])
        after = _form_values(payload, target)
        changed = [k for k in after if after[k].lower() != before.get(k, "").lower()]
        if previous["status"] == "pending":
            if changed or (corrections_in and not await _same_open_correction(db, user_id, target, corrections_in)):
                raise ApplicationError("Your application is awaiting X!Y review and cannot be changed now.",
                                       409, "awaiting_review")
            return {"kind": previous["kind"], "submissionId": previous["id"], "event": None,
                    "companyId": str(previous["target_organization_id"]), "companyName": payload["companyName"],
                    "requestId": None, "names_changed": False}
        allowed_fields = previous["correction_fields"] or list(correctable(previous["kind"]))
        not_allowed = [k for k in changed if k not in allowed_fields]
        if not_allowed:
            raise ApplicationError(
                "Only the fields X!Y asked you to correct can be changed: "
                + ", ".join(LABELS[k] for k in allowed_fields) + ".", 422, "field_not_correctable")
        if corrections_in and not set(corrections_in) <= set(allowed_fields):
            raise ApplicationError("Only the fields X!Y asked you to correct can be changed.", 422,
                                   "field_not_correctable")
        if not changed and not corrections_in:
            raise ApplicationError("Make the requested corrections before sending again.", 422, "nothing_changed")
    elif previous is not None and previous["status"] == "rejected":
        policy = reapply_policy(settings, previous)
        if not policy["allowed"]:
            if not policy["configured"]:
                raise ApplicationError("Your previous application was not approved. Applying again is not available "
                                       "yet - please contact X!Y support.", 409, "reapply_not_available")
            raise ApplicationError("Your previous application was not approved. You can apply again from "
                                   f"{policy['availableFrom']:%d %b %Y}.", 409, "reapply_too_early")

    # ---- personal details: the user record (never the company's contact details)
    names_changed = (await db.execute(text("""
        UPDATE users SET first_name = :f, last_name = :l, display_name = :d, updated_at = now()
        WHERE id = :u AND (first_name IS DISTINCT FROM CAST(:f AS text) OR last_name IS DISTINCT FROM CAST(:l AS text))
        RETURNING id
    """), {"u": user_id, "f": personal["firstName"], "l": personal["lastName"],
           "d": f'{personal["firstName"]} {personal["lastName"]}'})).first() is not None
    await db.execute(text("""
        UPDATE users SET date_of_birth = CAST(:dob AS date), personal_email = :e, updated_at = now()
        WHERE id = :u AND (date_of_birth IS DISTINCT FROM CAST(:dob AS date)
                           OR personal_email IS DISTINCT FROM CAST(:e AS citext))
    """), {"u": user_id, "dob": date.fromisoformat(personal["dob"]), "e": personal["personalEmail"]})

    # ---- the application (staged; one open per user)
    sub_id, event = await _stage(db, user_id=user_id, workspace=workspace, target=target,
                                 selected=target if kind == "join_company" else None, kind=kind,
                                 payload=payload, previous=previous)

    # ---- proposed corrections to an existing company's shared details: staged for admin review
    request = None
    if kind == "join_company" and corrections_in:
        request = await _stage_correction(db, user_id, workspace, target, corrections_in)

    await db.execute(text("""
        INSERT INTO marketplace_role_selections (user_id, role_selected)
        SELECT :u, 'manufacturer' WHERE NOT EXISTS (
          SELECT 1 FROM marketplace_role_selections WHERE user_id = :u AND role_selected = 'manufacturer'
            AND status = 'active')
    """), {"u": user_id})
    # The user's own organization records that basic details were sent (dashboard shows the
    # pending state). A new company is 'submitted' until an admin decides.
    await db.execute(text("""
        INSERT INTO manufacturer_onboarding
          (organization_id, current_step, personal_information_completed, completion_percentage, status, submitted_at)
        VALUES (:o, 'company_information', true, 15,
                CASE WHEN :new THEN 'submitted' ELSE 'in_progress' END, CASE WHEN :new THEN now() END)
        ON CONFLICT (organization_id) DO UPDATE SET personal_information_completed = true,
          completion_percentage = GREATEST(manufacturer_onboarding.completion_percentage, 15),
          status = CASE WHEN manufacturer_onboarding.status = 'approved' THEN 'approved'
                        WHEN :new THEN 'submitted'
                        WHEN manufacturer_onboarding.status = 'draft' THEN 'in_progress'
                        ELSE manufacturer_onboarding.status END,
          submitted_at = CASE WHEN :new AND manufacturer_onboarding.status <> 'approved' THEN now()
                              ELSE manufacturer_onboarding.submitted_at END,
          version = manufacturer_onboarding.version + 1
    """), {"o": workspace, "new": kind == "new_company"})
    await delete_draft(db, user_id)

    if event:  # a retry that changed nothing notifies nobody again
        who = f'{personal["firstName"]} {personal["lastName"]}'.strip()
        title = ("Corrections made to a manufacturer application" if event == "resubmitted"
                 else "New manufacturer application")
        body = (f'{who} {"corrected their application" if event == "resubmitted" else "applied"} for '
                f'{payload["companyName"]} ({KIND_LABELS[kind].lower()}).')
        await notifications.notify_admins(db, "application_resubmitted" if event == "resubmitted"
                                          else "application_submitted", title, body, target, sub_id)
    return {"kind": kind, "submissionId": sub_id, "event": event, "companyId": str(target),
            "companyName": payload["companyName"], "requestId": str(request["id"]) if request else None,
            "names_changed": names_changed}


async def _same_open_correction(db: AsyncSession, user_id, company_id, corrections: dict) -> bool:
    """A retry that suggests exactly the corrections already waiting for review (or none at all
    differing from the saved record)."""
    row = await db.scalar(text("""
        SELECT COALESCE(original_payload, payload) FROM manufacturer_submissions
        WHERE submitted_by_user_id = :u AND kind = 'update_request' AND target_organization_id = :c
          AND status IN ('pending', 'changes_requested')
    """), {"u": user_id, "c": company_id})
    waiting = _json(row)
    current = await update_requests.current_values(db, company_id)
    for key, value in corrections.items():
        new = _phone_or_none(value) if key == "companyPhone" else _clean(value)
        if _clean(waiting.get(PAYLOAD_KEY[key])).lower() == _clean(new).lower():
            continue
        if _clean(current.get(PAYLOAD_KEY[key])).lower() == _clean(new).lower():
            continue
        return False
    return True


async def _stage_correction(db: AsyncSession, user_id, workspace, company_id, corrections: dict) -> dict | None:
    """Suggested corrections to an existing company's shared details: an admin-reviewed update
    request (app/company_update_requests.py). The company record is never written here. Values
    equal to the saved ones are not a correction (nothing is staged)."""
    proposed = {}
    for key, value in corrections.items():
        if key == "companyPhone":
            proposed["contactPhone"] = _field(key, normalize_indian_phone, value)
        else:
            proposed[PAYLOAD_KEY[key]] = _field(key, _text, key, value, False)
    current = await update_requests.current_values(db, company_id)
    if not update_requests.proposed_changes(current, proposed):
        return None
    try:
        return await update_requests.submit(db, user_id=user_id, workspace_id=workspace,
                                            company_id=company_id, payload=proposed)
    except update_requests.RequestError as exc:
        raise ApplicationError(str(exc), exc.status) from exc


def _phone_or_none(value: Any) -> str | None:
    try:
        return normalize_indian_phone(value)
    except ValueError:
        return _clean(value) or None


async def _stage(db: AsyncSession, *, user_id, workspace, target, selected, kind, payload, previous) -> tuple:
    source = onboarding_source.require("web_dashboard")
    resubmission = previous is not None and previous["status"] == "changes_requested"
    if resubmission:
        before = _form_values(previous["payload"], previous["target_organization_id"])
        after = _form_values(payload, target)
        changed = [k for k in after if after[k].lower() != before.get(k, "").lower()]
        await db.execute(text("""
            UPDATE manufacturer_submissions
            SET organization_id = :w, target_organization_id = :t, selected_company_id = :sel, kind = :k,
                payload = CAST(:p AS jsonb), status = 'pending', correction_fields = NULL,
                submitted_at = now(), updated_at = now()
            WHERE id = :id
        """), {"id": previous["id"], "w": workspace, "t": target, "sel": selected, "k": kind,
               "p": json.dumps(payload)})
        await approval.record_event(db, event="resubmitted", role="requester", source=source,
                                    organization_id=target, submission_id=previous["id"], actor=user_id,
                                    details={"kind": kind, "changed": changed,
                                             "previous": {k: before.get(k) for k in changed},
                                             "proposed": {k: after.get(k) for k in changed}})
        return previous["id"], "resubmitted"
    sub_id = await db.scalar(text("""
        INSERT INTO manufacturer_submissions
          (organization_id, target_organization_id, selected_company_id, submitted_by_user_id, kind, payload,
           original_payload, source, submitted_at)
        VALUES (:w, :t, :sel, :u, :k, CAST(:p AS jsonb), CAST(:p AS jsonb), :src, now())
        RETURNING id
    """), {"w": workspace, "t": target, "sel": selected, "u": user_id, "k": kind, "p": json.dumps(payload),
           "src": source})
    await approval.record_event(db, event="submitted", role="requester", source=source, organization_id=target,
                                submission_id=sub_id, actor=user_id,
                                details={"kind": kind, "applicant": payload["applicant"],
                                         "company": {k: payload.get(PAYLOAD_KEY[k]) for k in COMPANY_KEYS}})
    return sub_id, "submitted"


# ------------------------------------------------------------------ admin: decide
async def decide(db: AsyncSession, *, submission_id: str, admin_id: UUID, admin_roles: tuple[str, ...],
                 decision: str, feedback: str | None, internal_note: str | None,
                 correction_fields: list[str] | None, make_primary: bool = False,
                 seen: str | None = None) -> dict:
    """Approve / request corrections / reject one application, once. Caller commits.
    Returns {"application": <row as it was>, "status": new status, "notify": [...]}"""
    if not set(admin_roles) & set(DECIDE_ROLES):
        raise ApplicationError("Your admin role cannot decide manufacturer applications.", 403, "forbidden")
    status = DECISIONS.get(decision)
    if status is None:
        raise ApplicationError("Unsupported decision", 422)
    feedback = (feedback or "").strip()[:2000] or None
    internal_note = (internal_note or "").strip()[:4000] or None
    app = await get(db, submission_id, lock=True)
    if app is None:
        raise ApplicationError("Application not found", 404, "not_found")
    if app["status"] not in OPEN or app["applied_at"] is not None:
        raise ApplicationError("This application was already decided.", 409, "already_decided")
    if app["status"] == "changes_requested" and status == "changes_requested":
        raise ApplicationError("Corrections were already requested; wait for the applicant to send them.", 409,
                               "already_decided")
    if seen and seen != _stamp(app):
        raise ApplicationError("The applicant changed this application after you opened it. Review the latest "
                               "version, then decide again.", 409, "stale")
    fields: list[str] = []
    if status == "rejected" and not feedback:
        raise ApplicationError("Write the reason the applicant will see.", 422, "feedback_required")
    if status == "changes_requested":
        if not feedback:
            raise ApplicationError("Describe what the applicant needs to correct.", 422, "feedback_required")
        allowed = correctable(app["kind"])
        fields = [f for f in dict.fromkeys(correction_fields or []) if f]
        unknown = [f for f in fields if f not in allowed]
        if unknown:
            raise ApplicationError("These fields cannot be corrected in this application: " + ", ".join(unknown), 422)
        if not fields:
            raise ApplicationError("Choose at least one field the applicant should correct.", 422, "fields_required")
    if make_primary and (status != "approved" or app["kind"] == "new_company"):
        make_primary = False  # only meaningful when approving an application for an existing company

    target, user_id, workspace = app["target_organization_id"], app["submitted_by_user_id"], app["organization_id"]
    membership = None
    filled = {"applied": [], "skipped": []}
    if status == "approved":
        if app["kind"] == "new_company":
            sub = await approval.open_submission_for_target(db, target, lock=True, kinds=("new_company",))
            if sub is None or sub["id"] != app["id"]:
                raise ApplicationError("This application was already decided.", 409, "already_decided")
            try:
                await approval._apply(db, sub)
            except approval.DecisionError as exc:
                raise ApplicationError(str(exc), 409) from exc
        else:
            membership = await _grant_membership(db, target, user_id, workspace, make_primary)
            # Details the applicant supplied because the company had none: written now, only where
            # the field is STILL missing (company row locked by _grant_membership).
            filled = await fill_missing_company_details(db, target, app["payload"])
    await db.execute(text("""
        UPDATE manufacturer_submissions
        SET status = :s, reviewed_by_user_id = :a, reviewed_at = now(), review_feedback = :f,
            correction_fields = CASE WHEN :s = 'changes_requested' THEN CAST(:cf AS text[]) END,
            admin_notes = CASE WHEN CAST(:n AS text) IS NULL THEN admin_notes
                               ELSE concat_ws(E'\\n\\n', admin_notes, CAST(:n AS text)) END,
            applied_at = CASE WHEN :s = 'approved' THEN now() ELSE applied_at END, updated_at = now()
        WHERE id = :id AND status IN ('pending', 'changes_requested') AND applied_at IS NULL
    """), {"s": status, "a": admin_id, "f": feedback, "cf": fields, "n": internal_note, "id": app["id"]})
    await approval.record_event(db, event="decision", role="admin", source=onboarding_source.ADMIN_REVIEW,
                                organization_id=target, submission_id=app["id"], actor=admin_id,
                                details={"decision": status, "feedback": feedback, "kind": app["kind"],
                                         "correctionFields": fields, "internalNote": internal_note,
                                         "makePrimary": bool(make_primary)},
                                key=f"decision:{app['id']}:{_stamp(app)}")
    if app["kind"] == "new_company":
        # The new company's own approval follows its application (the applicant's organization).
        if status == "approved":
            await db.execute(text("""
                UPDATE organizations SET onboarding_source = :src
                WHERE id = :t AND onboarding_source IS NULL AND created_by_user_id = :u
            """), {"t": target, "u": user_id, "src": onboarding_source.require(app["source"])})
            await approval.record_event(db, event="merged", role="admin", source=onboarding_source.ADMIN_REVIEW,
                                        organization_id=target, submission_id=app["id"], actor=admin_id,
                                        details={"kind": app["kind"]}, key=f"merged:{app['id']}")
        await approval._set_company_status(db, target, status, admin_id, feedback)
    elif membership:
        await approval.record_event(db, event="membership_granted", role="admin",
                                    source=onboarding_source.ADMIN_REVIEW, organization_id=target,
                                    submission_id=app["id"], actor=admin_id, details=membership,
                                    key=f"membership:{app['id']}")
        if filled["applied"] or filled["skipped"]:
            # history: which supplied details were written (fill-only) and which were kept
            await approval.record_event(db, event="merged", role="admin", source=onboarding_source.ADMIN_REVIEW,
                                        organization_id=target, submission_id=app["id"], actor=admin_id,
                                        details={"kind": app["kind"], "companyDetails": filled},
                                        key=f"merged:{app['id']}")
    # Admin notifications about this application are done.
    await db.execute(text("""
        UPDATE notifications SET read_at = coalesce(read_at, now()), status = 'read'
        WHERE related_type = 'manufacturer_submission' AND related_id = :s AND read_at IS NULL
    """), {"s": app["id"]})
    await _notify_applicant(db, app, status, feedback, fields, admin_id)
    return {"application": app, "status": status, "membership": membership, "correctionFields": fields,
            "feedback": feedback}


async def fill_missing_company_details(db: AsyncSession, company_id: UUID, payload: dict) -> dict:
    """Approved application for an existing company: write the details the applicant supplied for
    fields the company did not have - ONLY where the field is still missing now (another approved
    submission may have supplied it meanwhile; that value is kept). Caller holds the company lock.
    Returns {"applied": [...], "skipped": [...]} (form keys)."""
    from app.repositories.manufacturer import capacity_number

    additions = payload.get("additions") or {}
    if not additions:
        return {"applied": [], "skipped": []}
    current = (await db.execute(text("""
        SELECT op.organization_id IS NOT NULL AS has_profile, op.company_category, op.country_name,
               op.contact_phone, op.production_capacity_label, op.stated_production_capacity,
               (SELECT f.country_name FROM facilities f WHERE f.organization_id = o.id AND f.is_headquarters
                  AND f.status <> 'suspended' LIMIT 1) AS facility_country
        FROM organizations o LEFT JOIN organization_profiles op ON op.organization_id = o.id
        WHERE o.id = :c
    """), {"c": company_id})).mappings().first()
    still_missing = {
        "companyType": not present(current["company_category"]),
        "country": not present(current["country_name"]) and not present(current["facility_country"]),
        "contactPhone": not present(current["contact_phone"]),
        "capacity": not present(current["production_capacity_label"])
                    and current["stated_production_capacity"] is None,
    }
    columns = {"companyType": "company_category", "country": "country_name",
               "contactPhone": "contact_phone", "capacity": "production_capacity_label"}
    values: dict[str, Any] = {}
    applied, skipped = [], []
    reverse = {v: k for k, v in PAYLOAD_KEY.items()}
    for key in (PAYLOAD_KEY[k] for k in COMPANY_KEYS):  # form order
        value = additions.get(key)
        if key not in columns or not present(value):
            continue
        if still_missing[key]:
            values[columns[key]] = str(value).strip()
            applied.append(reverse[key])
        else:
            skipped.append(reverse[key])
    if "country_name" in values and payload.get("countryCode"):
        values["country_code"] = payload["countryCode"]
    if "production_capacity_label" in values:
        values["stated_production_capacity"] = capacity_number(values["production_capacity_label"])
    if values:
        if not current["has_profile"]:
            await db.execute(text("INSERT INTO organization_profiles (organization_id) VALUES (:c) "
                                  "ON CONFLICT (organization_id) DO NOTHING"), {"c": company_id})
        # Each column is written only while it is still empty (also checked in the statement).
        sets = []
        for col in values:
            if col in ("country_code", "stated_production_capacity"):
                sets.append(f"{col} = COALESCE({col}, :{col})")
            else:
                sets.append(f"{col} = CASE WHEN NULLIF(btrim({col}), '') IS NULL THEN :{col} ELSE {col} END")
        await db.execute(text(f"UPDATE organization_profiles SET {', '.join(sets)}, updated_at = now() "
                              "WHERE organization_id = :c"), {"c": company_id, **values})
    return {"applied": applied, "skipped": skipped}


def _stamp(app: dict) -> str:
    value = app["updated_at"]
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


async def _grant_membership(db: AsyncSession, target: UUID, user_id: UUID, workspace: UUID,
                            make_primary: bool) -> dict:
    """Approved applicant of an existing company: a MEMBER of that company. Ownership is never
    taken from anyone; `make_primary` (an explicit admin choice) is allowed only when the company
    has no active owner. The applicant's empty personal organization is retired (kept, archived)."""
    await db.execute(text("SELECT 1 FROM organizations WHERE id = :t FOR UPDATE"), {"t": target})
    has_owner = await db.scalar(text("""
        SELECT EXISTS (SELECT 1 FROM memberships WHERE organization_id = :t AND status = 'active'
                       AND membership_role = 'owner' AND user_id <> :u)
    """), {"t": target, "u": user_id})
    if make_primary and has_owner:
        raise ApplicationError("This company already has a primary user. Approve without making the applicant "
                               "the primary user.", 409, "has_owner")
    current = await db.scalar(text("""
        SELECT status FROM memberships WHERE organization_id = :t AND user_id = :u
    """), {"t": target, "u": user_id})
    if current == "suspended":
        raise ApplicationError("This user's membership of the company is suspended. Resolve that first; an "
                               "application approval does not lift a suspension.", 409, "membership_suspended")
    role = "owner" if make_primary else "member"
    await db.execute(text("""
        INSERT INTO memberships (user_id, organization_id, membership_role, status, accepted_at)
        VALUES (:u, :t, :r, 'active', now())
        ON CONFLICT (organization_id, user_id) DO UPDATE
          SET status = 'active', accepted_at = COALESCE(memberships.accepted_at, now()),
              membership_role = CASE WHEN memberships.membership_role IN ('owner', 'admin')
                                          AND memberships.status = 'active'
                                     THEN memberships.membership_role ELSE EXCLUDED.membership_role END,
              version = memberships.version + 1
    """), {"u": user_id, "t": target, "r": role})
    if make_primary:
        # Verified ownership granted by an admin: an unclaimed (imported) company becomes active.
        await db.execute(text("""
            UPDATE organizations SET status = 'active', updated_at = now() WHERE id = :t AND status = 'claim_pending'
        """), {"t": target})
    if workspace != target:
        # The applicant now works in the approved company. Their personal placeholder organization
        # (created at sign-up, kept empty because nothing opened before approval) is retired:
        # kept and archived, never deleted. An older claim's workspace may hold a profile built
        # while waiting under the previous rules: that is merged where the company has no data
        # of its own (existing rule), never overwriting the company.
        own = await db.scalar(text("""
            SELECT EXISTS (SELECT 1 FROM organizations WHERE id = :w AND created_by_user_id = :u)
               AND NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = :w AND user_id <> :u
                               AND status = 'active')
        """), {"w": workspace, "u": user_id})
        if own:
            await approval.merge_workspace(db, workspace, target)
    return {"role": role, "companyId": str(target)}


async def _notify_applicant(db: AsyncSession, app: dict, status: str, feedback: str | None,
                            fields: list[str], admin_id: UUID) -> None:
    """In-app message to the APPLICANT only (never to the company's other members). Only the
    user-facing reason is sent; internal notes stay in the admin portal."""
    company = app["payload"].get("companyName") or "your company"
    user_id = app["submitted_by_user_id"]
    if status == "approved":
        # After approval the user works in the approved company (their current company).
        await notifications.notify_user(
            db, user_id, app["target_organization_id"], "admin_note", "Your manufacturer application was approved",
            feedback or f"You can now complete the profile of {company}. It becomes visible to Visionaries once "
                        "the profile is 100% complete.", admin_id)
    elif status == "changes_requested":
        listed = ", ".join(LABELS.get(f, f) for f in fields)
        await notifications.notify_user(
            db, user_id, app["organization_id"], "needs_correction", "Your application needs a few corrections",
            f"{feedback}\nPlease correct: {listed}.", admin_id)
    else:
        await notifications.notify_user(
            db, user_id, app["organization_id"], "admin_note", "Your manufacturer application was not approved",
            feedback or "", admin_id)


# ------------------------------------------------------------------ admin: read
async def for_company(db: AsyncSession, org_id: str) -> list[dict]:
    """Applications for this company (its own new-company application and applicants who want to
    join it), open first, with each applicant's details and the review history. Admin only."""
    rows = (await db.execute(text(f"""
        SELECT {APPLICATION_COLUMNS},
               u.first_name, u.last_name, u.email::text AS sign_in_email, u.personal_email::text AS personal_email,
               u.status AS account_status,
               EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = s.target_organization_id
                       AND m.user_id = s.submitted_by_user_id AND m.status = 'active') AS is_member,
               coalesce(nullif(btrim(concat_ws(' ', r.first_name, r.last_name)), ''), r.display_name) AS reviewer
        FROM manufacturer_submissions s
        LEFT JOIN users u ON u.id = s.submitted_by_user_id
        LEFT JOIN users r ON r.id = s.reviewed_by_user_id
        WHERE s.target_organization_id = CAST(:o AS uuid) AND s.kind IN {APPLICATION_KINDS_SQL}
          AND s.status <> 'draft'
        ORDER BY (s.status IN ('pending', 'changes_requested')) DESC, s.updated_at DESC
        LIMIT 30
    """), {"o": org_id})).mappings().all()
    if not rows:
        return []
    current = await update_requests.current_values(db, org_id)
    has_owner = bool(await db.scalar(text("""
        SELECT EXISTS (SELECT 1 FROM memberships WHERE organization_id = CAST(:o AS uuid) AND status = 'active'
                       AND membership_role = 'owner')
    """), {"o": org_id}))
    events = (await db.execute(text("""
        SELECT e.submission_id, e.event, e.actor_role, e.details, e.created_at,
               coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.display_name, u.email::text) AS actor
        FROM manufacturer_submission_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.submission_id = ANY(CAST(:ids AS uuid[])) ORDER BY e.created_at
    """), {"ids": [str(r["id"]) for r in rows]})).mappings().all()
    out = []
    for raw in rows:
        r = _row(raw)
        p, applicant = r["payload"], (r["payload"].get("applicant") or {})
        own_events = [e for e in events if e["submission_id"] == r["id"]]
        last_resubmit = next((_json(e["details"]) for e in reversed(own_events) if e["event"] == "resubmitted"), {})
        is_open = r["status"] in OPEN
        out.append({
            "id": str(r["id"]), "kind": r["kind"], "kindLabel": KIND_LABELS.get(r["kind"], r["kind"]),
            "status": r["status"], "source": r["source"],
            "submittedAt": r["submitted_at"], "createdAt": r["created_at"], "updatedAt": r["updated_at"],
            "reviewedAt": r["reviewed_at"], "reviewedBy": r["reviewer"],
            "feedback": r["review_feedback"], "internalNotes": r["admin_notes"] or "",
            "correctionFields": r["correction_fields"],
            "correctable": [{"key": k, "label": LABELS[k]} for k in correctable(r["kind"])],
            "applicant": {"id": str(r["submitted_by_user_id"]) if r["submitted_by_user_id"] else None,
                          "name": " ".join(x for x in (raw["first_name"], raw["last_name"]) if x) or None,
                          "personalEmail": raw["personal_email"] or applicant.get("personalEmail") or None,
                          "signInEmail": raw["sign_in_email"], "accountStatus": raw["account_status"],
                          "isMember": bool(raw["is_member"])},
            "personal": [{"key": k, "label": label, "value": applicant.get(k) or ""} for k, label in PERSONAL_FIELDS],
            "company": [{"key": k, "label": label, "submitted": _clean(p.get(PAYLOAD_KEY[k])),
                         "current": _clean(current.get(PAYLOAD_KEY[k])),
                         # supplied by the applicant because the company had no value (fill-only)
                         "supplied": PAYLOAD_KEY[k] in (p.get("additions") or {})}
                        for k, label in COMPANY_FIELDS],
            "changedOnResubmit": last_resubmit.get("changed") or [],
            "companyHasOwner": has_owner,
            "canMakePrimary": r["kind"] != "new_company" and not has_owner,
            "seen": _stamp(r) if is_open else None,
            "events": [{"event": e["event"], "by": e["actor"], "role": e["actor_role"], "at": e["created_at"],
                        "details": {k: v for k, v in _json(e["details"]).items()
                                    if k in ("decision", "feedback", "correctionFields", "changed", "makePrimary",
                                             "internalNote", "role")}}
                       for e in own_events],
        })
    return out


# ------------------------------------------------------------------ applicant: read
def applicant_view(app: dict | None, state: dict, draft: dict | None) -> dict:
    """What the applicant sees about their own application: status, the user-facing feedback, the
    fields to correct, their own submitted values and the reapplication policy. Never the
    admin's internal notes."""
    view = {"access": {"unlocked": state["unlocked"], "status": state["status"]},
            "draft": draft, "reapply": state.get("reapply")}
    if app is None:
        view["application"] = None
        return view
    p = app["payload"]
    view["application"] = {
        "id": str(app["id"]), "kind": app["kind"], "status": app["status"],
        "companyId": str(app["target_organization_id"]) if app["kind"] != "new_company" else None,
        "companyName": p.get("companyName") or app.get("target_name"),
        "feedback": app["review_feedback"] if app["status"] in ("changes_requested", "rejected", "approved") else None,
        "correctionFields": app["correction_fields"] if app["status"] == "changes_requested" else [],
        "submittedAt": app["submitted_at"], "reviewedAt": app["reviewed_at"],
        "values": {**{k: (p.get("applicant") or {}).get(k) or "" for k in PERSONAL_KEYS},
                   **{k: p.get(PAYLOAD_KEY[k]) or "" for k in COMPANY_KEYS}},
    }
    return view
