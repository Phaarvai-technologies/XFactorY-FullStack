import json
import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import company_update_requests as update_requests
from app import manufacturer_access as access
from app import manufacturer_approval as approval
from app import notifications
from app.admin import accounts
from app.admin.auth import AdminContext
from app.admin.repository import (
    REQUIRED_FIELDS,
    REVIEW_TO_DB,
    SECTIONS,
    AdminRepository,
    sections_status,
)
from app.core import email_templates as tpl
from app.core import onboarding_source as sources
from app.core.clerk import ClerkManagement
from app.core.email import Mailer
from app.core.config import Settings
from app.repositories.manufacturer import ManufacturerRepository, profile_flags
from app.schemas.manufacturer import MachineryPatch, ProfilePatchPayload
from app.services.manufacturer import ManufacturerService

log = logging.getLogger("xy.admin")

DB_TO_REVIEW = {"draft": "NOT_STARTED", "in_progress": "IN_PROGRESS", "submitted": "SUBMITTED",
                "under_review": "SUBMITTED", "changes_requested": "NEEDS_CORRECTION",
                "rejected": "REJECTED", "approved": "REVIEWED"}

# XY-ADMIN-06: every field an admin may edit, with its label. Validation reuses
# the onboarding form's own rules (ProfilePatchPayload / MachineryPatch).
PROFILE_FIELDS = {
    "company.name": "Company name", "company.about": "About the company", "company.vision": "Vision & mission",
    "company.estYear": "Year established", "company.employees": "Number of employees",
    "company.businessType": "Business type", "company.orgSize": "Organization size",
    "location.address": "Facility address", "location.city": "City", "location.state": "State / province",
    "location.country": "Facility country", "location.zip": "ZIP / postal code", "location.sez": "SEZ status",
    "location.serviceableAreas": "Serviceable areas",
    "infra.electricity": "Electricity", "infra.water": "Water", "infra.storage": "Storage",
    "infra.packaging": "Packaging", "infra.waste": "Waste disposal", "infra.qa": "Quality assurance",
    "certifications": "Certifications", "faqs": "FAQs",
}
ACCOUNT_FIELDS = {
    "account.companyType": "Company category", "account.country": "Country",
    "account.capacity": "Production capacity", "contact.email": "Contact email", "contact.phone": "Contact phone",
}
MACHINE_FIELDS = {
    "industry": "Industry", "subcategory": "Subcategory", "type": "Machinery type", "capacity": "Capacity",
    "age": "Age", "condition": "Condition", "technical": "Technical details", "rawMatStatus": "Raw materials",
    "materialDetails": "Material details", "laborType": "Labour type", "workerCount": "Workers",
    "workerRoles": "Worker roles", "logistics": "Logistics", "logisticsPartner": "Logistics partner",
    "pricing": "Pricing", "insurance": "Insurance",
}
# Required by the onboarding form: can be changed but not cleared.
REQUIRED_KEYS = {"company.name", "company.about", "location.address", "location.city", "location.country",
                 "account.companyType", "account.country"}
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_RE = re.compile(r"^[0-9+\-\s()]{7,15}$")
# REVIEWED is stored as an approval (manufacturer_onboarding.status = 'approved'): shown as "Approved".
REVIEW_LABELS = {"NOT_STARTED": "Not started", "IN_PROGRESS": "In progress", "SUBMITTED": "Submitted",
                 "NEEDS_CORRECTION": "Needs correction", "REVIEWED": "Approved", "REJECTED": "Rejected"}
REQUEST_KIND_LABELS = {"new_company": "New company account", "claim": "Claim of existing company",
                       "update": "Owner's change to details",
                       "update_request": "Registration under this company (another user)"}


def _json_obj(value):
    if value is None:
        return None
    return json.loads(value) if isinstance(value, (str, bytes)) else dict(value)


def list_row(r: dict) -> dict:
    contact = " ".join(x for x in (r.get("first_name"), r.get("last_name")) if x) or None
    location = ", ".join(x for x in (r.get("city"), r.get("country")) if x) or None
    return {
        "id": str(r["organization_id"]), "companyName": r["company_name"],
        # Company contact = the company's own saved contact details only. A linked user's name /
        # sign-in email is never shown as (or mixed into) the company contact: see primaryUser.
        "contactName": None,
        "contactEmail": r.get("contact_email"),
        "contactPhone": r.get("contact_phone"),
        # the first active member (owner first), shown separately as a person
        "primaryUser": ({"id": str(r["user_id"]), "name": contact, "email": r.get("user_email")}
                        if r.get("user_id") else None),
        "industry": r.get("industry"), "country": r.get("country"), "city": r.get("city"), "location": location,
        "majorProcess": r.get("major_process"), "listingCount": r.get("listing_count", 0),
        "completeness": r["completeness"], "requiredDone": r["required_done"], "requiredTotal": r["required_total"],
        "reviewStatus": r["review_status"], "recordType": r["record_type"], "entrySource": r["entry_source"],
        # how the company first came onto XfactorY (None = unknown); separate from approval / review status
        "onboardingSource": r.get("onboarding_source"),
        # why the source is unknown (from the evidence backfill), when it is
        "onboardingSourceNote": r.get("onboarding_source_note") if not r.get("onboarding_source") else None,
        # not approved yet: the channel recorded on its staged new-company submission (+ that status)
        "stagedSource": _json_obj(r.get("staged_source")) if not r.get("onboarding_source") else None,
        "referralSource": r.get("referral_source"),
        "assignedAdminId": str(r["assigned_admin_user_id"]) if r.get("assigned_admin_user_id") else None,
        "isArchived": r["is_archived"], "archivedAt": r.get("archived_at"),
        "registeredAt": r["registered_at"], "lastUpdated": r.get("last_updated") or r["registered_at"],
        "lastSeenAt": r.get("last_seen_at"), "ownerUserId": str(r["user_id"]) if r.get("user_id") else None,
        "attentionReason": r.get("attention_reason"),
        "linkedUsers": int(r.get("linked_users") or 0),
        # review queue only: the newest request awaiting a decision on this company
        "request": ({"kind": r["request_kind"], "label": REQUEST_KIND_LABELS.get(r["request_kind"], r["request_kind"]),
                     "requestedBy": r.get("requested_by"), "submittedAt": r.get("request_submitted_at"),
                     "openCount": int(r.get("open_requests") or 0)} if r.get("request_kind") else None),
        **sections_status(r),
    }


def normalize(value: Any) -> Any:
    if isinstance(value, str):
        return value.strip()
    return value


