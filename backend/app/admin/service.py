import logging
import re
from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.core.clerk import ClerkManagement
from app.core.email import Mailer
from app.core.config import Settings
from app.repositories.manufacturer import ManufacturerRepository, profile_flags
from app.schemas.manufacturer import MachineryPatch, ProfilePatchPayload
from app.services.manufacturer import ManufacturerService

log = logging.getLogger("xy.admin")

DB_TO_REVIEW = {"draft": "NOT_STARTED", "in_progress": "IN_PROGRESS", "submitted": "SUBMITTED",
                "under_review": "SUBMITTED", "changes_requested": "NEEDS_CORRECTION",
                "rejected": "NEEDS_CORRECTION", "approved": "REVIEWED"}

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
REVIEW_LABELS = {"NOT_STARTED": "Not started", "IN_PROGRESS": "In progress", "SUBMITTED": "Submitted",
                 "NEEDS_CORRECTION": "Needs correction", "REVIEWED": "Reviewed"}


def list_row(r: dict) -> dict:
    contact = " ".join(x for x in (r.get("first_name"), r.get("last_name")) if x) or None
    location = ", ".join(x for x in (r.get("city"), r.get("country")) if x) or None
    return {
        "id": str(r["organization_id"]), "companyName": r["company_name"], "contactName": contact,
        "contactEmail": r.get("contact_email") or r.get("user_email"),
        "contactPhone": r.get("contact_phone") or r.get("user_phone"),
        "industry": r.get("industry"), "country": r.get("country"), "city": r.get("city"), "location": location,
        "majorProcess": r.get("major_process"), "listingCount": r.get("listing_count", 0),
        "completeness": r["completeness"], "requiredDone": r["required_done"], "requiredTotal": r["required_total"],
        "reviewStatus": r["review_status"], "recordType": r["record_type"], "entrySource": r["entry_source"],
        "referralSource": r.get("referral_source"),
        "assignedAdminId": str(r["assigned_admin_user_id"]) if r.get("assigned_admin_user_id") else None,
        "isArchived": r["is_archived"], "archivedAt": r.get("archived_at"),
        "registeredAt": r["registered_at"], "lastUpdated": r.get("last_updated") or r["registered_at"],
        "lastSeenAt": r.get("last_seen_at"), "ownerUserId": str(r["user_id"]) if r.get("user_id") else None,
        "attentionReason": r.get("attention_reason"),
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
    async def detail(self, org_id: str) -> dict:
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
            decision = {"approved": "Reviewed by X!Y", "changes_requested": "Corrections requested by X!Y",
                        "rejected": "Corrections requested by X!Y"}.get(row.get("onboarding_raw_status") or "")
            if decision:
                timeline.append({"at": row["reviewed_at"], "event": decision})
        if row.get("last_updated"):
            timeline.append({"at": row["last_updated"], "event": "Last profile update"})
        return {
            "manufacturer": summary,
            "profile": {"profileData": view["profileData"], "state": view["state"],
                        "profileProgress": view["profileProgress"], "machineryDraft": view["machineryDraft"]},
            "contacts": {"email": p.get("contact_email") or "", "phone": p.get("contact_phone") or ""},
            "linkedUsers": [{**u, "id": str(u["id"])} for u in await self.repo.linked_users(org_id)],
            "notes": [{**n, "id": str(n["id"])} for n in await self.repo.notes(org_id)],
            "history": [{**h, "id": str(h["id"])} for h in await self.repo.history(org_id)],
            "timeline": sorted(timeline, key=lambda t: t["at"], reverse=True),
            "admins": await self.admins(),
            "requiredFields": [{"key": c, "label": label, "section": sec, "done": bool(row.get(c))}
                               for c, label, sec in REQUIRED_FIELDS],
            "sectionsOrder": SECTIONS,
            "editable": {"profile": PROFILE_FIELDS, "account": ACCOUNT_FIELDS, "machinery": MACHINE_FIELDS,
                         "required": sorted(REQUIRED_KEYS)},
        }

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
                "The X!Y team updated a machinery listing" if kind == "machinery" else "The X!Y team updated your profile",
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
                raise HTTPException(422, "Only X!Y admins can be assigned.")
            old_admin = str(meta["assigned_admin_user_id"]) if meta["assigned_admin_user_id"] else None
            if new_admin != old_admin:
                await self.repo.set_org_field(org_id, "assigned_admin_user_id", new_admin)
                await self.repo.add_history(org_id, "Assigned admin", names.get(old_admin or "", "Unassigned"),
                                            names.get(new_admin or "", "Unassigned"), admin.user_id, reason)
                changed = True
        review_email = None
        if body.get("review_status"):
            old = DB_TO_REVIEW.get(meta["onboarding_raw_status"] or "draft", "NOT_STARTED")
            new = body["review_status"]
            if new != old:
                if new == "NEEDS_CORRECTION" and not (reason or "").strip():
                    raise HTTPException(422, "Add a short note explaining what needs correcting.")
                await self.repo.set_review_status(org_id, new, admin.user_id, reason)
                await self.repo.add_history(org_id, "Review status", REVIEW_LABELS[old], REVIEW_LABELS[new],
                                            admin.user_id, reason)
                if new == "NEEDS_CORRECTION" and (reason or "").strip():
                    # The correction note is always shown to the manufacturer.
                    await self.repo.add_note(org_id, admin.user_id, f"Correction requested: {reason.strip()}",
                                             shared=True)
                    await notifications.notify_company(
                        self.db, org_id, "needs_correction", "Your profile needs a few corrections",
                        reason.strip(), admin.user_id)
                if new in ("NEEDS_CORRECTION", "REVIEWED"):
                    review_email = (new, (reason or "").strip())
                changed = True
        if not changed:
            raise HTTPException(422, "Nothing to change.")
        await self._run(self._commit())
        email = await self._review_email(org_id, *review_email) if review_email else None
        detail = await self.detail(org_id)
        if email:
            detail["email"] = email
        return detail

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
            await notifications.notify_company(self.db, org_id, "admin_note", "Message from the X!Y team",
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
                "registeredAt": u["created_at"], "lastActivity": u.get("last_seen_at"),
                "accountStatus": u["account_status"], "onboardingStatus": u["onboarding_status"],
                "staffOnly": str(u["clerk_user_id"]).startswith(accounts.LOCAL_CLERK_PREFIX),
                "adminLogin": u.get("password_account_status")}

    async def users(self, filters: dict, page: int, page_size: int) -> dict:
        data = await self._run(self.repo.users(filters, page, page_size))
        return {"total": data["total"], "page": page, "pageSize": page_size,
                "rows": [self._user_row(u) for u in data["rows"]]}

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
            "manufacturers": [{**m, "organization_id": str(m["organization_id"])} for m in manufacturers],
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
