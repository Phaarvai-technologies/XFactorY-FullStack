"""Approval-first manufacturer access: what an applicant may do while XfactorY reviews them.

An APPLICATION is the user's latest manufacturer submission of one of these kinds
(`manufacturer_submissions`, the existing staging table):

  new_company     - basic details of a NEW company (the user's own organization receives them
                    only on approval; the first registering user is its proposed primary owner),
  claim           - an existing company that has no owner yet (ownership only on approval),
  update_request  - an existing company that already has an owner: the user asks to join it.
                    Approval links them to the company as a MEMBER (never owner); any proposed
                    change to the company's shared details is applied only as the admin chooses.

Until an admin approves, every remaining manufacturer section (company profile, machinery,
availability, booking requests) is locked - enforced here for the backend APIs, mirrored by the
dashboard. Only approval unlocks; a resubmission alone never does.

  * pending           - "Your manufacturer application is awaiting admin approval."
  * changes_requested - the admin listed the fields to correct (`correction_fields`); only those
                        may change when the applicant resubmits (checked by `check_corrections`).
  * rejected          - the applicant-facing reason is shown; a fresh application may be sent
                        `Settings.manufacturer_reapply_after_hours` (24) after the rejection
                        (checked by `check_reapply`). The rejected application and its history stay.

Accounts that completed the details form before approvals existed (no application at all) keep
working as before. Approved members may use machinery, availability and bookings; the shared
company profile stays with the company's owner / admins.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

APPLICATION_KINDS_SQL = "('new_company', 'claim', 'update_request')"
EDIT_PROFILE_ROLES = ("owner", "admin")

# Fields an admin may ask the applicant to correct (key -> label). "company" = the selected company.
CORRECTABLE = {
    "firstName": "First name", "lastName": "Last name", "personalEmail": "Personal email",
    "dob": "Date of birth", "company": "Selected company", "companyName": "Company name",
    "companyType": "Company category", "country": "Country", "companyPhone": "Company phone number",
    "capacity": "Production capacity",
}

PENDING_MESSAGE = "Your manufacturer application is awaiting admin approval."
CORRECTIONS_MESSAGE = ("XfactorY asked you to correct your manufacturer application. "
                       "Update the requested details and send them again.")
NOT_SUBMITTED_MESSAGE = "Send your basic manufacturer details for admin approval first."
MEMBER_PROFILE_MESSAGE = "Only the company's primary user can edit the shared company profile."


def _json(value) -> dict:
    if value is None:
        return {}
    return json.loads(value) if isinstance(value, (str, bytes)) else dict(value)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def fmt_time(value: datetime) -> str:
    return _as_utc(value).strftime("%d %b %Y, %H:%M UTC")


def correction_fields(values: Any) -> list[str]:
    """Validated, de-duplicated correction field keys (unknown keys raise ValueError)."""
    out: list[str] = []
    for key in values or []:
        key = str(key)
        if key not in CORRECTABLE:
            raise ValueError(f"Unknown correction field: {key}")
        if key not in out:
            out.append(key)
    return out


# ------------------------------------------------------------------ reads
async def latest_application(db: AsyncSession, user_id: UUID) -> dict | None:
    row = (await db.execute(text(f"""
        SELECT s.id, s.kind, s.status, s.organization_id, s.target_organization_id, s.selected_company_id,
               s.payload, s.review_feedback, s.reviewed_at, s.correction_fields, s.submitted_at, s.created_at,
               s.updated_at, o.display_name AS company_name
        FROM manufacturer_submissions s LEFT JOIN organizations o ON o.id = s.target_organization_id
        WHERE s.submitted_by_user_id = :u AND s.kind IN {APPLICATION_KINDS_SQL}
        ORDER BY s.updated_at DESC, s.created_at DESC LIMIT 1
    """), {"u": user_id})).mappings().first()
    return {**row, "payload": _json(row["payload"])} if row else None


def reapply_at(app: dict | None, hours: int) -> datetime | None:
    if not app or app["status"] != "rejected" or not app.get("reviewed_at"):
        return None
    return _as_utc(app["reviewed_at"]) + timedelta(hours=hours)


# The organization the app creates for every signed-in user is only a placeholder (the user's own
# workspace). When the user applied to an EXISTING company (claim / registration under it), that
# placeholder is not a company: it must never be listed, reviewed, approved or searched as one -
# the application lives on the selected company's database id. {o} = organizations alias.
APPLICANT_WORKSPACE_SQL = """({o}.created_by_user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM manufacturer_submissions aw
              WHERE aw.organization_id = {o}.id AND aw.target_organization_id <> {o}.id
                AND aw.kind IN ('claim', 'update_request'))
  AND NOT EXISTS (SELECT 1 FROM manufacturer_submissions aw
                  WHERE aw.target_organization_id = {o}.id AND aw.kind IN ('new_company', 'update'))
  AND NOT EXISTS (SELECT 1 FROM organization_profiles aw
                  WHERE aw.organization_id = {o}.id AND btrim(COALESCE(aw.company_category, '')) <> '')
  AND NOT EXISTS (SELECT 1 FROM machines aw WHERE aw.organization_id = {o}.id)
  AND NOT EXISTS (SELECT 1 FROM memberships aw WHERE aw.organization_id = {o}.id AND aw.status = 'active'
                    AND aw.user_id <> {o}.created_by_user_id))"""


def applicant_workspace_sql(alias: str = "o") -> str:
    return APPLICANT_WORKSPACE_SQL.replace("{o}", alias)


# One query (also embedded in the dashboard snapshot, so the dashboard costs no extra round trip).
# {u} / {o}: SQL expressions for the user id and the organization id.
STATE_SQL = """
    SELECT
      (SELECT m.membership_role FROM memberships m
       WHERE m.user_id = {u} AND m.organization_id = {o} AND m.status = 'active' LIMIT 1) AS membership_role,
      (SELECT mo.status FROM manufacturer_onboarding mo WHERE mo.organization_id = {o}) AS org_status,
      COALESCE((SELECT mo.personal_information_completed FROM manufacturer_onboarding mo
                WHERE mo.organization_id = {o}), false) AS details_sent,
      EXISTS (SELECT 1 FROM manufacturer_submissions s
              WHERE s.organization_id = {o} AND s.kind <> 'update_request') AS has_submission,
      (SELECT __WORKSPACE__ FROM organizations ws WHERE ws.id = {o}) AS applicant_workspace,
      (SELECT row_to_json(a) FROM (
         SELECT s.id, s.kind, s.status, s.target_organization_id, s.review_feedback, s.reviewed_at,
                s.correction_fields, s.submitted_at, s.created_at, t.display_name AS company_name
         FROM manufacturer_submissions s LEFT JOIN organizations t ON t.id = s.target_organization_id
         WHERE s.submitted_by_user_id = {u} AND s.kind IN ('new_company', 'claim', 'update_request')
         ORDER BY s.updated_at DESC, s.created_at DESC LIMIT 1) a) AS app
