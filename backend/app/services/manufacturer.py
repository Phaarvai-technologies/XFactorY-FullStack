import json
import logging

from fastapi import HTTPException
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Actor
from app.core.clerk import ClerkManagement
from app.core.config import Settings
from app.core.schema_check import MIGRATION_HINT
from app.repositories.manufacturer import ManufacturerRepository, profile_flags
from app.storage.supabase import SupabaseStorage, decode_data_url


log = logging.getLogger("xy.manufacturer")

# Postgres: undefined column / table / function -> migrations not applied.
SCHEMA_ERROR_CODES = {"42703", "42P01", "42883"}

# Specs stored as JSON because the frontend holds them as list / object.
JSON_SPECS = {"logistics", "pricing"}
EMPTY_PRICING = {"hour": "", "day": "", "month": "", "unit": "", "batch": ""}
EMPTY_INFRA = {"electricity": "", "water": "", "storage": "", "packaging": "", "waste": "", "qa": ""}


def _status(machine: dict) -> str:
    if machine["status"] == "archived":
        return "Archived"
    return {"published": "Published", "hidden": "Unpublished", "draft": "Draft"}.get(
        machine["publication_status"], "Draft")


def _booking_status(value: str) -> str:
    if value in {"confirmed", "booked"}:
        return "Booked"
    if value in {"accepted", "confirmation_pending"}:
        return "Reserved"
    if value in {"declined", "cancelled"}:
        return "Cancelled"
    return "New"


def _cert_status(value: str) -> str:
    if value == "verified":
        return "Verified"
    if value in {"expired", "suspended"}:
        return "Rejected"
    return "Pending"


def _first_incomplete(completed: list[int], total: int) -> int | None:
    return next((n for n in range(1, total + 1) if n not in completed), None)


def _legacy_steps(flags: dict) -> list[int]:
    steps = set()
    if any(flags.values()): steps.add(1)
    if flags["company"]: steps.add(2)
    if flags["location"]: steps.add(3)
    if flags["certs"]: steps.add(4)
    if flags["infra"] and flags["faq"]: steps.add(5)
    return sorted(steps)


def _decode_spec(code: str, value):
    """machine_specs.value_text -> the frontend value (strings stay strings)."""
    if value is None:
        return "" if code not in JSON_SPECS else None
    if code in JSON_SPECS:
        try:
            return json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return None
    return value


