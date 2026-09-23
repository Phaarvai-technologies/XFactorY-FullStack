import json

from fastapi import HTTPException
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Actor
from app.core.clerk import ClerkManagement
from app.core.config import Settings
from app.repositories.manufacturer import ManufacturerRepository
from app.storage.supabase import SupabaseStorage, decode_data_url


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
            raise HTTPException(409, "The data conflicts with existing records") from exc
        except DBAPIError as exc:
            await self.repo.db.rollback()
            raise HTTPException(422, f"Invalid value: {getattr(exc.orig, 'args', [exc])[0]}") from exc

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

        machinery = []
        for row in raw["machines"]:
            specs = {key: _decode_spec(key, value) for key, value in dict(row["specs"]).items()}
            machinery.append({
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
        return {"accountExists": bool(p.get("personal_information_completed")),
                "state": state, "profileData": profile_data}

    # ---------------------------------------------------------------- mutations
    async def create_account(self, actor: Actor, data: dict) -> dict:
        await self.ensure_actor(actor)
        await self._run(self.repo.create_account(actor, data))
        return await self.bootstrap(actor)

    async def save_profile(self, actor: Actor, data: dict) -> dict:
        ctx = await self.ensure_actor(actor)
        assets = {}
        for key in ("logo", "cover"):
            file_id = await self._run(self._image_file(ctx, data["company"].get(key) or "", f"company_{key}", "profile"))
            if file_id:
                assets[key] = file_id
        await self._run(self.repo.save_profile(actor, data, assets))
        return await self.bootstrap(actor)

    async def create_machinery(self, actor: Actor, data: dict) -> dict:
        ctx = await self.ensure_actor(actor)
        images = []
        for item in data.get("images", []):
            file_id = await self._run(self._image_file(ctx, item.get("src", ""), "machine_image", "machines"))
            if file_id:
                images.append((file_id, bool(item.get("primary"))))
        await self._run(self.repo.create_machinery(actor, data, images))
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
