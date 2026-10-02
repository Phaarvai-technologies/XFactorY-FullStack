"""Visionaries portal: business rules and the JSON shapes the screens use.

Response shapes match the frontend types in src/lib/visionary/storage.ts
(VisionaryProfile, VisionaryIdea, VisionaryRequirements, ManufacturerRecord,
ManufacturingRequest) and src/lib/manufacturer/publicProfile.ts
(PublicManufacturerProfile), so the screens render the server data unchanged.
"""
import json
import logging
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.schema_check import MIGRATION_HINT
from app.identity.context import ActorContext
from app.storage.supabase import SupabaseStorage
from app.visionary.repository import VisionaryRepository, _uuid
from app.visionary.schemas import MACHINE_CATALOG

log = logging.getLogger("xy.visionary")

SCHEMA_ERROR_CODES = {"42703", "42P01", "42883"}

# manufacturer_booking_requests.status -> what the Visionary sees. "submitted" is shown as
# "Request Sent" by the screens (same as before).
REQUEST_STATUS = {
    "new": "submitted", "returned": "Returned", "accepted": "Accepted",
    "confirmation_pending": "Accepted", "confirmed": "Accepted", "booked": "Accepted",
    "declined": "Declined", "cancelled": "Cancelled",
}


def _clean(value) -> str:
    return str(value or "").strip()


def _unique(values) -> list[str]:
    return list(dict.fromkeys(v.strip() for v in values if v and str(v).strip()))


def _int(value) -> int:
    if value is None:
        return 0
    return int(Decimal(value))


