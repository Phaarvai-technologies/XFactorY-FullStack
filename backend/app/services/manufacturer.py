import json
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import Actor
from app.core.config import Settings
from app.core.clerk import ClerkManagement
from app.repositories.manufacturer import ManufacturerRepository
from app.storage.supabase import SupabaseStorage


def _status(machine: dict) -> str:
    if machine["status"] == "archived": return "Archived"
    return {"published": "Published", "hidden": "Unpublished", "draft": "Draft"}.get(machine["publication_status"], "Draft")


def _booking_status(value: str) -> str:
    if value in {"confirmed", "booked"}: return "Booked"
    if value in {"accepted", "confirmation_pending"}: return "Reserved"
    if value in {"declined", "cancelled"}: return "Cancelled"
    return "New"


def _decode_spec(value):
    if value is None: return ""
    try: return json.loads(value)
    except (TypeError, json.JSONDecodeError): return value


class ManufacturerService:
    def __init__(self, session: AsyncSession, settings: Settings):
        self.repo = ManufacturerRepository(session)
        self.settings = settings
        self.storage = SupabaseStorage(settings)
        self.clerk = ClerkManagement(settings)

    async def ensure_actor(self, actor: Actor):
        try:
            return await self.repo.context(actor)
        except LookupError:
            profile = await self.clerk.actor_profile(actor)
            await self.repo.sync_actor(actor, profile)
            return await self.repo.context(actor)

    async def _run(self, action):
        try: return await action
        except LookupError as exc: raise HTTPException(409, str(exc)) from exc
        except PermissionError as exc: raise HTTPException(403, str(exc)) from exc
        except ValueError as exc: raise HTTPException(422, str(exc)) from exc

    async def bootstrap(self, actor: Actor):
        await self.ensure_actor(actor)
        raw = await self._run(self.repo.snapshot(actor))
        p, ctx = raw["profile"], raw["context"]
        public = f"{self.settings.supabase_url}/storage/v1/object/public/{self.settings.supabase_storage_bucket}"
        def asset(key): return f"{public}/{key}" if key else None
        certs = [{"name": x["name"], "body": x.get("body") or "", "fileName": "",
                  "status": "Verified" if x["status"] == "verified" else "Pending"} for x in raw["certifications"]]
        infra = {"electricity": "", "water": "", "storage": "", "packaging": "", "waste": "", "qa": ""}
        infra.update(raw["infrastructure"])
        by_machine: dict[str, list] = {}
        for image in raw["images"]:
            by_machine.setdefault(str(image["machine_id"]), []).append(
                {"src": asset(image["object_key"]), "primary": image["display_order"] == 0})
        machinery = []
        for row in raw["machines"]:
            specs = {key: _decode_spec(value) for key, value in dict(row["specs"]).items()}
            machinery.append({
                "id": str(row["id"]), "industry": specs.get("industry", ""),
                "subcategory": specs.get("subcategory", ""), "type": row["name"],
                "capacity": specs.get("capacity", ""), "age": specs.get("age", ""),
                "condition": specs.get("condition", ""), "technical": row["description"] or "",
                "images": by_machine.get(str(row["id"]), []), "rawMatStatus": specs.get("rawMatStatus", ""),
                "materialDetails": specs.get("materialDetails", ""), "laborType": specs.get("laborType", ""),
                "workerCount": specs.get("workerCount", ""), "workerRoles": specs.get("workerRoles", ""),
                "logistics": specs.get("logistics", []), "logisticsPartner": specs.get("logisticsPartner", ""),
                "pricing": specs.get("pricing", {"hour":"","day":"","month":"","unit":"","batch":""}),
                "insurance": specs.get("insurance", ""), "status": _status(row),
            })
        bookings = [{"id": str(x["id"]), "buyer": x["buyer"], "item": x["item"],
                     "date": x["requested_start_date"].strftime("%b %d, %Y") if x["requested_start_date"] else "Date not set",
                     "status": _booking_status(x["status"])} for x in raw["bookings"]]
        profile_data = {
            "company": {"name": p.get("display_name") or "", "logo": asset(p.get("logo_object_key")),
                "cover": asset(p.get("cover_object_key")), "about": p.get("about_company") or "",
                "vision": p.get("vision") or "", "estYear": str(p.get("establishment_year") or ""),
                "employees": str(p.get("employee_count") or ""), "businessType": p.get("business_type") or "",
                "orgSize": p.get("organization_size") or ""},
            "location": {"address": p.get("address_line1") or "", "city": p.get("city") or "",
                "state": p.get("state_province") or "", "country": p.get("country_name") or "",
                "zip": p.get("postal_code") or "", "pin": None, "sez": p.get("sez_status") or "Not in SEZ",
                "serviceableAreas": p.get("serviceable_areas") or []},
            "certifications": certs, "infra": infra,
            "faqs": [{"q": x["q"], "a": x["a"] or ""} for x in raw["faqs"]],
        }
        availability = raw["availability"]
        state = {
            "account": {"firstName": ctx.get("first_name") or "", "lastName": ctx.get("last_name") or "",
                "companyName": p.get("display_name") or "", "companyType": p.get("company_category") or "",
                "country": p.get("country_name") or "", "dob": str(ctx.get("date_of_birth") or ""),
                "phone": ctx.get("phone") or "", "capacity": str(p.get("stated_production_capacity") or "")},
            "contact": {"email": ctx.get("email") or "", "phone": ctx.get("phone") or ""},
            "epic2": {"companyDetailsDone": bool(p.get("company_information_completed")),
                "locationDone": bool(p.get("location_completed")), "certifications": certs,
                "infraDone": bool(p.get("infrastructure_completed")), "faqs": profile_data["faqs"]},
            "serviceableAreas": profile_data["location"]["serviceableAreas"], "machinery": machinery,
            "calendar": availability.get("calendar") or {}, "recurring": availability.get("recurring"),
            "capacity": availability.get("capacity"), "bookings": bookings,
        }
        flags = {"companyDetailsDone": state["epic2"]["companyDetailsDone"],
                 "locationDone": state["epic2"]["locationDone"], "certsDone": bool(p.get("certification_completed")),
                 "infraDone": state["epic2"]["infraDone"], "faqDone": bool(p.get("faq_completed"))}
        return {"state": state, "profileData": profile_data, "flags": flags,
                "pct": p.get("completion_percentage") or 15}

    async def create_account(self, actor: Actor, data: dict):
        await self.ensure_actor(actor)
        await self._run(self.repo.create_account(actor, data)); return await self.bootstrap(actor)

    async def save_profile(self, actor: Actor, data: dict):
        ctx = await self.ensure_actor(actor); assets = {}
        for key in ("logo", "cover"):
            value = data["company"].get(key)
            if isinstance(value, str) and value.startswith("data:"):
                uploaded = await self.storage.upload_data_url(value, f'{ctx["organization_id"]}/profile')
                if uploaded: assets[key] = await self.repo.add_file(ctx, uploaded, f"company_{key}")
        await self._run(self.repo.save_profile(actor, data, assets)); return await self.bootstrap(actor)

    async def create_machinery(self, actor: Actor, data: dict):
        ctx = await self.ensure_actor(actor); images = []
        for item in data.get("images", []):
            uploaded = await self.storage.upload_data_url(item.get("src", ""), f'{ctx["organization_id"]}/machines')
            if uploaded: images.append((uploaded, bool(item.get("primary"))))
        await self._run(self.repo.create_machinery(actor, data, images)); return await self.bootstrap(actor)

    async def set_machinery_status(self, actor: Actor, machine_id: str, status: str):
        await self._run(self.repo.set_machinery_status(actor, machine_id, status)); return await self.bootstrap(actor)

    async def save_availability(self, actor: Actor, data: dict):
        await self._run(self.repo.save_availability(actor, data)); return await self.bootstrap(actor)

    async def decide_booking(self, actor: Actor, booking_id: str, status: str):
        await self._run(self.repo.update_booking(actor, booking_id, status)); return await self.bootstrap(actor)