class ManufacturerService:
    def __init__(self, session: AsyncSession, settings: Settings):
        self.repo = ManufacturerRepository(session)
        self.settings = settings
        self.storage = SupabaseStorage(settings)
        self.clerk = ClerkManagement(settings)

    # ---------------------------------------------------------------- helpers
    async def _run(self, coro):
        try:
            return await coro
        except HTTPException:
            raise
        except LookupError as exc:
            raise HTTPException(404 if "not found" in str(exc) else 409, str(exc)) from exc
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc
        except IntegrityError as exc:
            await self.repo.db.rollback()
            log.warning("Integrity error: %s", exc.orig)
            raise HTTPException(409, "The data conflicts with existing records") from exc
        except DBAPIError as exc:
            await self.repo.db.rollback()
            code = getattr(exc.orig, "pgcode", None) or ""
            detail = str(getattr(exc.orig, "args", [exc])[0]).split(">: ", 1)[-1]
            if code in SCHEMA_ERROR_CODES:
                log.error("Database schema is out of date: %s. %s", detail, MIGRATION_HINT)
                raise HTTPException(500, f"Database schema is out of date ({detail}). {MIGRATION_HINT}") from exc
            if code.startswith("22") or code == "23514":  # bad value / check constraint
                raise HTTPException(422, f"Invalid value: {detail}") from exc
            log.exception("Database error")
            raise HTTPException(500, f"Database error: {detail}") from exc

    async def ensure_actor(self, actor: Actor) -> dict:
        """Returns the DB context; creates the rows on first use (webhook may be late)."""
        try:
            return await self._run(self.repo.context(actor))
        except HTTPException as exc:
            if exc.status_code != 409:
                raise
        profile = await self.clerk.actor_profile(actor)
        await self._run(self.repo.sync_actor(actor, profile))
        return await self._run(self.repo.context(actor))

    async def _image_file(self, ctx: dict, data_url: str, purpose: str, folder: str):
        image = decode_data_url(data_url)
        if image is None:
            return None
        existing = await self.repo.find_file(ctx, image, purpose)
        if existing:
            return existing
        uploaded = await self.storage.upload(image, f'{ctx["organization_id"]}/{folder}')
        return await self.repo.add_file(ctx, uploaded, purpose)

    # ---------------------------------------------------------------- read model
    async def bootstrap(self, actor: Actor) -> dict:
        """Everything ManufacturerApp needs: `state` (ManufacturerState) and `profileData`."""
        await self.ensure_actor(actor)
        raw = await self._run(self.repo.snapshot(actor))
        p, ctx = raw["profile"], raw["context"]
        asset = self.storage.public_url

        certs = [{"name": x["name"], "body": x.get("body") or "", "fileName": x.get("document_file_name") or "",
                  "status": _cert_status(x["status"])} for x in raw["certifications"]]
        infra = {**EMPTY_INFRA, **{k: v for k, v in raw["infrastructure"].items() if k in EMPTY_INFRA}}
        faqs = [{"q": x["q"], "a": x["a"] or ""} for x in raw["faqs"]]

        images_by_machine: dict[str, list] = {}
        for image in raw["images"]:
            images_by_machine.setdefault(str(image["machine_id"]), []).append(
                {"src": asset(image["object_key"]), "primary": image["display_order"] == 0})

        progress_rows = raw["progress"]
        open_drafts = {str(r["record_id"]): r for r in progress_rows
                       if r["form_key"] == "machinery" and r["status"] == "draft"}
        machinery, machinery_draft = [], None
        for row in raw["machines"]:
            specs = {key: _decode_spec(key, value) for key, value in dict(row["specs"]).items()}
            view = ({
                "id": str(row["id"]),
                "industry": specs.get("industry", ""), "subcategory": specs.get("subcategory", ""),
                "type": row["name"], "capacity": specs.get("capacity", ""), "age": specs.get("age", ""),
                "condition": specs.get("condition", ""), "technical": row["description"] or "",
                "images": images_by_machine.get(str(row["id"]), []),
                "rawMatStatus": specs.get("rawMatStatus", ""), "materialDetails": specs.get("materialDetails", ""),
                "laborType": specs.get("laborType", ""), "workerCount": specs.get("workerCount", ""),
                "workerRoles": specs.get("workerRoles", ""), "logistics": specs.get("logistics") or [],
                "logisticsPartner": specs.get("logisticsPartner", ""),
                "pricing": {**EMPTY_PRICING, **(specs.get("pricing") or {})},
                "insurance": specs.get("insurance", ""), "status": _status(row),
            })
            draft_progress = open_drafts.get(str(row["id"]))
            if draft_progress is None:
                machinery.append(view)                  # a finished listing
            elif machinery_draft is None or draft_progress["updated_at"] > machinery_draft["_updated"]:
                # unfinished wizard: not a listing yet; offered for "continue where you left off"
                completed = sorted(draft_progress["completed_steps"])
                machinery_draft = {
                    "id": str(row["id"]), "data": {k: v for k, v in view.items() if k not in ("id", "status")},
                    "currentStep": draft_progress["current_step"], "completedSteps": completed,
                    "resumeStep": _first_incomplete(completed, draft_progress["total_steps"]) or draft_progress["total_steps"],
                    "_updated": draft_progress["updated_at"],
                }
        if machinery_draft:
            machinery_draft.pop("_updated")

        bookings = [{
            "id": str(x["id"]), "buyer": x["buyer"], "item": x["item"],
            "date": x["requested_start_date"].strftime("%b %d, %Y").replace(" 0", " ")
            if x["requested_start_date"] else "Date not set",
            "status": _booking_status(x["status"]),
        } for x in raw["bookings"]]

        country = p.get("facility_country") or ""
        capacity = p.get("production_capacity_label") or (
            f'{p["stated_production_capacity"]:g}' if p.get("stated_production_capacity") is not None else "")
        profile_data = {
            "company": {
                "name": p.get("display_name") or "", "logo": asset(p.get("logo_object_key")),
                "cover": asset(p.get("cover_object_key")), "about": p.get("about_company") or "",
                "vision": p.get("vision") or "", "estYear": str(p.get("establishment_year") or ""),
                "employees": "" if p.get("employee_count") is None else str(p["employee_count"]),
                "businessType": p.get("business_type") or "", "orgSize": p.get("organization_size") or "",
            },
            "location": {
                "address": p.get("address_line1") or "", "city": p.get("city") or "",
                "state": p.get("state_province") or "", "country": country, "zip": p.get("postal_code") or "",
                "pin": p.get("map_pin"), "sez": p.get("sez_status") or "Not in SEZ",
                "serviceableAreas": list(p.get("serviceable_areas") or []),
            },
            "certifications": certs, "infra": infra, "faqs": faqs,
        }
        contact_email = p.get("contact_email") or ""
        availability = raw["availability"]
        state = {
            "account": {
                "firstName": ctx.get("first_name") or "", "lastName": ctx.get("last_name") or "",
                "companyName": p.get("display_name") or "", "companyType": p.get("company_category") or "",
                "country": p.get("account_country") or "", "dob": str(ctx.get("date_of_birth") or ""),
                "phone": ctx.get("phone") or "", "capacity": capacity,
            },
            "contact": {"email": contact_email, "phone": "" if contact_email else (p.get("contact_phone") or "")},
            "epic2": {
                "companyDetailsDone": bool(p.get("company_information_completed")),
                "locationDone": bool(p.get("location_completed")), "certifications": certs,
                "infraDone": bool(p.get("infrastructure_completed")), "faqs": faqs,
            },
            "serviceableAreas": profile_data["location"]["serviceableAreas"],
            "machinery": machinery,
            "calendar": availability.get("calendar") or {},
            "recurring": availability.get("recurring"),
            "capacity": availability.get("capacity"),
            "bookings": bookings,
        }
        # Dashboard progress, computed from what is saved (same formula the UI used).
        flags = profile_flags(profile_data)
        state["epic2"].update(companyDetailsDone=flags["company"], locationDone=flags["location"],
                              infraDone=flags["infra"])
        profile_row = next((r for r in progress_rows if r["form_key"] == "company_profile"), None)
        if profile_row:
            completed = sorted(profile_row["completed_steps"])
            status, current = profile_row["status"], profile_row["current_step"]
        else:  # accounts from before step tracking: derive from saved content
            completed = _legacy_steps(flags)
            status = "completed" if len(completed) == 5 else "draft"
            current = _first_incomplete(completed, 5) or 1
        profile_progress = {
            "status": status, "currentStep": current, "completedSteps": completed,
            "resumeStep": _first_incomplete(completed, 5) or 1,
            "percentage": round(15 + sum(flags.values()) / 5 * 85),
            "checklist": {"companyDetailsDone": flags["company"], "locationDone": flags["location"],
                          "certsDone": flags["certs"], "infraDone": flags["infra"], "faqDone": flags["faq"]},
        }
        return {"accountExists": bool(p.get("personal_information_completed")),
                "state": state, "profileData": profile_data,
                "profileProgress": profile_progress, "machineryDraft": machinery_draft}

    # ---------------------------------------------------------------- mutations
    async def create_account(self, actor: Actor, data: dict) -> dict:
        await self.ensure_actor(actor)
        await self._run(self.repo.create_account(actor, data))
        return await self.bootstrap(actor)

    async def update_profile(self, actor: Actor, changes: dict, progress: dict | None = None) -> dict:
        """PATCH /manufacturer/profile: apply only the changed fields, then return
        the record freshly read back from the database."""
        ctx = await self.ensure_actor(actor)
        company = changes.get("company") or {}
        assets: dict = {}
        for key in ("logo", "cover"):
            if key not in company:
                continue                      # image not touched
            value = company[key] or ""
            if not value:
                assets[key] = None            # user removed the image
            elif value.startswith("data:"):   # new image -> upload (deduplicated)
                assets[key] = await self._run(self._image_file(ctx, value, f"company_{key}", "profile"))
            # an existing https URL means "keep the current image": nothing to write
        await self._run(self._save_profile_step(actor, ctx, changes, assets, progress))
        snapshot = await self.bootstrap(actor)
        await self._run(self.repo.set_onboarding_flags(actor, profile_flags(snapshot["profileData"])))
        return snapshot

    async def _save_profile_step(self, actor, ctx, changes, assets, progress) -> None:
        """Data + step progress in ONE transaction: if the step fails validation,
        nothing from this request is saved and the wizard stays on the step."""
        await self.repo.update_profile(actor, changes, assets, commit=False)
        if progress:
            if progress.get("completed"):
                errors = await self.repo.profile_step_errors(ctx, progress["step"])
                if errors:
                    await self.repo.db.rollback()
                    raise ValueError(" ".join(errors))
            await self.repo.save_progress(ctx, "company_profile", ctx["organization_id"],
                                          self.repo.PROFILE_STEPS, progress)
        await self.repo.db.commit()

    async def replace_profile(self, actor: Actor, data: dict) -> dict:
        """PUT (kept for older clients): the whole wizard document. A null logo/cover
        means "unchanged" here, as before."""
        for key in ("logo", "cover"):
            if not data["company"].get(key):
                data["company"].pop(key, None)
        return await self.update_profile(actor, data)

    async def create_machinery(self, actor: Actor, data: dict) -> dict:
        ctx = await self.ensure_actor(actor)
        images = []
        for item in data.get("images", []):
            file_id = await self._run(self._image_file(ctx, item.get("src", ""), "machine_image", "machines"))
            if file_id:
                images.append((file_id, bool(item.get("primary"))))
        await self._run(self.repo.create_machinery(actor, data, images))
        return await self.bootstrap(actor)

    async def _machinery_images(self, ctx: dict, images: list[dict] | None):
        """data: URL -> upload (deduplicated); our own https URL -> existing file."""
        if images is None:
            return None
        base = self.storage.public_base() + "/"
        resolved = []
        for item in images:
            src = item.get("src") or ""
            if src.startswith("data:"):
                file_id = await self._image_file(ctx, src, "machine_image", "machines")
            elif src.startswith(base):
                file_id = await self.repo.find_file_by_key(ctx, src[len(base):])
                if not file_id:
                    raise ValueError("One of the images could not be found. Please upload it again.")
            else:
                raise ValueError("Images must be PNG, JPG or WebP uploads.")
            resolved.append((file_id, bool(item.get("primary"))))
        return resolved

    async def create_machinery_draft(self, actor: Actor, client_key, changes: dict, progress: dict | None) -> dict:
        ctx = await self.ensure_actor(actor)
        images = await self._run(self._machinery_images(ctx, changes.get("images")))
        await self._run(self.repo.create_machinery_draft(actor, client_key, changes, images, progress))
        return await self.bootstrap(actor)

    async def update_machinery_draft(self, actor: Actor, machine_id: str, changes: dict,
                                     progress: dict | None, finish: str | None) -> dict:
        ctx = await self.ensure_actor(actor)
        images = await self._run(self._machinery_images(ctx, changes.get("images")))
        await self._run(self.repo.update_machinery_draft(actor, machine_id, changes, images, progress, finish))
        return await self.bootstrap(actor)

    async def patch_availability(self, actor: Actor, changes: dict) -> dict:
        await self.ensure_actor(actor)
        await self._run(self.repo.patch_availability(actor, changes))
        return await self.bootstrap(actor)

    async def set_machinery_status(self, actor: Actor, machine_id: str, status: str) -> dict:
        await self.ensure_actor(actor)
        await self._run(self.repo.set_machinery_status(actor, machine_id, status))
        return await self.bootstrap(actor)

    async def save_availability(self, actor: Actor, data: dict) -> dict:
        await self.ensure_actor(actor)
        await self._run(self.repo.save_availability(actor, data))
        return await self.bootstrap(actor)

    async def decide_booking(self, actor: Actor, booking_id: str, status: str) -> dict:
        await self.ensure_actor(actor)
        await self._run(self.repo.update_booking(actor, booking_id, status))
        return await self.bootstrap(actor)
