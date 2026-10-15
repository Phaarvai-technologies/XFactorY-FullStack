"""Admin-reviewed update requests for an existing company the requester does not manage.

A signed-in user selects a company that is already registered (it has an active owner / admin)
and submits company details. Instead of being refused, the details are staged as a request:

  * stored in `manufacturer_submissions` with kind 'update_request', the company's database id
    (target_organization_id), the requester (submitted_by_user_id), the proposed values
    (payload; original_payload keeps them exactly as submitted), source 'web_dashboard' (set
    here, never taken from the client), status 'pending' and timestamps. The company's values at
    that moment are kept in base_snapshot. The main record is not touched.
  * one open request per requester and company: a retry or a correction updates it.
  * the platform admin reviews it on the company's admin page: existing and proposed values side
    by side, verification / contact notes (internal), edits to the proposed values, then
    approve (choosing the fields), request corrections, or decline (feedback recorded).
  * approval merges ONLY the chosen fields into the existing record in one transaction, once.
    The company keeps its id, entry / onboarding source, approval status, owners and members and
    all other data. Approval never creates a membership or transfers ownership.
  * the decision must be made on what the admin actually saw: `fingerprint` covers the company's
    current values, the request's values and its status. If the company or the request changed
    meanwhile (another approval, the owner's own edit, a resubmission), the decision is refused
    and the admin reviews the latest differences first.
  * every step is recorded in manufacturer_submission_events (requester / admin, time, details);
    applied field changes also go to the company's admin change history.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

OPEN = ("pending", "changes_requested")
SOURCE = "web_dashboard"
FIELDS = (("companyName", "Company name"), ("companyType", "Category"), ("country", "Country"),
          ("capacity", "Production capacity"), ("contactEmail", "Contact email"),
          ("contactPhone", "Contact phone"))
LABELS = dict(FIELDS)
LIMITS = {"companyName": 200, "companyType": 150, "country": 100, "capacity": 100, "contactEmail": 320,
          "contactPhone": 30}
REQUIRED = {"companyName", "companyType", "country"}
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_RE = re.compile(r"^[0-9+\-\s()]{7,15}$")
DECISIONS = {"approve": "approved", "request_changes": "changes_requested", "decline": "rejected"}


class RequestError(Exception):
    """A request / decision that cannot be carried out. `status` is the HTTP status to return."""

    def __init__(self, message: str, status: int = 409, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


def _json(value) -> dict:
    if value is None:
        return {}
    return json.loads(value) if isinstance(value, (str, bytes)) else dict(value)


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _same(a: Any, b: Any) -> bool:
    return _clean(a).lower() == _clean(b).lower()


def proposed_changes(current: dict, proposed: dict) -> dict:
    """Fields whose proposed value differs from the company's. An empty proposed value is
    'no change proposed' (a request never clears saved data)."""
    return {k: _clean(proposed.get(k)) for k, _ in FIELDS
            if _clean(proposed.get(k)) and not _same(proposed.get(k), current.get(k))}


def fingerprint(current: dict, payload: dict, status: str) -> str:
    body = json.dumps({"c": {k: _clean(current.get(k)) for k, _ in FIELDS},
                       "p": {k: _clean(payload.get(k)) for k, _ in FIELDS}, "s": status}, sort_keys=True)
    return hashlib.sha256(body.encode()).hexdigest()[:32]


def validate(key: str, value: Any) -> str:
    if key not in LABELS:
        raise RequestError("This field cannot be changed through an update request.", 422)
    value = _clean(value)
    if key in REQUIRED and not value:
        raise RequestError(f"{LABELS[key]} cannot be empty.", 422)
    if len(value) > LIMITS[key]:
        raise RequestError(f"{LABELS[key]} is too long.", 422)
    if key == "contactEmail" and value and not EMAIL_RE.match(value):
        raise RequestError("Enter a valid email address.", 422)
    if key == "contactPhone" and value and not PHONE_RE.match(value):
        raise RequestError("Enter a valid phone number.", 422)
    return value


async def current_values(db: AsyncSession, org_id: UUID | str) -> dict:
    row = (await db.execute(text("""
        SELECT o.display_name, op.company_category, op.country_name, op.production_capacity_label,
               op.contact_email::text AS contact_email, op.contact_phone
        FROM organizations o LEFT JOIN organization_profiles op ON op.organization_id = o.id
        WHERE o.id = CAST(:o AS uuid)
    """), {"o": str(org_id)})).mappings().first()
    if row is None:
        raise RequestError("Company not found", 404)
    return {"companyName": row["display_name"] or "", "companyType": row["company_category"] or "",
            "country": row["country_name"] or "", "capacity": row["production_capacity_label"] or "",
            "contactEmail": row["contact_email"] or "", "contactPhone": row["contact_phone"] or ""}


async def _event(db: AsyncSession, submission_id: UUID, event: str, actor: UUID | None, role: str,
                 details: dict | None = None, organization_id: UUID | str | None = None) -> None:
    """History row (shared table and helper with the company's own submissions). Requester
    actions come from the dashboard; admin actions are review actions ('admin_review')."""
    from app.core.onboarding_source import ADMIN_REVIEW
    from app.manufacturer_approval import record_event
    if organization_id is None:
        organization_id = await db.scalar(text(
            "SELECT target_organization_id FROM manufacturer_submissions WHERE id = :s"), {"s": submission_id})
    await record_event(db, event=event, role=role, source=SOURCE if role == "requester" else ADMIN_REVIEW,
                       organization_id=organization_id, submission_id=submission_id, actor=actor,
                       details=details)


# ------------------------------------------------------------------ requester
async def submit(db: AsyncSession, *, user_id: UUID, workspace_id: UUID, company_id: UUID,
                 payload: dict) -> dict:
    """Stage (or refresh) the requester's update request for `company_id`. The caller holds the
    company row lock and has checked that the requester does not manage the company."""
    current = await current_values(db, company_id)
    if not proposed_changes(current, payload):
        raise RequestError("The details you entered are the same as this company's saved details, "
                           "so there is nothing to send for review.", 422)
    previous = (await db.execute(text("""
        SELECT id, payload, original_payload, status FROM manufacturer_submissions
        WHERE submitted_by_user_id = :u AND target_organization_id = :t AND kind = 'update_request'
          AND status IN ('pending', 'changes_requested')
        FOR UPDATE
    """), {"u": user_id, "t": company_id})).mappings().first()
    if previous and previous["status"] == "pending" and _json(previous["original_payload"]) == payload:
        return {"id": previous["id"], "created": False}  # idempotent retry: no change, no new event
    row = (await db.execute(text("""
        INSERT INTO manufacturer_submissions
          (organization_id, target_organization_id, selected_company_id, submitted_by_user_id, kind, payload,
           original_payload, base_snapshot, source, submitted_at)
        VALUES (:w, :t, :t, :u, 'update_request', CAST(:p AS jsonb), CAST(:p AS jsonb), CAST(:b AS jsonb), :src,
                now())
        ON CONFLICT (submitted_by_user_id, target_organization_id)
          WHERE status IN ('pending', 'changes_requested') AND kind = 'update_request'
        DO UPDATE SET organization_id = EXCLUDED.organization_id, payload = EXCLUDED.payload,
                      original_payload = EXCLUDED.original_payload, base_snapshot = EXCLUDED.base_snapshot,
                      status = 'pending', submitted_at = now(), updated_at = now()
        RETURNING id, (xmax = 0) AS created
    """), {"w": workspace_id, "t": company_id, "u": user_id, "p": json.dumps(payload),
           "b": json.dumps(current), "src": SOURCE})).first()
    await _event(db, row.id, "submitted" if row.created else "resubmitted", user_id, "requester",
                 {"proposed": {k: _clean(payload.get(k)) for k, _ in FIELDS}, "source": SOURCE},
                 organization_id=company_id)
    return {"id": row.id, "created": bool(row.created)}


# ------------------------------------------------------------------ admin: read
async def for_target(db: AsyncSession, org_id: str) -> list[dict]:
    """Update requests for this company, open ones first, for the admin page."""
    rows = (await db.execute(text("""
        SELECT s.id, s.status, s.source, s.payload, s.original_payload, s.base_snapshot, s.admin_notes,
               s.review_feedback, s.applied_changes, s.created_at, s.updated_at, s.reviewed_at, s.applied_at,
               s.submitted_by_user_id, ru.first_name AS r_first, ru.last_name AS r_last, ru.email::text AS r_email,
               coalesce(nullif(btrim(concat_ws(' ', au.first_name, au.last_name)), ''), au.display_name) AS reviewer
        FROM manufacturer_submissions s
        JOIN users ru ON ru.id = s.submitted_by_user_id
        LEFT JOIN users au ON au.id = s.reviewed_by_user_id
        WHERE s.target_organization_id = CAST(:o AS uuid) AND s.kind = 'update_request'
        ORDER BY (s.status IN ('pending', 'changes_requested')) DESC, s.updated_at DESC
        LIMIT 50
    """), {"o": org_id})).mappings().all()
    if not rows:
        return []
    current = await current_values(db, org_id)
    events = (await db.execute(text("""
        SELECT e.submission_id, e.event, e.actor_role, e.details, e.created_at,
               coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.display_name, u.email::text) AS actor
        FROM manufacturer_submission_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.submission_id = ANY(CAST(:ids AS uuid[])) ORDER BY e.created_at
    """), {"ids": [str(r["id"]) for r in rows]})).mappings().all()
    out = []
    for r in rows:
        payload, base = _json(r["payload"]), _json(r["base_snapshot"])
        original = _json(r["original_payload"]) or payload
        is_open = r["status"] in OPEN
        changes = proposed_changes(current, payload)
        out.append({
            "id": str(r["id"]), "status": r["status"], "source": r["source"],
            "requestType": "existing_company_update",
            "requester": {"id": str(r["submitted_by_user_id"]),
                          "name": " ".join(x for x in (r["r_first"], r["r_last"]) if x) or r["r_email"],
                          "email": r["r_email"]},
            "submittedAt": r["created_at"], "updatedAt": r["updated_at"],
            "reviewedAt": r["reviewed_at"], "reviewedBy": r["reviewer"], "appliedAt": r["applied_at"],
            "feedback": r["review_feedback"], "adminNotes": r["admin_notes"] or "",
            "appliedChanges": _json(r["applied_changes"]) or None,
            "fields": [{
                "key": k, "label": label,
                "current": current.get(k, ""),
                "proposed": _clean(payload.get(k)),
                "submitted": _clean(original.get(k)),
                "atSubmission": base.get(k, ""),
                # the company's own value changed since the request was made
                "companyChanged": bool(base) and not _same(base.get(k), current.get(k)),
                "differs": k in changes,
                "edited": not _same(original.get(k), payload.get(k)),
            } for k, label in FIELDS],
            "fingerprint": fingerprint(current, payload, r["status"]) if is_open else None,
            "events": [{"event": e["event"], "by": e["actor"], "role": e["actor_role"], "at": e["created_at"],
                        "details": _json(e["details"])} for e in events if e["submission_id"] == r["id"]],
        })
    return out


async def _locked(db: AsyncSession, org_id: str, request_id: str) -> dict:
    # Company row first (same order as the requester's submission), then the request.
    await db.execute(text("SELECT 1 FROM organizations WHERE id = CAST(:o AS uuid) FOR UPDATE"), {"o": org_id})
    row = (await db.execute(text("""
        SELECT s.id, s.status, s.payload, s.original_payload, s.admin_notes, s.submitted_by_user_id,
               s.organization_id, s.target_organization_id, s.applied_at
        FROM manufacturer_submissions s
        WHERE s.id = CAST(:id AS uuid) AND s.target_organization_id = CAST(:o AS uuid)
          AND s.kind = 'update_request'
        FOR UPDATE
    """), {"id": request_id, "o": org_id})).mappings().first()
    if row is None:
        raise RequestError("Update request not found", 404)
    return {**row, "payload": _json(row["payload"])}


# ------------------------------------------------------------------ admin: edit / notes
async def edit(db: AsyncSession, org_id: str, request_id: str, admin_id: UUID,
               values: dict | None, notes: str | None) -> None:
    sub = await _locked(db, org_id, request_id)
    if sub["status"] not in OPEN:
        raise RequestError("This request was already decided.")
    changed = {}
    if values:
        payload = dict(sub["payload"])
        for key, value in values.items():
            new = validate(key, value) if key in REQUIRED or _clean(value) else ""
            if not _same(payload.get(key), new):
                changed[key] = {"from": _clean(payload.get(key)), "to": new}
                payload[key] = new
        if changed:
            await db.execute(text("""
                UPDATE manufacturer_submissions SET payload = CAST(:p AS jsonb), updated_at = now() WHERE id = :id
            """), {"id": sub["id"], "p": json.dumps(payload)})
            await _event(db, sub["id"], "edited", admin_id, "admin", {"changes": changed})
    if notes is not None and _clean(notes) != _clean(sub["admin_notes"]):
        note = (notes or "").strip()[:4000] or None
        await db.execute(text("UPDATE manufacturer_submissions SET admin_notes = :n, updated_at = now() WHERE id = :id"),
                         {"id": sub["id"], "n": note})
        await _event(db, sub["id"], "note", admin_id, "admin", {"notes": note})
    elif not changed:
        raise RequestError("Nothing to change.", 422)


# ------------------------------------------------------------------ admin: decide
async def decide(db: AsyncSession, org_id: str, request_id: str, admin_id: UUID, decision: str,
                 fields: list[str] | None, feedback: str | None, seen: str | None) -> dict:
    """Approve / request changes / decline. Caller commits. Returns what happened."""
    status = DECISIONS.get(decision)
    if status is None:
        raise RequestError("Unsupported decision", 422)
    feedback = (feedback or "").strip()[:2000] or None
    if status != "approved" and not feedback:
        raise RequestError("Add feedback for the requester." if status == "rejected"
                           else "Describe what the requester needs to correct.", 422)
    sub = await _locked(db, org_id, request_id)
    if sub["status"] not in OPEN or sub["applied_at"] is not None:
        raise RequestError("This request was already decided.", 409, "already_decided")
    current = await current_values(db, org_id)
    if seen != fingerprint(current, sub["payload"], sub["status"]):
        raise RequestError("The company record or this request changed after you opened it. "
                           "Review the latest differences, then decide again.", 409, "stale")
    applied: dict = {}
    if status == "approved":
        changes = proposed_changes(current, sub["payload"])
        chosen = list(changes) if fields is None else [k for k in fields if k in LABELS]
        unknown = [k for k in (fields or []) if k not in LABELS]
        if unknown:
            raise RequestError("Unknown field: " + ", ".join(unknown), 422)
        not_changed = [LABELS[k] for k in chosen if k not in changes]
        if not_changed:
            raise RequestError("Nothing to apply for: " + ", ".join(not_changed), 422)
        if not chosen:
            raise RequestError("Choose at least one change to apply, or decline the request.", 422)
        values = {k: validate(k, changes[k]) for k in chosen}
        await _apply(db, org_id, current, values)
        applied = {k: {"from": current.get(k, ""), "to": v} for k, v in values.items()}
    await db.execute(text("""
        UPDATE manufacturer_submissions
        SET status = :s, reviewed_by_user_id = :a, reviewed_at = now(), review_feedback = :f,
            applied_at = CASE WHEN :s = 'approved' THEN now() END,
            applied_changes = CASE WHEN :s = 'approved' THEN CAST(:ap AS jsonb) END, updated_at = now()
        WHERE id = :id
    """), {"s": status, "a": admin_id, "f": feedback, "ap": json.dumps(applied), "id": sub["id"]})
    await _event(db, sub["id"], "decision", admin_id, "admin",
                 {"decision": status, "feedback": feedback, "applied": applied})
    return {"submission": sub, "status": status, "applied": applied, "feedback": feedback}


async def _apply(db: AsyncSession, org_id: str, current: dict, values: dict) -> None:
    """Write only the approved fields to the existing company (row locked by the caller).
    Id, sources, approval status, owners / members and every other column are left as they are."""
    from app.repositories.manufacturer import COUNTRY_CODES, capacity_number  # avoid an import cycle

    if "companyName" in values or "country" in values:
        name = values.get("companyName", current["companyName"])
        country = values.get("country", current["country"])
        clash = await db.scalar(text("""
            SELECT o.id FROM organizations o
            LEFT JOIN organization_profiles op ON op.organization_id = o.id
            JOIN manufacturer_onboarding mo ON mo.organization_id = o.id AND mo.status = 'approved'
            WHERE o.organization_type = 'manufacturer' AND NOT o.is_archived AND o.id <> CAST(:t AS uuid)
              AND lower(regexp_replace(btrim(o.display_name), '\\s+', ' ', 'g'))
                  = lower(regexp_replace(btrim(:n), '\\s+', ' ', 'g'))
              AND lower(btrim(COALESCE(op.country_name, ''))) = lower(btrim(COALESCE(:c, '')))
            LIMIT 1
        """), {"t": org_id, "n": name, "c": country})
        if clash:
            raise RequestError("Another approved company already has this name in this country. "
                               "Edit the proposed name or country, or decline the request.")
    if "companyName" in values:
        await db.execute(text("""
            UPDATE organizations SET display_name = :n, updated_at = now(), version = version + 1
            WHERE id = CAST(:t AS uuid)
        """), {"t": org_id, "n": values["companyName"]})
    columns: dict[str, Any] = {}
    if "companyType" in values:
        columns["company_category"] = values["companyType"]
    if "country" in values:
        columns["country_name"] = values["country"]
        code = COUNTRY_CODES.get(values["country"].lower())
        if code and await db.scalar(text("SELECT 1 FROM countries WHERE code = :c"), {"c": code}):
            columns["country_code"] = code
        else:
            columns["country_code"] = None
    if "capacity" in values:
        columns["production_capacity_label"] = values["capacity"]
        columns["stated_production_capacity"] = capacity_number(values["capacity"])
    if "contactEmail" in values:
        columns["contact_email"] = values["contactEmail"]
    if "contactPhone" in values:
        columns["contact_phone"] = values["contactPhone"]
    if columns:
        # Column names come from the fixed mapping above, never from the request.
        names = list(columns)
        await db.execute(text(f"""
            INSERT INTO organization_profiles (organization_id, {", ".join(names)})
            VALUES (CAST(:t AS uuid), {", ".join(f":{c}" for c in names)})
            ON CONFLICT (organization_id) DO UPDATE SET {", ".join(f"{c} = EXCLUDED.{c}" for c in names)},
              updated_at = now()
        """), {"t": org_id, **columns})