def _json(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return value


def _location(row: dict) -> str:
    region = _clean(row.get("state_province")) or _clean(row.get("country"))
    return ", ".join(p for p in (_clean(row.get("city")), region) if p)


def _cert_status(value: str) -> str:
    if value == "verified":
        return "Verified"
    if value in {"expired", "suspended"}:
        return "Rejected"
    return "Pending"


def _availability(pref: dict | None) -> tuple[str, str, bool]:
    """(availability, note, has_any) with the rules the Visionary screens used."""
    pref = pref or {}
    calendar = list((_json(pref.get("calendar")) or {}).values())
    recurring = _json(pref.get("recurring")) or None
    plan = _json(pref.get("capacity")) or None
    days = (recurring or {}).get("days") or []
    has_any = bool(days) or bool(calendar) or bool((plan or {}).get("start"))
    blocked_only = bool(calendar) and "available" not in calendar and not days
    note = ""
    if days:
        window = "–".join(p for p in ((recurring or {}).get("start"), (recurring or {}).get("end")) if p)
        note = f'Available {", ".join(days)}{", " + window if window else ""}'
    elif plan and (plan.get("start") or plan.get("end")):
        note = " ".join(p for p in (f'Available from {plan["start"]}' if plan.get("start") else "",
                                    f'until {plan["end"]}' if plan.get("end") else "") if p)
    return ("Contact for availability" if blocked_only else "Currently available"), note, has_any


class VisionaryService:
    def __init__(self, session: AsyncSession, settings: Settings):
        self.repo = VisionaryRepository(session)
        self.settings = settings
        self.storage = SupabaseStorage(settings)

    async def _run(self, coro):
        """Database / rule errors -> HTTP errors (same conventions as the Manufacturer API)."""
        try:
            return await coro
        except HTTPException:
            raise
        except LookupError as exc:
            raise HTTPException(404 if "not found" in str(exc).lower() else 409, str(exc)) from exc
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except IntegrityError as exc:
            await self.repo.db.rollback()
            log.warning("Integrity error: %s", exc.orig)
            raise HTTPException(409, "The data conflicts with existing records") from exc
        except DBAPIError as exc:
            await self.repo.db.rollback()
            code = getattr(exc.orig, "pgcode", None) or ""
            detail = str(getattr(exc.orig, "args", [exc])[0]).split(">: ", 1)[-1]
            show = self.settings.environment.lower() != "production"
            if code in SCHEMA_ERROR_CODES:
                log.error("Database schema is out of date: %s. %s", detail, MIGRATION_HINT)
                raise HTTPException(500, f"Database schema is out of date ({detail}). {MIGRATION_HINT}" if show
                                    else "The server is being updated. Please try again shortly.") from exc
            if code.startswith("22") or code == "23514":
                raise HTTPException(422, f"Invalid value: {detail}" if show
                                    else "One of the values is not valid. Please check and try again.") from exc
            log.exception("Database error")
            raise HTTPException(500, f"Database error: {detail}" if show
                                else "Something went wrong on our side. Please try again.") from exc

    # ---------------------------------------------------------------- views
    @staticmethod
    def _profile_view(row: dict | None) -> dict | None:
        if not row:
            return None
        return {"name": row["full_name"], "role": row["role_title"], "org": row["organization_name"] or "",
                "location": row["location"], "intro": row["introduction"] or ""}

    @staticmethod
    def _idea_view(project: dict | None) -> dict | None:
        if not project:
            return None
        return {"project": project["project_name"] or "", "idea": project["idea_description"] or "",
                "product": project["product"] or "", "industry": project["industry"] or ""}

    @staticmethod
    def _requirements_view(project: dict | None) -> dict | None:
        if not project or not (project["requirements_saved_at"] or project["manufacturing_location"]
                               or project["quantity"] or project["budget_amount"] or project["timeline"]):
            return None
        return {"manufacturing_location": project["manufacturing_location"] or "",
                "quantity": {"value": project["quantity"] or 0, "unit": "units"},
                "budget": {"amount": _int(project["budget_amount"]), "currency": "INR"},
                "timeline": project["timeline"] or "",
                "additional_requirements": project["additional_requirements"] or ""}

    @staticmethod
    def _request_view(row: dict) -> dict:
        return {
            "id": str(row["id"]), "request_id": row["request_number"],
            "manufacturer_id": str(row["manufacturer_organization_id"]),
            "manufacturer_name": row["manufacturer_name"], "project_name": row["project_name"],
            "visionary": row["visionary_name"], "machine": row["machine_name"],
            "quantity": {"value": _int(row["requested_capacity"]), "unit": "units"},
            "required_duration": row["required_duration"],
            "manufacturing_location": row["manufacturing_location"],
            "budget": {"amount": _int(row["budget_amount"]), "currency": "INR"},
            "timeline": row["timeline"], "additional_requirements": row["additional_requirements"] or "",
            "status": REQUEST_STATUS.get(row["status"], row["status"]),
            "created_at": row["created_at"].isoformat(),
        }

    def _group(self, details: dict) -> tuple[dict, dict, dict]:
        machines: dict = {}
        for m in details["machines"]:
            m["specs"] = _json(m["specs"]) or {}
            machines.setdefault(m["organization_id"], []).append(m)
        certs: dict = {}
        for c in details["certs"]:
            certs.setdefault(c["organization_id"], []).append(c)
        availability = {a["organization_id"]: a for a in details["availability"]}
        return machines, certs, availability

    def _record(self, org: dict, machines: list, certs: list, pref: dict | None) -> dict:
        """ManufacturerRecord (results cards)."""
        availability, _, _ = _availability(pref)
        capacity = org["stated_production_capacity"]
        return {
            "id": str(org["id"]), "name": org["display_name"], "location": _location(org),
            "category": _clean(org["company_category"]),
            "capabilities": " • ".join(_unique(m["specs"].get("industry") for m in machines)),
            "about": _clean(org["about_company"]),
            "machines": _unique(m["name"] for m in machines),
            "products": _unique(m["specs"].get("subcategory") or m["specs"].get("industry") for m in machines),
            "capacity": int(capacity) if capacity is not None else 0,
            "moq": 0,
            "availability": "Contact for availability" if availability.startswith("Contact") else "Available",
            "logo": self.storage.public_url(org["logo_object_key"]),
            "verified": org["verification_status"] == "verified" or any(c["status"] == "verified" for c in certs),
            "status": "active",
        }

    def _public_profile(self, org: dict, machines: list, certs: list, pref: dict | None) -> dict:
        """PublicManufacturerProfile (Manufacturer Profile page). Public fields only: no contact
        details, owner details or street address."""
        availability, note, has_any = _availability(pref)
        plan = _json((pref or {}).get("capacity")) or {}
        capacity = org["production_capacity_label"] or (
            f'{org["stated_production_capacity"]:g}' if org["stated_production_capacity"] is not None else "")

        def machine(m: dict) -> dict:
            specs = m["specs"]
            return {
                "name": _clean(m["name"]) or _clean(specs.get("subcategory")) or "Machine",
                "type": _clean(m["name"]),
                "image": self.storage.public_url(m["image_key"]),
                "capacity": _clean(specs.get("capacity")),
                "quantity": _clean(plan.get("count")) if _clean(plan.get("machine")) == _clean(m["name"]) else "",
                "availability": "Available",
                "specifications": " · ".join(p for p in (_clean(specs.get("condition")), _clean(specs.get("age")),
                                                          _clean(m["description"])) if p),
                "industry": _clean(specs.get("industry")),
            }

        return {
            "id": str(org["id"]), "name": org["display_name"],
            "logo": self.storage.public_url(org["logo_object_key"]),
            "about": _clean(org["about_company"]), "companyType": _clean(org["business_type"]),
            "industry": _clean(org["company_category"]),
            "established": str(org["establishment_year"] or ""),
            "companySize": _clean(org["organization_size"]) or (
                str(org["employee_count"]) if org["employee_count"] is not None else ""),
            "location": _location(org), "address": "",
            "processes": _unique(m["name"] for m in machines),
            "products": _unique(m["specs"].get("subcategory") for m in machines),
            "industries": _unique(m["specs"].get("industry") for m in machines),
            "materials": _unique(m["specs"].get("materialDetails") for m in machines),
            "machines": [machine(m) for m in machines],
            "capacityText": capacity,
            "availability": availability if has_any else "",
            "availabilityNote": note if has_any else "",
            "certifications": [{"name": c["name"], "body": c["body"] or "", "status": _cert_status(c["status"])}
                               for c in certs if _clean(c["name"])],
            "verified": any(c["status"] == "verified" for c in certs) or org["verification_status"] == "verified",
        }

    # ---------------------------------------------------------------- reads
    async def overview(self, actor: ActorContext) -> dict:
        """Everything the flow needs to resume where the Visionary left off."""
        async def load():
            profile = await self.repo.profile(actor.user_id)
            project = await self.repo.project(actor.user_id)
            requests = await self.repo.requests(actor.user_id)
            return {
                "profile": self._profile_view(profile),
                "idea": self._idea_view(project),
                "stage": (project or {}).get("project_stage") or "",
                "requirements": self._requirements_view(project),
                "requests": [self._request_view(r) for r in requests],
            }
        return await self._run(load())

    async def manufacturers(self) -> list[dict]:
        async def load():
            orgs = await self.repo.manufacturers()
            machines, certs, availability = self._group(
                await self.repo.manufacturer_details([o["id"] for o in orgs]))
            return [self._record(o, machines.get(o["id"], []), certs.get(o["id"], []), availability.get(o["id"]))
                    for o in orgs]
        return await self._run(load())

    async def _manufacturer(self, manufacturer_id: str) -> tuple[dict, list, list, dict | None]:
        org_id = _uuid(manufacturer_id)
        orgs = await self.repo.manufacturers(str(org_id)) if org_id else []
        if not orgs:
            raise LookupError("Manufacturer not found")
        org = orgs[0]
        machines, certs, availability = self._group(await self.repo.manufacturer_details([org["id"]]))
        return org, machines.get(org["id"], []), certs.get(org["id"], []), availability.get(org["id"])

    async def manufacturer(self, manufacturer_id: str) -> dict:
        """{record, profile}: the card data and the public profile of one manufacturer."""
        async def load():
            org, machines, certs, pref = await self._manufacturer(manufacturer_id)
            return {"record": self._record(org, machines, certs, pref),
                    "profile": self._public_profile(org, machines, certs, pref)}
        return await self._run(load())

    async def requests(self, actor: ActorContext) -> list[dict]:
        return await self._run(self._requests(actor))

    async def _requests(self, actor):
        return [self._request_view(r) for r in await self.repo.requests(actor.user_id)]

    async def request(self, actor: ActorContext, request_id: UUID) -> dict:
        async def load():
            rows = await self.repo.requests(actor.user_id, request_id)
            if not rows:  # unknown id, or someone else's request
                raise LookupError("Request not found")
            return self._request_view(rows[0])
        return await self._run(load())

    # ---------------------------------------------------------------- writes
    async def save_profile(self, actor: ActorContext, data: dict) -> dict:
        await self._run(self.repo.save_profile(actor.user_id, data))
        return await self.overview(actor)

    async def save_idea(self, actor: ActorContext, data: dict, complete: bool) -> dict:
        await self._run(self.repo.save_idea(actor.user_id, data, complete))
        return await self.overview(actor)

    async def save_stage(self, actor: ActorContext, stage: str) -> dict:
        await self._run(self.repo.save_stage(actor.user_id, stage))
        return await self.overview(actor)

    async def save_requirements(self, actor: ActorContext, data: dict, complete: bool) -> dict:
        await self._run(self.repo.save_requirements(actor.user_id, data, complete))
        return await self.overview(actor)

    async def draft(self, actor: ActorContext, manufacturer_id: str) -> dict | None:
        async def load():
            org, *_ = await self._manufacturer(manufacturer_id)
            row = await self.repo.draft(actor.user_id, org["id"])
            if not row:
                return None
            return {"manufacturer_id": str(org["id"]), "machine": row["machine_name"] or "",
                    "quantity": {"value": row["quantity"] or 0, "unit": "units"},
                    "required_duration": row["required_duration"] or "",
                    "manufacturing_location": row["manufacturing_location"] or "",
                    "budget": {"amount": _int(row["budget_amount"]), "currency": "INR"},
                    "timeline": row["timeline"] or "",
                    "additional_requirements": row["additional_requirements"] or "",
                    "status": "draft"}
        return await self._run(load())

    async def save_draft(self, actor: ActorContext, manufacturer_id: str, data: dict) -> dict | None:
        async def save():
            org, *_ = await self._manufacturer(manufacturer_id)
            await self.repo.save_draft(actor.user_id, org["id"], data)
        await self._run(save())
        return await self.draft(actor, manufacturer_id)

    async def create_request(self, actor: ActorContext, data: dict) -> dict:
        async def create():
            org, machines, _, _ = await self._manufacturer(data["manufacturer_id"])
            if await self.repo.is_member_of(actor.user_id, org["id"]):
                raise PermissionError("You cannot send a manufacturing request to your own company.")
            project = await self.repo.project(actor.user_id)
            if not project or not project["project_name"]:
                raise LookupError("Add your project details before sending a request.")
            # Same choice the form offers: the manufacturer's published machines, or the
            # general catalog while it has none.
            names = {m["name"].strip(): m["id"] for m in machines if m["name"]}
            allowed = names or {name: None for name in MACHINE_CATALOG}
            if data["machine"] not in allowed:
                raise ValueError("Please select one of the machines this manufacturer has available.")
            profile = await self.repo.profile(actor.user_id)
            user = await self.repo.user_row(actor.user_id)
            visionary = (profile or {}).get("full_name") or user.get("display_name") or ""
            return await self.repo.create_request(actor.user_id, org["id"], project, org, visionary, data,
                                                  allowed[data["machine"]])
        request_id = await self._run(create())
        return await self.request(actor, request_id)