""".replace("__WORKSPACE__", APPLICANT_WORKSPACE_SQL.replace("{o}", "ws"))


def _time(value):
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


async def state(db: AsyncSession, ctx: dict, settings, row: dict | None = None) -> dict:
    """Access of the signed-in user (`ctx` from ManufacturerRepository.context). `row`: the
    STATE_SQL result when already fetched (dashboard snapshot)."""
    org = ctx["organization_id"]
    if row is None:
        row = dict((await db.execute(text(STATE_SQL.format(u="CAST(:u AS uuid)", o="CAST(:o AS uuid)")),
                                     {"u": str(ctx["user_id"]), "o": str(org)})).mappings().one())
    raw_app = row.get("app")
    app = _json(raw_app) if raw_app else None
    if app:
        for key in ("reviewed_at", "submitted_at", "created_at"):
            app[key] = _time(app.get(key))
    # A placeholder that belongs to an application for another company is never "approved" itself
    # (an admin may have approved it by mistake before this rule): only the application counts.
    org_approved = row.get("org_status") == "approved" and not row.get("applicant_workspace")
    # Accounts that completed the details form before approvals existed: unchanged behaviour.
    legacy = app is None and bool(row.get("details_sent")) and not row.get("has_submission")
    own_approved = bool(app and app["status"] == "approved" and str(app["target_organization_id"]) == str(org))
    unlocked = org_approved or legacy or own_approved
    role = row.get("membership_role")
    status = "approved" if unlocked else (app["status"] if app else "not_submitted")
    hours = int(getattr(settings, "manufacturer_reapply_after_hours", 24))
    again = reapply_at(app, hours) if status == "rejected" else None
    now = datetime.now(timezone.utc)
    if status == "pending":
        message = PENDING_MESSAGE
    elif status == "changes_requested":
        message = CORRECTIONS_MESSAGE
    elif status == "rejected":
        message = ("Your manufacturer application was not approved. "
                   + (f"You can apply again from {fmt_time(again)}." if again and again > now
                      else "You can now send a new application."))
    elif status == "not_submitted":
        message = NOT_SUBMITTED_MESSAGE
    else:
        message = None
    return {
        "unlocked": unlocked,
        "status": status,
        "role": role,
        "canEditProfile": unlocked and (legacy or role in EDIT_PROFILE_ROLES),
        "message": message,
        "application": ({
            "id": str(app["id"]), "kind": app["kind"], "status": app["status"],
            "companyId": str(app["target_organization_id"]), "companyName": app.get("company_name"),
            "feedback": app.get("review_feedback") if app["status"] in ("changes_requested", "rejected") else None,
            "reviewedAt": app.get("reviewed_at"), "submittedAt": app.get("submitted_at") or app.get("created_at"),
            "correctionFields": list(app.get("correction_fields") or []) if app["status"] == "changes_requested" else [],
        } if app else None),
        "reapplyAt": again,
        "canReapply": status == "rejected" and (again is None or again <= now),
    }


async def require(db: AsyncSession, ctx: dict, settings, *, profile: bool = False) -> None:
    """Refuse a manufacturer action until the application is approved (PermissionError -> 403).
    `profile`: the shared company profile, which only the company's owner / admins may edit."""
    s = await state(db, ctx, settings)
    if not s["unlocked"]:
        raise PermissionError(s["message"] or PENDING_MESSAGE)
    if profile and not s["canEditProfile"]:
        raise PermissionError(MEMBER_PROFILE_MESSAGE)