class AdminService:
    def __init__(self, session: AsyncSession, settings: Settings):
        self.db = session
        self.repo = AdminRepository(session)
        self.mrepo = ManufacturerRepository(session)
        self.msvc = ManufacturerService(session, settings)
        self.clerk = ClerkManagement(settings)
        self.settings = settings
        self.mailer = Mailer(settings, session)

    async def _run(self, coro):
        return await self.msvc._run(coro)

    async def _ctx(self, org_id: str) -> dict:
        return await self._run(self.mrepo.context_for_org(org_id))

    async def _view(self, ctx: dict) -> tuple[dict, dict]:
        raw = await self._run(self.mrepo.snapshot(None, ctx=ctx))
        return raw, self.msvc.view(raw)

    async def _admin_names(self) -> dict[str, str]:
        return {str(a["id"]): a["name"] for a in await self.repo.admins()}

    # ------------------------------------------------------------------ XY-ADMIN-01
    async def me(self, admin: AdminContext) -> dict:
        return {"id": str(admin.user_id), "name": admin.name, "email": admin.email, "roles": list(admin.roles),
                "authMethod": admin.auth_method, "mustChangePassword": admin.must_change_password}

    async def admins(self) -> list[dict]:
        return [{"id": str(a["id"]), "name": a["name"], "email": a["email"]} for a in await self.repo.admins()]

    # ------------------------------------------------------------------ XY-ADMIN-02
    async def overview(self) -> dict:
        data = await self._run(self.repo.overview())
        names = await self._admin_names()

        def rows(items):
            out = [list_row(r) for r in items]
            for r in out:
                r["assignedAdminName"] = names.get(r["assignedAdminId"] or "")
            return out
        c = data["cards"]
        return {"cards": {"totalUsers": c["total_users"], "totalManufacturers": c["total_manufacturers"],
                          "completed": c["completed"], "incomplete": c["incomplete"],
                          "awaitingReview": c["awaiting_review"], "testDemo": c["test_demo"],
                          "openSupportIssues": c["open_support_issues"]},
                "recentRegistrations": rows(data["recent"]), "recentlyUpdated": rows(data["updated"]),
                "needsAttention": rows(data["attention"])}

    # ------------------------------------------------------------------ XY-ADMIN-04 / 07
    async def manufacturers(self, filters: dict, page: int, page_size: int, sort: str) -> dict:
        data = await self._run(self.repo.manufacturers(filters, page, page_size, sort))
        names = await self._admin_names()
        rows = [list_row(r) for r in data["rows"]]
        for r in rows:
            r["assignedAdminName"] = names.get(r["assignedAdminId"] or "")
        return {"total": data["total"], "page": page, "pageSize": page_size, "rows": rows,
                "facets": {"industries": data["facets"]["industries"] or [],
                           "countries": data["facets"]["countries"] or []}}

    async def review_queue(self, filters: dict, admin: AdminContext) -> dict:
        if filters.get("assigned") == "me":
            filters = {**filters, "assigned_to": str(admin.user_id), "assigned": None}
        rows = [list_row(r) for r in await self._run(self.repo.review_queue(filters))]
        names = await self._admin_names()
        for r in rows:
            r["assignedAdminName"] = names.get(r["assignedAdminId"] or "")
        return {"rows": rows, "admins": await self.admins()}

    # ------------------------------------------------------------------ XY-ADMIN-05
    async def _applied_elsewhere(self, org_id: str) -> str | None:
        """For a user's placeholder kept only for an application to another (existing) company:
        that company's name. Such a placeholder is not a company and is never reviewed itself."""
        return await self.repo.db.scalar(text(f"""
            SELECT (SELECT t.display_name FROM manufacturer_submissions s JOIN organizations t
                    ON t.id = s.target_organization_id
                    WHERE s.organization_id = o.id AND s.kind IN ('claim', 'update_request')
                    ORDER BY s.updated_at DESC LIMIT 1)
            FROM organizations o
            WHERE o.id = CAST(:o AS uuid) AND {access.applicant_workspace_sql("o")}
        """), {"o": org_id})

    async def _company_only(self, org_id: str) -> None:
        target = await self._applied_elsewhere(org_id)
        if target:
            raise HTTPException(404, f"This is not a company. The user applied to join {target}: "
                                     f"review the application on {target}'s page (Associated users).")

    async def detail(self, org_id: str) -> dict:
        await self._company_only(org_id)
        ctx = await self._ctx(org_id)
        raw, view = await self._view(ctx)
        row = await self.repo.overview_row(org_id)
        names = await self._admin_names()
        summary = list_row(row)
        summary["assignedAdminName"] = names.get(summary["assignedAdminId"] or "")
        p = raw["profile"]
        timeline = [{"at": row["registered_at"], "event": "Manufacturer record created"}]
        if row.get("onboarding_started_at"):
            timeline.append({"at": row["onboarding_started_at"], "event": "Onboarding form submitted (account created)"})
        if row.get("submitted_at"):
            timeline.append({"at": row["submitted_at"], "event": "Profile completed and submitted for review"})
        if row.get("reviewed_at"):
            decision = {"approved": "Approved by XfactorY", "changes_requested": "Corrections requested by XfactorY",
                        "rejected": "Rejected by XfactorY"}.get(row.get("onboarding_raw_status") or "")
            if decision:
                timeline.append({"at": row["reviewed_at"], "event": decision})
        submissions = await approval.submissions_for_target(self.db, org_id)
        kind_label = {"new_company": "Company details", "claim": "Request to manage this company",
                      "update": "Change to company details",
                      "update_request": "Update request from another user"}
        for sub in submissions:
            timeline.append({"at": sub["created_at"], "event": f'{kind_label[sub["kind"]]} submitted for approval'})
            if sub["reviewed_at"]:
                verb = {"approved": "approved", "rejected": "rejected",
                        "changes_requested": "returned for corrections"}.get(sub["status"])
                if verb:
                    timeline.append({"at": sub["reviewed_at"], "event": f'{kind_label[sub["kind"]]} {verb} by XfactorY'})
        # The company's own submission (update requests from other users are listed separately).
        open_sub = next((x for x in reversed(submissions)
                         if x["status"] in approval.OPEN and x["kind"] != "update_request"), None)
        pending = None
        if open_sub:
            applicant = open_sub["payload"].get("applicant") or {}
            previous, changed = await self._previous_version(open_sub)
            submitter = next((u for u in await self.repo.linked_users(str(open_sub["organization_id"]))
                              if str(u["id"]) == str(open_sub["submitted_by_user_id"])), None)
            # main record values (the list shows a pending new company under its submitted name)
            current = {"companyName": p.get("display_name") or "", "companyType": p.get("company_category") or "",
                       "country": p.get("account_country") or "", "capacity": p.get("production_capacity_label") or "",
                       "contactEmail": p.get("contact_email") or "", "contactPhone": p.get("contact_phone") or ""}
            pending = {
                "id": str(open_sub["id"]), "kind": open_sub["kind"], "kindLabel": kind_label[open_sub["kind"]],
                "status": open_sub["status"], "submittedAt": open_sub["updated_at"],
                "submittedBy": ({"name": f'{submitter.get("first_name") or ""} {submitter.get("last_name") or ""}'.strip(),
                                 "email": submitter.get("email") or ""} if submitter else None),
                "feedback": open_sub["review_feedback"],
                "fields": [{"key": k, "label": label, "submitted": open_sub["payload"].get(k) or "",
                            "current": current.get(k) or "",
                            # changed by the applicant's latest resubmission (corrections)
                            "changed": k in changed, "previous": previous.get(k) or ""}
                           for k, label in (("companyName", "Company name"), ("companyType", "Category"),
                                            ("country", "Country"), ("capacity", "Production capacity"),
                                            ("contactEmail", "Contact email"), ("contactPhone", "Contact phone"))],
                # the applicant's personal information (admins only; never company contact details)
                "applicant": [{"key": k, "label": label, "submitted": str(applicant.get(k) or ""),
                               "changed": f"applicant.{k}" in changed,
                               "previous": str((previous.get("applicant") or {}).get(k) or "")}
                              for k, label in (("firstName", "First name"), ("lastName", "Last name"),
                                               ("personalEmail", "Personal email"), ("dob", "Date of birth"))]
                             if applicant else [],
                "correctionFields": list(open_sub.get("correction_fields") or []),
                "correctable": access.CORRECTABLE,
            }
        if row.get("last_updated"):
            timeline.append({"at": row["last_updated"], "event": "Last profile update"})
        return {
            "manufacturer": summary,
            "profile": {"profileData": view["profileData"], "state": view["state"],
                        "profileProgress": view["profileProgress"], "machineryDraft": view["machineryDraft"]},
            "contacts": {"email": p.get("contact_email") or "", "phone": p.get("contact_phone") or ""},
            "linkedUsers": [{**u, "id": str(u["id"])} for u in await self.repo.linked_users(org_id)],
            # every user linked to exactly this company by membership (any status), with roles
            "members": [{"id": str(u["id"]), "name": " ".join(x for x in (u["first_name"], u["last_name"]) if x) or None,
                         "email": u["email"], "accountStatus": u["account_status"], "membershipRole": u["membership_role"],
                         "membershipStatus": u["membership_status"], "roles": list(u["roles"] or []),
                         "linkedAt": u["linked_at"], "lastSeenAt": u["last_seen_at"]}
                        for u in await self.repo.members(org_id)],
            "notes": [{**n, "id": str(n["id"])} for n in await self.repo.notes(org_id)],
            "history": [{**h, "id": str(h["id"])} for h in await self.repo.history(org_id)],
            "timeline": sorted(timeline, key=lambda t: t["at"], reverse=True),
            "pendingSubmission": pending,
            "onboarding": await self._onboarding(org_id),
            "updateRequests": await update_requests.for_target(self.db, org_id),
            "admins": await self.admins(),
            "requiredFields": [{"key": c, "label": label, "section": sec, "done": bool(row.get(c))}
                               for c, label, sec in REQUIRED_FIELDS],
            "sectionsOrder": SECTIONS,
            "editable": {"profile": PROFILE_FIELDS, "account": ACCOUNT_FIELDS, "machinery": MACHINE_FIELDS,
                         "required": sorted(REQUIRED_KEYS)},
        }

    async def _is_empty_placeholder(self, org_id: str) -> bool:
        """A user's own empty organization: created by the app at sign-in, details never sent."""
        return bool(await self.repo.db.scalar(text("""
            SELECT o.created_by_user_id IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM manufacturer_submissions s
                                   WHERE s.target_organization_id = o.id OR s.organization_id = o.id)
                   AND NOT COALESCE((SELECT mo.personal_information_completed FROM manufacturer_onboarding mo
                                     WHERE mo.organization_id = o.id), false)
            FROM organizations o WHERE o.id = CAST(:o AS uuid)
        """), {"o": org_id}))

    async def _previous_version(self, sub: dict) -> tuple[dict, set[str]]:
        """The applicant's resubmission: the version before it and the fields that changed."""
        rows = await self.repo.rows("""
            SELECT e.details FROM manufacturer_submission_events e
            WHERE e.submission_id = CAST(:s AS uuid) AND e.event IN ('submitted', 'resubmitted')
            ORDER BY e.created_at DESC LIMIT 2
        """, {"s": str(sub["id"])})
        if len(rows) < 2 or sub["status"] != "pending":
            return {}, set()
        older = (_json_obj(rows[1]["details"]) or {}).get("proposed") or {}
        newer = sub["payload"]
        changed = {k for k in ("companyName", "companyType", "country", "capacity", "contactEmail", "contactPhone")
                   if str(older.get(k) or "") != str(newer.get(k) or "")}
        old_a, new_a = older.get("applicant") or {}, newer.get("applicant") or {}
        changed |= {f"applicant.{k}" for k in ("firstName", "lastName", "personalEmail", "dob")
                    if old_a and str(old_a.get(k) or "") != str(new_a.get(k) or "")}
        return older, changed

    HISTORY_LABELS = {"imported": "Imported", "submitted": "Submitted for review", "resubmitted": "Resubmitted",
                      "edited": "Proposed values edited by admin", "note": "Admin note on request",
                      "decision": "Review decision", "merged": "Approved details merged into the company",
                      "created": "Company added by an admin", "source_backfilled": "Source set from evidence"}

    async def _onboarding(self, org_id: str) -> dict:
        info = await self.repo.onboarding_info(org_id)
        org = info["org"]
        batch = ({"id": str(org["batch_id"]), "reference": org["source_reference"], "importedBy": org["imported_by"],
                  "importedAt": org["imported_at"]} if org.get("batch_id") else None)
        ev = org.get("backfill_evidence")
        ev = json.loads(ev) if isinstance(ev, (str, bytes)) else (ev or {})
        backfill = None
        if org.get("backfill_outcome"):
            backfill = {"outcome": org["backfill_outcome"], "rule": org["backfill_rule"], "at": org["backfill_at"],
                        "evidence": ev.get("evidence") or [], "reason": ev.get("why")}
        return {
            "source": org.get("onboarding_source"), "sourceLabel": sources.label(org.get("onboarding_source")),
            # when unknown: the reason the evidence backfill left it unresolved (None = not examined yet)
            "note": (backfill or {}).get("reason") if not org.get("onboarding_source") else None,
            "staged": _json_obj(org.get("staged_source")) if not org.get("onboarding_source") else None,
            # when the value was assigned by the evidence backfill (not at creation): rule, evidence, time
            "backfill": backfill,
            "importBatch": batch,
            "history": [{"id": str(e["id"]), "event": e["event"], "label": self.HISTORY_LABELS.get(e["event"], e["event"]),
                         "source": e["source"],
                         "sourceLabel": ("Admin review" if e["source"] == sources.ADMIN_REVIEW
                                         else sources.label(e["source"])),
                         "actor": e["actor"] or ("System (import job)" if e["actor_role"] == "system" else None),
                         "actorRole": e["actor_role"], "at": e["created_at"],
                         "submissionKind": e["submission_kind"],
                         "decision": (json.loads(e["details"]) if isinstance(e["details"], (str, bytes))
                                      else (e["details"] or {})).get("decision")}
                        for e in info["events"]],
        }

    REQUEST_STATUS = {"pending": "Awaiting review", "changes_requested": "Corrections requested",
                      "approved": "Approved", "rejected": "Rejected"}

    async def people(self, org_id: str) -> dict:
        """Registered users (memberships) and onboarding / change requests of exactly this company.
        Admin only (route dependency). Users are found through the company's database id only."""
        await self._ctx(org_id)  # 404 for an unknown company
        members = await self.repo.members(org_id)
        users = []
        for u in members:
            name = " ".join(x for x in (u["first_name"], u["last_name"]) if x) or u.get("display_name")
            users.append({"id": str(u["id"]), "name": name, "email": u["email"],
                          # the person's own email from onboarding (falls back to the sign-in email);
                          # never the company's contact details
                          "personalEmail": u.get("personal_email") or u["email"], "role": u["membership_role"],
                          "membershipStatus": u["membership_status"], "accountStatus": u["account_status"],
                          "linkedAt": u.get("accepted_at") or u["linked_at"],
                          "registeredAt": u.get("registration_completed_at") or u.get("user_created_at"),
                          # latest manufacturer application for this company (None = none sent)
                          "applicationStatus": u.get("application_status"),
                          "roles": list(u["roles"] or [])})
        requests = []
        for r in await self.repo.company_requests(org_id):
            name = " ".join(x for x in (r["first_name"], r["last_name"]) if x) or r.get("display_name")
            requests.append({"id": str(r["id"]), "kind": r["kind"],
                             "kindLabel": REQUEST_KIND_LABELS.get(r["kind"], r["kind"]),
                             "status": r["status"], "statusLabel": self.REQUEST_STATUS.get(r["status"], r["status"]),
                             "source": r["source"], "submittedAt": r["submitted_at"] or r["created_at"],
                             "reviewedAt": r["reviewed_at"], "reviewer": r["reviewer"], "feedback": r["review_feedback"],
                             "requester": ({"id": str(r["user_id"]), "name": name, "email": r["email"],
                                            "personalEmail": r.get("personal_email") or r["email"],
                                            "accountStatus": r.get("account_status") or "active"}
                                           if r.get("user_id") else None),
                             "requesterIsMember": bool(r["is_member"])})
        active_ids = {u["id"] for u in users if u["membershipStatus"] == "active"}
        # Primary user: the company's active owner (by membership - never by name or email domain).
        # Another user registering under the company never replaces it.
        primary = next((u for u in users if u["role"] == "owner" and u["membershipStatus"] == "active"), None)
        seen: set[str] = {primary["id"]} if primary else set()
        other = []
        for u in users:  # each associated user once, with their membership status
            if u["id"] not in seen:
                seen.add(u["id"])
                other.append(u)
        # Pending onboarding / change requests from people who are not confirmed users of the company.
        pending = [r for r in requests if r["status"] in ("pending", "changes_requested") and not r["requesterIsMember"]]
        # Associated users also list applicants waiting for review (not members yet, not counted),
        # each once, with their own application status.
        for r in pending:
            person = r.get("requester")
            if person and person["id"] not in seen:
                seen.add(person["id"])
                other.append({"id": person["id"], "name": person["name"], "email": person["email"],
                              "personalEmail": person.get("personalEmail") or person["email"],
                              "role": "applicant", "membershipStatus": "pending",
                              "accountStatus": person.get("accountStatus") or "active",
                              "linkedAt": None, "registeredAt": r.get("submittedAt"),
                              "applicationStatus": r["status"], "roles": []})
        # A new company's first registering user is its PROPOSED primary owner until XfactorY approves it.
        proposed = bool(primary) and (await approval.approval_status(self.db, UUID(org_id))) != "approved"
        return {"registeredUsers": users, "requests": requests,
                "primaryUser": primary, "primaryProposed": proposed, "otherUsers": other, "pendingRequests": pending,
                "counts": {"linkedUsers": len(active_ids), "confirmedUsers": len(active_ids),
                           "pendingRequests": len(pending),
                           "openRequests": sum(1 for r in requests if r["status"] in ("pending", "changes_requested"))}}

    # ------------------------------------------------------------------ XY-ADMIN-06
    def _current_value(self, field: str, raw: dict, view: dict) -> Any:
        pd, state, p = view["profileData"], view["state"], raw["profile"]
        if field in ("certifications", "faqs"):
            return pd[field]
        if field.startswith(("company.", "location.", "infra.")):
            section, key = field.split(".", 1)
            return pd[section].get(key)
        if field == "contact.email":
            return p.get("contact_email") or ""
        if field == "contact.phone":
            return p.get("contact_phone") or ""
        if field.startswith("account."):
            return state["account"].get(field.split(".", 1)[1])
        if field.startswith("machinery."):
            _, machine_id, key = field.split(".", 2)
            machines = list(state["machinery"])
            if view.get("machineryDraft"):
                machines.append({"id": view["machineryDraft"]["id"], **view["machineryDraft"]["data"]})
            machine = next((m for m in machines if m["id"] == machine_id), None)
            if machine is None:
                raise LookupError("Machinery listing not found")
            return machine.get(key)
        raise ValueError("This field cannot be edited")

    def _label(self, field: str) -> str:
        if field.startswith("machinery."):
            return f'Machinery: {MACHINE_FIELDS.get(field.split(".", 2)[2], field)}'
        return PROFILE_FIELDS.get(field) or ACCOUNT_FIELDS.get(field) or field

    def _validate(self, field: str, value: Any) -> tuple[str, Any, dict]:
        """Returns (kind, normalized value, changes). Same rules as the onboarding form."""
        value = normalize(value)
        if field in REQUIRED_KEYS and value in (None, ""):
            raise ValueError(f"{self._label(field)} is required and cannot be empty.")
        try:
            if field in PROFILE_FIELDS:
                if field in ("certifications", "faqs"):
                    payload = ProfilePatchPayload.model_validate({field: value or []})
                    changes = payload.changes()
                    return "profile", changes[field], changes
                section, key = field.split(".", 1)
                changes = ProfilePatchPayload.model_validate({section: {key: value}}).changes()
                return "profile", changes[section][key], changes
            if field in ACCOUNT_FIELDS:
                text = "" if value is None else str(value)
                limits = {"account.companyType": 150, "account.country": 100, "account.capacity": 100,
                          "contact.email": 320, "contact.phone": 30}
                if len(text) > limits[field]:
                    raise ValueError(f"{self._label(field)} is too long.")
                if field == "contact.email" and text and not EMAIL_RE.match(text):
                    raise ValueError("Enter a valid email address.")
                if field == "contact.phone" and text and not PHONE_RE.match(text):
                    raise ValueError("Enter a valid phone number.")
                return "account", text, {}
            if field.startswith("machinery."):
                parts = field.split(".", 2)
                if len(parts) != 3 or parts[2] not in MACHINE_FIELDS:
                    raise ValueError("This field cannot be edited")
                try:
                    UUID(parts[1])
                except ValueError as exc:
                    raise ValueError("Unknown machinery listing") from exc
                key = parts[2]
                if key in ("type", "industry") and value in (None, ""):
                    raise ValueError(f"{MACHINE_FIELDS[key]} is required and cannot be empty.")
                changes = MachineryPatch.model_validate({key: value}).changes()
                return "machinery", changes[key], changes
        except ValidationError as exc:
            first = exc.errors()[0]
            raise ValueError(str(first.get("msg", "Invalid value")).removeprefix("Value error, ")) from exc
        raise ValueError("This field cannot be edited")

    async def edit_field(self, admin: AdminContext, org_id: str, field: str, value: Any, reason: str) -> dict:
        ctx = await self._ctx(org_id)
        raw, view = await self._view(ctx)
        old = await self._run(self._async(self._current_value, field, raw, view))
        kind, new, changes = await self._run(self._async(self._validate, field, value))
        if normalize(old) == new or (old in (None, "") and new in (None, "")):
            raise HTTPException(422, "The new value is the same as the current value.")
        if field == "contact.email" and not new and not raw["profile"].get("contact_phone"):
            raise HTTPException(422, "Keep an email or a phone number for this manufacturer.")
        if field == "contact.phone" and not new and not raw["profile"].get("contact_email"):
            raise HTTPException(422, "Keep an email or a phone number for this manufacturer.")

        async def apply():
            if kind == "profile":
                await self.mrepo.update_profile(None, changes, {}, commit=False, ctx=ctx)
            elif kind == "account":
                code = await self.mrepo._country_code(new) if field == "account.country" else None
                await self.repo.update_account_field(ctx, field, new, code)
            else:
                machine_id = UUID(field.split(".", 2)[1])
                belongs = await self.repo.row("SELECT 1 AS ok FROM machines WHERE id=:m AND organization_id=:o",
                                              {"m": machine_id, "o": ctx["organization_id"]})
                if not belongs:
                    raise LookupError("Machinery listing not found")
                await self.mrepo._apply_machinery_changes(machine_id, changes, None)
            await self.repo.add_history(org_id, self._label(field), old, new, admin.user_id, reason)
            label = self._label(field)
            await notifications.notify_company(
                self.db, org_id, "profile_edit",
                "The XfactorY team updated a machinery listing" if kind == "machinery" else "The XfactorY team updated your profile",
                f"{label}: {self._shown(old)} → {self._shown(new)}\nReason: {reason.strip()}", admin.user_id)
            await self.db.commit()
        await self._run(apply())

        # Keep onboarding flags / status in line with the corrected data.
        row = await self.repo.overview_row(org_id)
        if row and row.get("onboarding_started_at") and kind == "profile":
            _, after = await self._view(ctx)
            await self._run(self.mrepo.set_onboarding_flags(None, profile_flags(after["profileData"]), ctx=ctx))
        return await self.detail(org_id)

    @staticmethod
    async def _async(fn, *args):
        return fn(*args)

    @staticmethod
    def _shown(value: Any) -> str:
        if value in (None, "", [], {}):
            return "(empty)"
        if isinstance(value, (list, tuple)):
            value = ", ".join(str(v) for v in value)
        text_value = str(value)
        return f"“{text_value[:200]}{'…' if len(text_value) > 200 else ''}”"

    # ------------------------------------------------------------------ XY-ADMIN-07 / 08
    async def admin_fields(self, admin: AdminContext, org_id: str, body: dict) -> dict:
        await self._company_only(org_id)
        meta = await self.repo.org_meta(org_id)
        if not meta:
            raise HTTPException(404, "Manufacturer not found")
        reason = body.get("reason")
        names = await self._admin_names()
        changed = False
        for key, column, label in (("record_type", "record_type", "Record type"),
                                   ("entry_source", "entry_source", "Entry source"),
                                   ("referral_source", "referral_source", "Referral source")):
            if body.get(key) is None:
                continue
            new = normalize(body[key]) or None
            if new != meta[column]:
                await self.repo.set_org_field(org_id, column, new)
                await self.repo.add_history(org_id, label, meta[column], new, admin.user_id, reason)
                changed = True
        if body.get("unassign") or body.get("assigned_admin_id"):
            new_admin = None if body.get("unassign") else str(body["assigned_admin_id"])
            if new_admin and not await self.repo.is_admin(new_admin):
                raise HTTPException(422, "Only XfactorY admins can be assigned.")
            old_admin = str(meta["assigned_admin_user_id"]) if meta["assigned_admin_user_id"] else None
            if new_admin != old_admin:
                await self.repo.set_org_field(org_id, "assigned_admin_user_id", new_admin)
                await self.repo.add_history(org_id, "Assigned admin", names.get(old_admin or "", "Unassigned"),
                                            names.get(new_admin or "", "Unassigned"), admin.user_id, reason)
                changed = True
        review_email = None
        if body.get("review_status"):
            current_row = await self.repo.overview_row(org_id)
            old = (current_row or {}).get("review_status") or DB_TO_REVIEW.get(
                meta["onboarding_raw_status"] or "draft", "NOT_STARTED")
            new = body["review_status"]
            if new != old:
                if new in ("NEEDS_CORRECTION", "REJECTED") and not (reason or "").strip():
                    raise HTTPException(422, "Add a short note explaining what needs correcting."
                                        if new == "NEEDS_CORRECTION" else "Add a short note explaining the rejection.")
                try:
                    fix = access.correction_fields(body.get("correction_fields")) if new == "NEEDS_CORRECTION" else []
                except ValueError as exc:
                    raise HTTPException(422, str(exc)) from exc
                if new == "NEEDS_CORRECTION" and not fix and await approval.open_submission_for_target(self.db, org_id):
                    raise HTTPException(422, "Choose the fields the applicant needs to correct.")
                # A submission awaiting review: the decision applies to it (approval merges it
                # into the main record). Otherwise the company's own status changes as before.
                decision = {"REVIEWED": "approved", "NEEDS_CORRECTION": "changes_requested",
                            "REJECTED": "rejected"}.get(new)
                sub = None
                if decision:
                    try:
                        sub = await approval.decide(self.db, org_id, decision, admin.user_id, reason, fix)
                    except approval.DecisionError as exc:
                        await self.db.rollback()
                        raise HTTPException(409, str(exc)) from exc
                if sub is None:
                    if new == "REVIEWED" and await self._is_empty_placeholder(org_id):
                        # The organization the app creates for every signed-in user: approving it
                        # before the user sent an application would unlock the manufacturer
                        # sections without any review.
                        raise HTTPException(422, "This user has not sent their manufacturer application yet. "
                                                 "There is nothing to approve.")
                    await self.repo.set_review_status(org_id, new, admin.user_id, reason)
                # Messages go to the submitter's own organization (for a claim that is not this company).
                notify_org = str(sub["organization_id"]) if sub else org_id
                await self.repo.add_history(org_id, "Review status", REVIEW_LABELS[old], REVIEW_LABELS[new],
                                            admin.user_id, reason)
                fix_text = ("\nFields to correct: " + ", ".join(access.CORRECTABLE[k] for k in fix)) if fix else ""
                if new == "NEEDS_CORRECTION" and (reason or "").strip():
                    # The correction note is always shown to the manufacturer.
                    await self.repo.add_note(notify_org, admin.user_id,
                                             f"Correction requested: {reason.strip()}{fix_text}", shared=True)
                    await notifications.notify_company(
                        self.db, notify_org, "needs_correction", "Your manufacturer application needs corrections",
                        reason.strip() + fix_text, admin.user_id)
                if new == "REJECTED":
                    again = access.fmt_time(datetime.now(timezone.utc) + timedelta(
                        hours=self.settings.manufacturer_reapply_after_hours))
                    await notifications.notify_company(
                        self.db, notify_org, "admin_note", "Your manufacturer application was not approved",
                        f"{reason.strip()}\nYou can apply again from {again}.", admin.user_id)
                    review_email = ("REJECTED", reason.strip(), notify_org)
                if new == "REVIEWED" and sub:
                    await notifications.notify_company(
                        self.db, org_id, "admin_note", "Your manufacturer application has been approved",
                        (reason or "").strip() or "Your company access is now open. Complete your profile to become "
                                                   "visible to Visionaries.",
                        admin.user_id)
                if new in ("NEEDS_CORRECTION", "REVIEWED"):
                    review_email = (new, (reason or "").strip() + fix_text, org_id if new == "REVIEWED" else notify_org)
                changed = True
        if not changed:
            raise HTTPException(422, "Nothing to change.")
        await self._run(self._commit())
        email = await self._review_email(review_email[2], *review_email[:2]) if review_email else None
        detail = await self.detail(org_id)
        if email:
            detail["email"] = email
        return detail

    # ------------------------------------------------------------------ update requests
    async def _update_request_call(self, coro):
        try:
            return await coro
        except update_requests.RequestError as exc:
            await self.db.rollback()
            raise HTTPException(exc.status, str(exc)) from exc

    async def edit_update_request(self, admin: AdminContext, org_id: str, request_id: str,
                                  values: dict | None, notes: str | None) -> dict:
        await self._update_request_call(
            update_requests.edit(self.db, org_id, request_id, admin.user_id, values, notes))
        await self.db.commit()
        return await self.detail(org_id)

    async def decide_update_request(self, admin: AdminContext, org_id: str, request_id: str, body: dict) -> dict:
        result = await self._update_request_call(update_requests.decide(
            self.db, org_id, request_id, admin.user_id, body["decision"], body.get("fields"),
            body.get("feedback"), body.get("fingerprint"), body.get("correction_fields")))
        sub, status = result["submission"], result["status"]
        requester = await self.repo.row(
            "SELECT first_name, last_name, email::text AS email FROM users WHERE id = :u",
            {"u": sub["submitted_by_user_id"]}) or {}
        who = " ".join(x for x in (requester.get("first_name"), requester.get("last_name")) if x) \
            or requester.get("email") or "another user"
        reason = f"Approved update request from {who}" + (f": {result['feedback']}" if result["feedback"] else "")
        for key, change in result["applied"].items():
            await self.repo.add_history(org_id, update_requests.LABELS[key], change["from"], change["to"],
                                        admin.user_id, reason)
        company = (await update_requests.current_values(self.db, org_id))["companyName"]
        # The requester hears about it in their own dashboard (their workspace), never the company's.
        workspace = str(sub["organization_id"])
        rejected_email = None
        if status == "approved":
            # Approved: the requester is now a member of the company; the message is shown there,
            # to them only (the company's other members are not notified).
            fields = ", ".join(update_requests.LABELS[k] for k in result["applied"])
            await notifications.notify_user(
                self.db, sub["submitted_by_user_id"], org_id, "admin_note",
                f"Your manufacturer application for {company} has been approved",
                (f"Updated: {fields}. " if fields else "") + "You are now a member of this company."
                + (f"\n{result['feedback']}" if result["feedback"] else ""), admin.user_id)
        elif status == "changes_requested":
            fix = sub.get("correction_fields") or body.get("correction_fields") or []
            fix_text = ("\nFields to correct: " + ", ".join(access.CORRECTABLE.get(k, k) for k in fix)) if fix else ""
            await notifications.notify_company(
                self.db, workspace, "needs_correction", f"Your manufacturer application for {company} needs corrections",
                (result["feedback"] or "") + fix_text, admin.user_id)
        else:
            again = access.fmt_time(datetime.now(timezone.utc) + timedelta(
                hours=self.settings.manufacturer_reapply_after_hours))
            await notifications.notify_company(
                self.db, workspace, "admin_note", f"Your manufacturer application for {company} was not approved",
                f"{result['feedback'] or ''}\nYou can apply again from {again}.", admin.user_id)
            rejected_email = (requester, company, result["feedback"] or "", again)
        await self.db.commit()
        if rejected_email and requester.get("email"):
            name, company_name, note, again = rejected_email
            subject, text_body, html = tpl.application_rejected(
                name.get("first_name") or "", company_name, note, again,
                f"{self.settings.app_base_url.rstrip('/')}/manufacturer/dashboard")
            await self.mailer.send(requester["email"], "application_rejected", subject, text_body, html,
                                   user_id=sub["submitted_by_user_id"], organization_id=workspace)
        return await self.detail(org_id)

    async def _review_email(self, org_id: str, status: str, note: str) -> dict | None:
        """Tell the manufacturer (the account owner) about the review decision."""
        owner = next((u for u in await self.repo.linked_users(org_id) if u.get("email")), None)
        if not owner:
            return None
        row = await self.repo.overview_row(org_id)
        company = (row or {}).get("company_name") or ""
        name = owner.get("first_name") or ""
        url = f"{self.settings.app_base_url.rstrip('/')}/manufacturer/dashboard"
        if status == "NEEDS_CORRECTION":
            subject, text_body, html = tpl.needs_correction(name, company, note, url)
            template = "review_needs_correction"
        elif status == "REJECTED":
            again = access.fmt_time(datetime.now(timezone.utc) + timedelta(
                hours=self.settings.manufacturer_reapply_after_hours))
            subject, text_body, html = tpl.application_rejected(name, company, note, again, url)
            template = "application_rejected"
        else:
            subject, text_body, html = tpl.reviewed(name, company, url)
            template = "review_reviewed"
        result = await self.mailer.send(owner["email"], template, subject, text_body, html,
                                        user_id=owner["id"], organization_id=org_id)
        return {**result, "to": owner["email"], "template": template}

    async def _commit(self):
        await self.db.commit()

    async def archive(self, admin: AdminContext, org_ids: list[str], archived: bool, reason: str | None,
                      demo_test_only: bool = False) -> dict:
        skipped = []
        if demo_test_only:
            types = await self.repo.record_types(org_ids)
            skipped = [i for i in org_ids if types.get(i) == "REAL"]
            org_ids = [i for i in org_ids if types.get(i) in ("DEMO", "TEST")]
        done = await self.repo.set_archived(org_ids, archived) if org_ids else []
        for org_id in done:
            await self.repo.add_history(org_id, "Archive status", "Active" if archived else "Archived",
                                        "Archived" if archived else "Active", admin.user_id, reason)
        await self.db.commit()
        return {"changed": done, "skippedReal": skipped}

    async def add_note(self, admin: AdminContext, org_id: str, note: str, share: bool = False) -> dict:
        await self._ctx(org_id)
        await self.repo.add_note(org_id, admin.user_id, note, shared=share)
        if share:
            await notifications.notify_company(self.db, org_id, "admin_note", "Message from the XfactorY team",
                                               note.strip(), admin.user_id)
        await self.db.commit()
        return {"notes": [{**n, "id": str(n["id"])} for n in await self.repo.notes(org_id)]}

    # ------------------------------------------------------------------ XY-ADMIN-03
    @staticmethod
    def _user_row(u: dict) -> dict:
        name = " ".join(x for x in (u.get("first_name"), u.get("last_name")) if x) or u.get("display_name")
        return {"id": str(u["id"]), "name": name, "email": u["email"], "phone": u.get("phone"),
                "userType": "Admin" if u["is_admin"] else ("Manufacturer" if "manufacturer" in u["roles"]
                                                           else ("Registered user" if not u["roles"] else "Other role")),
                "roles": list(u["roles"]), "isAdmin": u["is_admin"],
                "manufacturerId": str(u["organization_id"]) if u.get("organization_id") else None,
                "companyName": u.get("company_name"), "completeness": u.get("completeness"),
                "recordType": u.get("record_type"),
                # the person's own Real / Demo / Test mark (e.g. a demo Visionary), separate from the company's
                "userRecordType": u.get("user_record_type") or "REAL",
                # every linked manufacturer company with its own onboarding source (None = unknown);
                # an empty list = not applicable. Approval status is a separate field.
                # how the person registered (channel) and with which method - not a company source
                "registrationChannel": u.get("registration_channel"),
                "registrationMethod": u.get("registration_method"),
                "companies": [{"id": str(c["id"]), "name": c["name"], "onboardingSource": c["source"],
                               "sourceNote": c.get("sourceNote") if not c["source"] else None,
                               "stagedSource": c.get("stagedSource") if not c["source"] else None,
                               "reviewStatus": c["reviewStatus"], "recordType": c.get("recordType"),
                               "membershipRole": c["membershipRole"],
                               "isArchived": c["isArchived"]}
                              for c in (json.loads(u["companies"]) if isinstance(u.get("companies"), str)
                                        else (u.get("companies") or []))],
                "registeredAt": u["created_at"], "lastActivity": u.get("last_seen_at"),
                "accountStatus": u["account_status"], "onboardingStatus": u["onboarding_status"],
                "staffOnly": str(u["clerk_user_id"]).startswith(accounts.LOCAL_CLERK_PREFIX),
                "adminLogin": u.get("password_account_status")}

    async def users(self, filters: dict, page: int, page_size: int) -> dict:
        data = await self._run(self.repo.users(filters, page, page_size))
        return {"total": data["total"], "page": page, "pageSize": page_size,
                "dataCounts": data["data_counts"], "rows": [self._user_row(u) for u in data["rows"]]}

    # ------------------------------------------------------------------ Visionaries (read-only)
    @staticmethod
    def _visionary_row(v: dict) -> dict:
        account_name = " ".join(x for x in (v.get("first_name"), v.get("last_name")) if x) or v.get("display_name")
        return {"id": str(v["id"]), "name": v.get("full_name") or account_name, "accountName": account_name,
                "email": v["email"], "phone": v.get("phone"), "accountStatus": v["account_status"],
                "registeredAt": v["created_at"], "lastActivity": v.get("last_seen_at"),
                "profileSaved": v.get("full_name") is not None,
                "roleTitle": v.get("role_title"), "organizationName": v.get("organization_name"),
                "location": v.get("location"), "projectCount": int(v.get("project_count") or 0),
                "requestCount": int(v.get("request_count") or 0), "lastSavedAt": v.get("last_saved_at"),
                "recordType": v.get("record_type") or "REAL"}

    async def visionaries(self, filters: dict, page: int, page_size: int) -> dict:
        data = await self._run(self.repo.visionaries(filters, page, page_size))
        return {"total": data["total"], "page": page, "pageSize": page_size, "dataCounts": data["data_counts"],
                "rows": [self._visionary_row(v) for v in data["rows"]]}

    async def set_visionary_record_type(self, admin: AdminContext, user_id: str, record_type: str,
                                        reason: str | None) -> dict:
        """Mark a Visionary as real / demo / test data. Recorded in the person's activity log."""
        if not await self._run(self.repo.visionary(user_id)):
            raise HTTPException(404, "Visionary not found")
        await self.repo.set_user_record_type(user_id, record_type, admin.user_id, reason)
        await self.db.commit()
        return await self.visionary_detail(user_id)

    async def visionary_detail(self, user_id: str) -> dict:
        v = await self._run(self.repo.visionary(user_id))
        if not v:
            raise HTTPException(404, "Visionary not found")
        projects = await self.repo.visionary_projects(user_id)
        requests = await self.repo.visionary_requests(user_id)

        def num(x):
            return float(x) if x is not None else None

        return {
            "visionary": self._visionary_row(v),
            "profile": ({"fullName": v["full_name"], "roleTitle": v["role_title"],
                         "organizationName": v.get("organization_name"), "location": v["location"],
                         "introduction": v.get("introduction"), "createdAt": v.get("profile_created_at"),
                         "updatedAt": v.get("profile_updated_at")} if v.get("full_name") is not None else None),
            "projects": [{"id": str(p["id"]), "name": p["project_name"], "idea": p.get("idea_description"),
                          "status": p["opportunity_status"], "product": p.get("product"), "industry": p.get("industry"),
                          "stage": p.get("project_stage"), "location": p.get("manufacturing_location"),
                          "quantity": p.get("quantity"), "quantityUnit": p.get("quantity_unit"),
                          "budget": num(p.get("budget_amount")), "currency": p.get("budget_currency"),
                          "timeline": p.get("timeline"), "additionalRequirements": p.get("additional_requirements"),
                          "requestCount": int(p.get("request_count") or 0),
                          "createdAt": p["created_at"], "updatedAt": p["updated_at"]} for p in projects],
            "requests": [{"id": str(r["id"]), "number": r["request_number"], "status": r["status"],
                          "manufacturerId": str(r["manufacturer_organization_id"]),
                          "manufacturerName": r["manufacturer_name"], "projectId": str(r["project_id"]),
                          "projectName": r["project_name"], "machine": r["machine_name"],
                          "quantity": num(r.get("requested_capacity")), "unit": r.get("unit_code"),
                          "duration": r["required_duration"], "location": r["manufacturing_location"],
                          "budget": num(r["budget_amount"]), "currency": r["budget_currency"],
                          "timeline": r["timeline"], "additionalRequirements": r.get("additional_requirements"),
                          "createdAt": r["created_at"], "respondedAt": r.get("responded_at")} for r in requests],
            "draftCount": await self.repo.visionary_draft_count(user_id),
        }

    async def machinery(self, filters: dict, page: int, page_size: int) -> dict:
        data = await self._run(self.repo.machinery(filters, page, page_size))

        def availability(r: dict) -> str | None:
            plan = r.get("plan") or {}
            plan = json.loads(plan) if isinstance(plan, str) else plan
            hours = r.get("hours") or {}
            hours = json.loads(hours) if isinstance(hours, str) else hours
            name = (r.get("name") or "").strip().lower()
            if plan and str(plan.get("machine") or "").strip().lower() == name and (plan.get("start") or plan.get("end")):
                count = plan.get("count")
                return f"{count + ' × ' if count else ''}{plan.get('start') or '?'} to {plan.get('end') or '?'}"
            if hours and hours.get("days"):
                return f"{', '.join(hours['days'])} · {hours.get('start') or '?'}–{hours.get('end') or '?'} (company hours)"
            return None

        rows = [{"id": str(r["id"]), "name": r["name"], "industry": r.get("industry"), "capacity": r.get("capacity"),
                 "maker": r.get("maker"), "model": r.get("model"), "year": r.get("year"),
                 "listingStatus": r["listing_status"], "companyId": str(r["organization_id"]),
                 "companyName": r["company_name"], "recordType": r["record_type"], "imageCount": int(r["image_count"]),
                 "availability": availability(r), "createdAt": r["created_at"]} for r in data["rows"]]
        return {"total": data["total"], "page": page, "pageSize": page_size, "rows": rows, "company": data["company"]}

    async def user_detail(self, user_id: str) -> dict:
        u = await self.repo.user(user_id)
        if not u:
            raise HTTPException(404, "User not found")
        manufacturers = await self.repo.user_manufacturers(user_id)
        trouble = await self.repo.troubleshooting(user_id)
        last_section = None
        if u.get("organization_id"):
            row = await self.repo.overview_row(str(u["organization_id"]))
            if row:
                st = sections_status(row)
                last_section = {"lastCompleted": st["lastCompletedSection"], "stoppedAt": st["stoppedAt"],
                                "missingFields": st["missingFields"]}
        login = {"lastSignInAt": None, "available": False}
        if not str(u["clerk_user_id"]).startswith(accounts.LOCAL_CLERK_PREFIX):
            try:
                info = await self.clerk.login_info(u["clerk_user_id"])
                ms = info.get("last_sign_in_at")
                login = {"lastSignInAt": datetime.fromtimestamp(ms / 1000, tz=timezone.utc) if ms else None,
                         "available": True}
            except Exception as exc:  # noqa: BLE001 - Clerk is optional for this panel
                log.info("Clerk login info unavailable: %s", exc)
        pw_login = u.get("password_last_login")
        if pw_login and (not login["lastSignInAt"] or pw_login > login["lastSignInAt"]):
            login = {"lastSignInAt": pw_login, "available": True}
        elif u.get("password_account_status") and not login["available"]:
            login = {"lastSignInAt": None, "available": True}
        a = trouble["activity"] or {}
        saves = [x for x in (a.get("last_step_save"), a.get("last_profile_save")) if x]
        emails = [{**e, "id": str(e["id"])} for e in await self.repo.user_emails(user_id)]
        return {
            "user": self._user_row(u),
            "manufacturers": [{**m, "organization_id": str(m["organization_id"]),
                               "machinery_count": int(m.get("machinery_count") or 0),
                               "onboarding_source_label": sources.label(m.get("onboarding_source")),
                               "staged_source": _json_obj(m.get("staged_source")) if not m.get("onboarding_source")
                               else None}
                              for m in manufacturers],
            "troubleshooting": {
                "accountStatus": u["account_status"], "lastLogin": login, "lastActivity": u.get("last_seen_at"),
                "lastSuccessfulSave": max(saves) if saves else None,
                "profileWizardStep": a.get("profile_wizard_step"), "onboarding": last_section,
                "events": trouble["events"],
                "notificationStatus": self._email_summary(emails),
                "emails": emails,
            },
        }

    def _email_summary(self, emails: list[dict]) -> str:
        if not emails:
            return "No emails sent yet" if self.mailer.enabled else "Email is off (SMTP not configured)"
        last = emails[0]
        return f"Last email {last['status']}: {last['subject']}"

    async def set_account_status(self, admin: AdminContext, user_id: str, suspend: bool, reason: str) -> dict:
        u = await self.repo.user(user_id)
        if not u:
            raise HTTPException(404, "User not found")
        if str(u["id"]) == str(admin.user_id):
            raise HTTPException(422, "You cannot suspend your own account.")
        target = "suspended" if suspend else "active"
        if u["account_status"] == "deactivated":
            raise HTTPException(422, "This account was deleted in Clerk and cannot be changed here.")
        if u["account_status"] == target:
            raise HTTPException(422, f"The account is already {'suspended' if suspend else 'active'}.")
        await self.repo.set_user_status(user_id, target, admin.user_id, reason)
        if suspend:
            await accounts.revoke_user_sessions(self.db, user_id)
        await self.db.commit()
        clerk_synced = True
        if not str(u["clerk_user_id"]).startswith(accounts.LOCAL_CLERK_PREFIX):
            try:
                await self.clerk.set_banned(u["clerk_user_id"], suspend)
            except Exception as exc:  # noqa: BLE001 - the database status already blocks API access
                clerk_synced = False
                log.warning("Account status saved, but Clerk was not updated: %s", exc)
        name = u.get("first_name") or ""
        if suspend:
            subject, text_body, html = tpl.account_suspended(name)
        else:
            subject, text_body, html = tpl.account_reactivated(name, f"{self.settings.app_base_url.rstrip('/')}/sign-in")
        email = await self.mailer.send(u["email"], "account_suspended" if suspend else "account_reactivated",
                                       subject, text_body, html, user_id=u["id"])
        detail = await self.user_detail(user_id)
        detail["clerkSynced"] = clerk_synced
        detail["email"] = {**email, "to": u["email"]}
        return detail

    async def send_test_email(self, admin: AdminContext, to: str | None) -> dict:
        to = (to or admin.email).strip()
        subject, text_body, html = tpl.test_email(admin.name)
        result = await self.mailer.send(to, "test", subject, text_body, html, user_id=None)
        return {**result, "to": to, "smtpConfigured": self.mailer.enabled}

    async def recent_errors(self) -> list[dict]:
        return [{**e, "user_id": str(e["user_id"]) if e["user_id"] else None} for e in await self.repo.recent_errors()]

    # ------------------------------------------------------------------ XY-ADMIN-09
    async def analytics(self, date_from: date | None, date_to: date | None, include_test: bool) -> dict:
        data = await self._run(self.repo.analytics(date_from, date_to, include_test))
        t = data["totals"]
        drop = {s: 0 for s in SECTIONS}
        for row in data["incomplete"]:
            stopped = sections_status(row)["stoppedAt"]
            if stopped:
                drop[stopped] += 1
        missing = sorted(({"label": label, "section": sec, "count": data["missing"][c]}
                          for c, label, sec in REQUIRED_FIELDS), key=lambda m: -m["count"])
        return {
            "range": {"from": date_from, "to": date_to, "includeTest": include_test},
            "registrations": {"users": t["users"], "manufacturers": t["manufacturers"],
                              "usersWithoutProfile": t["users_without_profile"]},
            "onboarding": {"completed": t["completed"], "incomplete": t["incomplete"],
                           "completionRate": round(t["completed"] * 100 / t["manufacturers"]) if t["manufacturers"] else 0},
            "dropOff": [{"label": "Registered, no manufacturer profile", "count": t["users_without_profile"]}]
                       + [{"label": s, "count": n} for s, n in drop.items()],
            "byIndustry": data["by"]["industry"], "byLocation": data["by"]["location"],
            "byProcess": data["by"]["process"], "byReferral": data["by"]["referral"],
            "byReviewStatus": data["by"]["reviewStatus"],
            "entrySources": data["entry"], "missingFields": missing, "excludedDemoTest": data["excluded"],
        }