# ------------------------------------------------------------------ submission checks
async def check_reapply(db: AsyncSession, user_id: UUID, settings) -> None:
    """A rejected applicant may send a fresh application only after the waiting period."""
    app = await latest_application(db, user_id)
    again = reapply_at(app, int(getattr(settings, "manufacturer_reapply_after_hours", 24)))
    if again and again > datetime.now(timezone.utc):
        raise LookupError(f"Your manufacturer application was not approved. You can apply again from {fmt_time(again)}.")


def _norm(key: str, value: Any) -> str:
    value = "" if value is None else str(value)
    if key == "companyPhone":
        digits = re.sub(r"\D", "", value)
        return digits[-10:]
    if key == "dob":
        return value[:10]
    return re.sub(r"\s+", " ", value).strip().lower()


def application_values(payload: dict, selected_company_id: Any) -> dict:
    """The comparable values of a staged application (personal + company + selection)."""
    applicant = payload.get("applicant") or {}
    return {
        "firstName": applicant.get("firstName"), "lastName": applicant.get("lastName"),
        "personalEmail": applicant.get("personalEmail"), "dob": applicant.get("dob"),
        "company": str(selected_company_id) if selected_company_id else "",
        "companyName": payload.get("companyName"), "companyType": payload.get("companyType"),
        "country": payload.get("country"), "companyPhone": payload.get("contactPhone"),
        "capacity": payload.get("capacity"),
    }


async def check_corrections(db: AsyncSession, user_id: UUID, new: dict) -> None:
    """While corrections are requested, only the fields the admin listed may change.
    `new` holds the same keys as `application_values`."""
    app = await latest_application(db, user_id)
    if not app or app["status"] != "changes_requested":
        return
    fields = set(app.get("correction_fields") or [])
    if not fields:
        return  # an older request without a field list: unchanged behaviour
    if "companyName" in fields:
        fields.add("company")  # correcting the company name may mean picking the right listed company
    old = application_values(app["payload"], app["selected_company_id"])
    has_applicant = bool(app["payload"].get("applicant"))
    locked = []
    for key, label in CORRECTABLE.items():
        if key in fields:
            continue
        if key in ("firstName", "lastName", "personalEmail", "dob") and not has_applicant:
            continue
        if _norm(key, old.get(key)) != _norm(key, new.get(key)):
            locked.append(label)
    if locked:
        raise ValueError("Only the fields XfactorY asked you to correct can be changed: "
                         + ", ".join(CORRECTABLE[k] for k in CORRECTABLE if k in fields)
                         + ". Not open for correction: " + ", ".join(locked) + ".")


# ------------------------------------------------------------------ approval of a join request
async def grant_membership(db: AsyncSession, *, company_id: UUID | str, user_id: UUID,
                           workspace_id: UUID | str | None) -> None:
    """Approved application to an existing company that has an owner: link the applicant as a
    MEMBER (an existing owner / admin role is kept; ownership is never granted here). The
    applicant's empty, never-approved placeholder organization is retired (kept, archived)."""
    await db.execute(text("""
        INSERT INTO memberships (user_id, organization_id, membership_role, status, accepted_at)
        VALUES (:u, CAST(:t AS uuid), 'member', 'active', now())
        ON CONFLICT (organization_id, user_id) DO UPDATE SET
          membership_role = CASE WHEN memberships.status = 'active' THEN memberships.membership_role ELSE 'member' END,
          status = 'active', accepted_at = COALESCE(memberships.accepted_at, now()),
          version = memberships.version + 1
    """), {"u": user_id, "t": str(company_id)})
    if not workspace_id or str(workspace_id) == str(company_id):
        return
    retire = await db.scalar(text("""
        SELECT o.created_by_user_id = :u
               AND NOT EXISTS (SELECT 1 FROM manufacturer_onboarding mo
                               WHERE mo.organization_id = o.id AND mo.status = 'approved')
               AND NOT EXISTS (SELECT 1 FROM machines mc WHERE mc.organization_id = o.id)
               AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id
                               AND m.status = 'active' AND m.user_id <> :u)
        FROM organizations o WHERE o.id = CAST(:w AS uuid)
    """), {"u": user_id, "w": str(workspace_id)})
    if retire:
        await db.execute(text("""
            UPDATE memberships SET status = 'removed', version = version + 1
            WHERE organization_id = CAST(:w AS uuid) AND user_id = :u
        """), {"w": str(workspace_id), "u": user_id})
        await db.execute(text("""
            UPDATE organizations SET is_archived = true, archived_at = now(), updated_at = now()
            WHERE id = CAST(:w AS uuid)
        """), {"w": str(workspace_id)})


def dob_text(value: Any) -> str:
    if isinstance(value, date):
        return value.isoformat()
    return str(value or "")
