"""SQL for the Manufacturer frontend (src/components/manufacturer/*).

Every public method takes the frontend's own data shapes (camelCase keys from
`ManufacturerState` / `ProfileWizardData` / `MachineryDraft`) and maps them to
the canonical tables in XY_Database_Schema.sql (+ migrations 004-006).
"""
import json
import re
from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Actor
from app.storage.supabase import DecodedImage, UploadedObject


COUNTRY_CODES = {
    "india": "IN", "united states": "US", "united kingdom": "GB", "united arab emirates": "AE",
    "germany": "DE", "china": "CN", "vietnam": "VN", "bangladesh": "BD",
}

# Frontend listing status  ->  (machines.status, machines.publication_status)
MACHINE_STATUS = {
    "Draft": ("active", "draft"),
    "Published": ("active", "published"),
    "Unpublished": ("active", "hidden"),
    "Archived": ("archived", "hidden"),
}

# Frontend infra keys -> infrastructure_items.category
INFRA_CATEGORIES = {
    "electricity": "electricity", "water": "water", "storage": "storage",
    "packaging": "packing", "waste": "waste_disposal", "qa": "quality_assurance",
}
INFRA_NAMES = {
    "electricity": "Electricity", "water": "Water", "storage": "Storage",
    "packaging": "Packaging", "waste": "Waste disposal", "qa": "Quality assurance",
}

# Booking statuses grouped the way the dashboard shows them.
OPEN_STATUSES = ("new", "returned")
RESERVED_STATUSES = ("accepted", "confirmation_pending")
BOOKED_STATUSES = ("confirmed", "booked")

# MachineryDraft keys that live on `machines`; everything else -> machine_specs.
MACHINE_COLUMN_KEYS = {"images", "type", "status", "technical"}


def slug(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", value.upper()).strip("_")[:80] or "CUSTOM"


def capacity_number(value: Any) -> float | None:
    """'12,500 units/month' -> 12500.0 ; '' -> None."""
    if value in (None, ""):
        return None
    match = re.search(r"\d+(?:\.\d+)?", str(value).replace(",", ""))
    return float(match.group()) if match else None


def int_or_none(value: Any) -> int | None:
    value = str(value or "").strip()
    return int(value) if value.isdigit() else None


def valid_year(value: Any) -> int | None:
    year = int_or_none(value)
    return year if year and 1700 <= year <= date.today().year else None


def parse_pin(pin: Any) -> tuple[float, float] | None:
    """Frontend pin format is 'lat, lng'."""
    if not isinstance(pin, str):
        return None
    parts = [p.strip() for p in pin.split(",")]
    if len(parts) != 2:
        return None
    try:
        lat, lng = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    return (lat, lng) if -90 <= lat <= 90 and -180 <= lng <= 180 else None


def profile_flags(data: dict) -> dict[str, bool]:
    """Same completion rules as ManufacturerApp.handleProfileChange."""
    c, loc = data["company"], data["location"]
    return {
        "company": bool(str(c.get("name") or "").strip() and str(c.get("about") or "").strip()),
        "location": bool(str(loc.get("address") or "").strip() and str(loc.get("city") or "").strip()
                         and loc.get("country")),
        "certs": bool(data.get("certifications")),
        "infra": any(str(v or "").strip() for v in (data.get("infra") or {}).values()),
        "faq": bool(data.get("faqs")),
    }


class ManufacturerRepository:
    def __init__(self, session: AsyncSession):
        self.db = session

    # ------------------------------------------------------------------ identity
    async def sync_actor(self, actor: Actor, profile: dict) -> None:
        """Create the user / organization / membership rows for a Clerk user."""
        if not profile.get("email"):
            raise LookupError("Your Clerk account has no primary email address")
        try:
            user_id = await self.db.scalar(text("""
                INSERT INTO users(clerk_user_id,email,phone,display_name,first_name,last_name)
                VALUES (:clerk,:email,:phone,:display,NULLIF(:first,''),NULLIF(:last,''))
                ON CONFLICT (clerk_user_id) DO UPDATE SET email=EXCLUDED.email,
                  phone=COALESCE(users.phone,EXCLUDED.phone),
                  first_name=COALESCE(users.first_name,EXCLUDED.first_name),
                  last_name=COALESCE(users.last_name,EXCLUDED.last_name),
                  status='active',updated_at=now()
                RETURNING id
            """), {
                "clerk": actor.clerk_user_id, "email": profile["email"], "phone": profile.get("phone"),
                "display": f'{profile.get("first_name", "")} {profile.get("last_name", "")}'.strip() or profile["email"],
                "first": profile.get("first_name") or "", "last": profile.get("last_name") or "",
            })
        except IntegrityError as exc:
            await self.db.rollback()
            raise LookupError("This email is already linked to another account") from exc

        if actor.clerk_org_id:
            org_id = await self.db.scalar(text("""
                INSERT INTO organizations(clerk_organization_id,display_name,organization_type,status,created_by_user_id)
                VALUES (:clerk,:name,'manufacturer','active',:user)
                ON CONFLICT (clerk_organization_id) DO UPDATE SET status='active',updated_at=now()
                RETURNING id
            """), {"clerk": actor.clerk_org_id, "name": profile["organization_name"], "user": user_id})
        else:
            # The frontend has no Clerk Organization step, so each user gets a personal
            # manufacturer organization (clerk_organization_id stays NULL).
            org_id = await self.db.scalar(text("""
                SELECT o.id FROM organizations o
                JOIN memberships m ON m.organization_id=o.id AND m.user_id=:user AND m.status='active'
                WHERE o.organization_type='manufacturer' AND o.status<>'closed'
                ORDER BY (o.created_by_user_id=:user) DESC, m.created_at LIMIT 1
            """), {"user": user_id})
            if org_id is None:
                org_id = await self.db.scalar(text("""
                    INSERT INTO organizations(display_name,organization_type,status,created_by_user_id)
                    VALUES (:name,'manufacturer','active',:user) RETURNING id
                """), {"name": profile["organization_name"], "user": user_id})
        await self.db.execute(text("""
            INSERT INTO memberships(user_id,organization_id,membership_role,status,accepted_at)
            VALUES (:user,:org,'owner','active',now())
            ON CONFLICT (organization_id,user_id) DO UPDATE SET status='active'
        """), {"user": user_id, "org": org_id})
        await self.db.commit()

    async def context(self, actor: Actor) -> dict:
        base = """
            SELECT u.id user_id, u.first_name, u.last_name, u.date_of_birth, u.email, u.phone,
                   o.id organization_id, o.display_name, o.organization_type, m.id membership_id
            FROM users u
            JOIN memberships m ON m.user_id=u.id AND m.status='active'
            JOIN organizations o ON o.id=m.organization_id
            WHERE u.clerk_user_id=:user
        """
        if actor.clerk_org_id:
            sql = base + " AND o.clerk_organization_id=:org"
        else:
            sql = base + """ AND o.organization_type='manufacturer' AND o.status<>'closed'
                ORDER BY (o.created_by_user_id=u.id) DESC, m.created_at LIMIT 1"""
        row = (await self.db.execute(text(sql), {"user": actor.clerk_user_id, "org": actor.clerk_org_id})).first()
        if not row:
            raise LookupError("Clerk user/organization is not synchronized yet")
        result = dict(row._mapping)
        if result["organization_type"] != "manufacturer":
            raise PermissionError("Active organization is not a Manufacturer")
        return result

    async def _country_code(self, name: str) -> str | None:
        code = COUNTRY_CODES.get((name or "").strip().lower())
        if code and await self.db.scalar(text("SELECT 1 FROM countries WHERE code=:c"), {"c": code}):
            return code
        return None

    # ------------------------------------------------------------------ account
    async def create_account(self, actor: Actor, data: dict) -> None:
        ctx = await self.context(actor)
        contact = data["contact"].strip()
        email = contact if "@" in contact else None
        contact_phone = data.get("phone") or (None if email else contact)
        country = await self._country_code(data["country"])
        await self.db.execute(text("""
            UPDATE users SET first_name=:first,last_name=:last,date_of_birth=:dob,
              phone=COALESCE(:phone,phone),display_name=:display,updated_at=now()
            WHERE id=:user_id
        """), {**ctx, "first": data["firstName"], "last": data["lastName"], "dob": date.fromisoformat(str(data["dob"])),
                "phone": contact_phone, "display": f'{data["firstName"]} {data["lastName"]}'})
        await self.db.execute(text("""
            UPDATE organizations SET display_name=:name,legal_name=COALESCE(legal_name,:name),
              updated_at=now(),version=version+1 WHERE id=:organization_id
        """), {**ctx, "name": data["companyName"]})
        await self.db.execute(text("""
            INSERT INTO organization_profiles
              (organization_id,contact_email,contact_phone,country_code,country_name,company_category,
               stated_production_capacity,production_capacity_label)
            VALUES (:organization_id,:email,:phone,:country,:country_name,:category,:capacity,:capacity_label)
            ON CONFLICT (organization_id) DO UPDATE SET contact_email=EXCLUDED.contact_email,
              contact_phone=EXCLUDED.contact_phone,country_code=EXCLUDED.country_code,
              country_name=EXCLUDED.country_name,company_category=EXCLUDED.company_category,
              stated_production_capacity=EXCLUDED.stated_production_capacity,
              production_capacity_label=EXCLUDED.production_capacity_label,updated_at=now()
        """), {**ctx, "email": email, "phone": contact_phone, "country": country,
                "country_name": data["country"], "category": data["companyType"],
                "capacity": capacity_number(data.get("capacity")), "capacity_label": data.get("capacity") or None})
        await self.db.execute(text("""
            INSERT INTO marketplace_role_selections(user_id,role_selected)
            SELECT :user_id,'manufacturer' WHERE NOT EXISTS (
              SELECT 1 FROM marketplace_role_selections
              WHERE user_id=:user_id AND role_selected='manufacturer' AND status='active')
        """), ctx)
        await self.db.execute(text("""
            INSERT INTO manufacturer_onboarding
              (organization_id,current_step,personal_information_completed,completion_percentage,status)
            VALUES (:organization_id,'company_information',true,15,'in_progress')
            ON CONFLICT (organization_id) DO UPDATE SET personal_information_completed=true,
              completion_percentage=GREATEST(manufacturer_onboarding.completion_percentage,15),
              status=CASE WHEN manufacturer_onboarding.status='draft' THEN 'in_progress'
                          ELSE manufacturer_onboarding.status END,
              version=manufacturer_onboarding.version+1
        """), ctx)
        await self.db.commit()

    # ------------------------------------------------------------------ files
    async def find_file(self, ctx: dict, image: DecodedImage, purpose: str) -> UUID | None:
        """Reuse an identical image this organization already uploaded.

        The profile wizard re-sends the same logo/cover data URL on every save,
        so this prevents duplicate uploads.
        """
        return await self.db.scalar(text("""
            SELECT id FROM files
            WHERE organization_id=:organization_id AND checksum=:checksum AND purpose=:purpose AND status='active'
            ORDER BY created_at DESC LIMIT 1
        """), {**ctx, "checksum": image.checksum, "purpose": purpose})

    async def add_file(self, ctx: dict, uploaded: UploadedObject, purpose: str) -> UUID:
        file_id = await self.db.scalar(text("""
            INSERT INTO files
              (organization_id,uploaded_by_user_id,object_key,filename,content_type,size_bytes,
               checksum,classification,scan_status,purpose)
            VALUES (:organization_id,:user_id,:key,:filename,:content_type,:size,:checksum,'public','clean',:purpose)
            RETURNING id
        """), {**ctx, "key": uploaded.object_key, "filename": uploaded.filename,
                "content_type": uploaded.content_type, "size": uploaded.size_bytes,
                "checksum": uploaded.checksum, "purpose": purpose})
        await self.db.commit()
        return file_id

    # ------------------------------------------------------------------ profile
    async def save_profile(self, actor: Actor, data: dict, asset_ids: dict[str, UUID]) -> None:
        ctx = await self.context(actor)
        company, location = data["company"], data["location"]
        await self.db.execute(text("""
            UPDATE organizations SET display_name=COALESCE(NULLIF(:name,''),display_name),
              description=NULLIF(:about,''),updated_at=now(),version=version+1
            WHERE id=:organization_id
        """), {**ctx, "name": str(company.get("name") or "").strip(), "about": company.get("about") or ""})
        await self.db.execute(text("""
            INSERT INTO organization_profiles
              (organization_id,logo_file_id,cover_file_id,about_company,vision,establishment_year,
               employee_count,business_type,organization_size)
            VALUES (:organization_id,:logo,:cover,:about,:vision,:year,:employees,:business,:size)
            ON CONFLICT (organization_id) DO UPDATE SET
              logo_file_id=COALESCE(EXCLUDED.logo_file_id,organization_profiles.logo_file_id),
              cover_file_id=COALESCE(EXCLUDED.cover_file_id,organization_profiles.cover_file_id),
              about_company=EXCLUDED.about_company,vision=EXCLUDED.vision,
              establishment_year=EXCLUDED.establishment_year,employee_count=EXCLUDED.employee_count,
              business_type=EXCLUDED.business_type,organization_size=EXCLUDED.organization_size,updated_at=now()
        """), {**ctx, "logo": asset_ids.get("logo"), "cover": asset_ids.get("cover"),
                "about": company.get("about") or None, "vision": company.get("vision") or None,
                "year": valid_year(company.get("estYear")), "employees": int_or_none(company.get("employees")),
                "business": company.get("businessType") or None, "size": company.get("orgSize") or None})

        country_name = location.get("country") or ""
        pin = location.get("pin")
        coords = parse_pin(pin)
        facility_id = await self.db.scalar(text("""
            INSERT INTO facilities
              (organization_id,name,facility_type,address,address_line1,city,state_province,country_code,
               country_name,postal_code,is_headquarters,sez_status,serviceable_areas,map_pin,location,
               status,visibility)
            VALUES (:organization_id,:name,'factory',:address,:address,:city,:state,:country,:country_name,:zip,
                    true,:sez,:areas,:pin,
                    CASE WHEN CAST(:lat AS float8) IS NULL THEN NULL
                         ELSE ST_SetSRID(ST_MakePoint(CAST(:lng AS float8),CAST(:lat AS float8)),4326)::geography END,
                    'draft','private')
            ON CONFLICT (organization_id) WHERE is_headquarters=true AND status<>'suspended'
            DO UPDATE SET name=EXCLUDED.name,address=EXCLUDED.address,address_line1=EXCLUDED.address_line1,
              city=EXCLUDED.city,state_province=EXCLUDED.state_province,country_code=EXCLUDED.country_code,
              country_name=EXCLUDED.country_name,postal_code=EXCLUDED.postal_code,sez_status=EXCLUDED.sez_status,
              serviceable_areas=EXCLUDED.serviceable_areas,map_pin=EXCLUDED.map_pin,location=EXCLUDED.location,
              version=facilities.version+1
            RETURNING id
        """), {**ctx, "name": f'{company.get("name") or ctx["display_name"] or "Manufacturer"} Headquarters',
                "address": location.get("address") or None, "city": location.get("city") or None,
                "state": location.get("state") or None, "country": await self._country_code(country_name),
                "country_name": country_name or None, "zip": location.get("zip") or None,
                "sez": location.get("sez") or None, "areas": list(location.get("serviceableAreas") or []),
                "pin": pin if isinstance(pin, str) and pin else None,
                "lat": coords[0] if coords else None, "lng": coords[1] if coords else None})

        await self._replace_certifications(ctx, facility_id, data.get("certifications") or [])
        await self._replace_infrastructure(ctx, facility_id, data.get("infra") or {})
        await self._replace_faqs(ctx, facility_id, data.get("faqs") or [])

        flags = profile_flags(data)
        pct = round(15 + sum(flags.values()) / 5 * 85)
        steps = [("company", "company_information"), ("location", "location"), ("certs", "certification"),
                 ("infra", "infrastructure"), ("faq", "faq")]
        next_step = next((step for key, step in steps if not flags[key]), "completed")
        await self.db.execute(text("""
            INSERT INTO manufacturer_onboarding
              (organization_id,current_step,company_information_completed,location_completed,
               certification_completed,infrastructure_completed,faq_completed,completion_percentage,status)
            VALUES (:organization_id,:step,:company,:location,:certs,:infra,:faq,:pct,'in_progress')
            ON CONFLICT (organization_id) DO UPDATE SET current_step=EXCLUDED.current_step,
              company_information_completed=EXCLUDED.company_information_completed,
              location_completed=EXCLUDED.location_completed,
              certification_completed=EXCLUDED.certification_completed,
              infrastructure_completed=EXCLUDED.infrastructure_completed,
              faq_completed=EXCLUDED.faq_completed,completion_percentage=EXCLUDED.completion_percentage,
              status=CASE WHEN manufacturer_onboarding.status='draft' THEN 'in_progress'
                          ELSE manufacturer_onboarding.status END,
              version=manufacturer_onboarding.version+1
        """), {**ctx, **flags, "step": next_step, "pct": pct})
        await self.db.commit()

    async def _replace_certifications(self, ctx: dict, facility_id: UUID, items: list[dict]) -> None:
        # Reviewed certifications are kept; self-declared ones mirror the wizard list.
        reviewed = {
            (r.name, r.body or "") for r in (await self.db.execute(text("""
                SELECT ct.name, oc.issuer body FROM organization_certifications oc
                JOIN certification_types ct ON ct.id=oc.certification_type_id
                WHERE oc.organization_id=:organization_id AND oc.status<>'declared'
            """), ctx))
        }
        await self.db.execute(text(
            "DELETE FROM organization_certifications WHERE organization_id=:organization_id AND status='declared'"
        ), ctx)
        for item in items:
            name = str(item.get("name") or "").strip()
            body = str(item.get("body") or "").strip()
            if not name or (name, body) in reviewed:
                continue
            cert_type = await self.db.scalar(text("""
                INSERT INTO certification_types(code,name,issuer) VALUES (:code,:name,:issuer)
                ON CONFLICT (code) DO UPDATE SET name=certification_types.name RETURNING id
            """), {"code": slug(name), "name": name, "issuer": body or None})
            await self.db.execute(text("""
                INSERT INTO organization_certifications
                  (organization_id,facility_id,certification_type_id,issuer,document_file_name,status,created_at)
                VALUES (:organization_id,:facility,:type,:issuer,:file_name,'declared',clock_timestamp())
            """), {**ctx, "facility": facility_id, "type": cert_type, "issuer": body or None,
                    "file_name": item.get("fileName") or None})

    async def _replace_infrastructure(self, ctx: dict, facility_id: UUID, values: dict) -> None:
        for position, (code, category) in enumerate(INFRA_CATEGORIES.items()):
            item_id = await self.db.scalar(text("""
                INSERT INTO infrastructure_items(code,name,category,answer_type,display_order)
                VALUES (:code,:name,:category,'text',:position)
                ON CONFLICT (code) DO UPDATE SET name=infrastructure_items.name RETURNING id
            """), {"code": code, "name": INFRA_NAMES[code], "category": category, "position": position})
            await self.db.execute(text("""
                INSERT INTO manufacturer_infrastructure
                  (organization_id,facility_id,infrastructure_item_id,text_value,updated_by_membership_id)
                VALUES (:organization_id,:facility,:item,:value,:membership_id)
                ON CONFLICT (organization_id,facility_id,infrastructure_item_id)
                DO UPDATE SET text_value=EXCLUDED.text_value,
                  updated_by_membership_id=EXCLUDED.updated_by_membership_id,
                  version=manufacturer_infrastructure.version+1
            """), {**ctx, "facility": facility_id, "item": item_id,
                    "value": str(values.get(code) or "").strip() or None})

    async def _replace_faqs(self, ctx: dict, facility_id: UUID, faqs: list[dict]) -> None:
        # The wizard can remove FAQs, so the stored list mirrors it exactly.
        await self.db.execute(text("DELETE FROM manufacturer_faq_answers WHERE organization_id=:organization_id"), ctx)
        for position, faq in enumerate(faqs):
            question = str(faq.get("q") or "").strip()
            if not question:
                continue
            question_id = await self.db.scalar(text("""
                INSERT INTO manufacturer_faq_questions(question_code,question_text,answer_type,display_order)
                VALUES (:code,:question,'text',0)
                ON CONFLICT (question_code) DO UPDATE SET question_text=manufacturer_faq_questions.question_text
                RETURNING id
            """), {"code": f"CUSTOM_{slug(question)}", "question": question})
            await self.db.execute(text("""
                INSERT INTO manufacturer_faq_answers
                  (organization_id,facility_id,question_id,text_value,answered_by_membership_id,display_order)
                VALUES (:organization_id,:facility,:question,:answer,:membership_id,:position)
                ON CONFLICT (organization_id,facility_id,question_id)
                DO UPDATE SET text_value=EXCLUDED.text_value,display_order=EXCLUDED.display_order
            """), {**ctx, "facility": facility_id, "question": question_id,
                    "answer": str(faq.get("a") or ""), "position": position})

    # ------------------------------------------------------------------ machinery
    async def create_machinery(self, actor: Actor, data: dict, images: list[tuple[UUID, bool]]) -> str:
        ctx = await self.context(actor)
        term_id = await self.db.scalar(text("""
            INSERT INTO taxonomy_terms(term_type,term,code,status)
            VALUES ('machinery',:term,:code,'active')
            ON CONFLICT (term_type,code,taxonomy_version) DO UPDATE SET term=taxonomy_terms.term
            RETURNING id
        """), {"term": data["type"], "code": slug(data["type"])})
        status, publication = MACHINE_STATUS[data["status"]]
        facility_id = await self.db.scalar(text("""
            SELECT id FROM facilities WHERE organization_id=:organization_id AND is_headquarters=true
              AND status<>'suspended' LIMIT 1
        """), ctx)
        machine_id = await self.db.scalar(text("""
            INSERT INTO machines
              (organization_id,facility_id,machinery_term_id,name,description,status,publication_status,created_at)
            VALUES (:organization_id,:facility,:term,:name,:description,:status,:publication,clock_timestamp())
            RETURNING id
        """), {**ctx, "facility": facility_id, "term": term_id, "name": data["type"],
                "description": data.get("technical") or None, "status": status, "publication": publication})
        for key, value in data.items():
            if key in MACHINE_COLUMN_KEYS:
                continue
            await self.db.execute(text("""
                INSERT INTO machine_specs(machine_id,spec_code,value_text) VALUES (:machine,:code,:value)
            """), {"machine": machine_id, "code": key,
                    "value": json.dumps(value) if isinstance(value, (dict, list)) else str(value or "")})
        for order, (file_id, primary) in enumerate(images):
            await self.db.execute(text("""
                INSERT INTO machine_images(machine_id,file_id,display_order,alt_text)
                VALUES (:machine,:file,:order,:alt)
            """), {"machine": machine_id, "file": file_id, "order": 0 if primary else order + 1, "alt": data["type"]})
        await self.db.commit()
        return str(machine_id)

    async def set_machinery_status(self, actor: Actor, machine_id: str, display_status: str) -> None:
        ctx = await self.context(actor)
        status, publication = MACHINE_STATUS[display_status]
        result = await self.db.execute(text("""
            UPDATE machines SET status=:status,publication_status=:publication,version=version+1
            WHERE id=CAST(:id AS uuid) AND organization_id=:organization_id RETURNING id
        """), {**ctx, "id": machine_id, "status": status, "publication": publication})
        if not result.first():
            raise LookupError("Machinery listing not found")
        await self.db.commit()

    # ------------------------------------------------------------------ availability
    async def save_availability(self, actor: Actor, data: dict) -> None:
        ctx = await self.context(actor)
        await self.db.execute(text("""
            INSERT INTO manufacturer_availability_preferences
              (organization_id,calendar,recurring,capacity,updated_by_user_id)
            VALUES (:organization_id,CAST(:calendar AS jsonb),CAST(:recurring AS jsonb),
                    CAST(:capacity AS jsonb),:user_id)
            ON CONFLICT (organization_id) DO UPDATE SET calendar=EXCLUDED.calendar,
              recurring=EXCLUDED.recurring,capacity=EXCLUDED.capacity,updated_by_user_id=EXCLUDED.updated_by_user_id
        """), {**ctx, "calendar": json.dumps(data.get("calendar") or {}),
                "recurring": json.dumps(data.get("recurring")), "capacity": json.dumps(data.get("capacity"))})
        await self.db.commit()

    # ------------------------------------------------------------------ bookings
    async def update_booking(self, actor: Actor, booking_id: str, decision: str) -> None:
        """Mirror of the dashboard buttons.

        accepted: New -> Booked ("Accept") and Reserved -> Booked ("Confirm booking")
        declined: New -> Cancelled ("Decline"), Reserved/Booked -> Cancelled ("Cancel")
        """
        ctx = await self.context(actor)
        current = await self.db.scalar(text("""
            SELECT status FROM manufacturer_booking_requests
            WHERE id=CAST(:id AS uuid) AND manufacturer_organization_id=:organization_id
        """), {**ctx, "id": booking_id})
        if current is None:
            raise LookupError("Booking request not found")
        if decision == "accepted":
            if current not in OPEN_STATUSES + RESERVED_STATUSES:
                raise ValueError("This booking request can no longer be accepted")
            sql = """UPDATE manufacturer_booking_requests SET status='confirmed',
                       manufacturer_response=COALESCE(manufacturer_response,'Accepted'),"""
        elif current in OPEN_STATUSES:
            sql = """UPDATE manufacturer_booking_requests SET status='declined',
                       decline_reason=COALESCE(decline_reason,'Declined by manufacturer'),"""
        elif current in RESERVED_STATUSES + BOOKED_STATUSES:
            sql = """UPDATE manufacturer_booking_requests SET status='cancelled',cancelled_at=now(),
                       cancellation_reason=COALESCE(cancellation_reason,'Cancelled by manufacturer'),"""
        else:
            raise ValueError("This booking request is already closed")
        await self.db.execute(text(sql + """
              responded_by_membership_id=:membership_id,responded_at=now(),version=version+1
            WHERE id=CAST(:id AS uuid) AND manufacturer_organization_id=:organization_id
        """), {**ctx, "id": booking_id})
        await self.db.commit()

    # ------------------------------------------------------------------ read model
    async def snapshot(self, actor: Actor) -> dict:
        ctx = await self.context(actor)
        profile = (await self.db.execute(text("""
            SELECT o.display_name,op.company_category,op.stated_production_capacity,op.production_capacity_label,
                   op.country_name account_country,op.contact_email,op.contact_phone,
                   op.about_company,op.vision,op.establishment_year,op.employee_count,
                   op.business_type,op.organization_size,
                   f.id facility_id,f.address_line1,f.city,f.state_province,f.country_name facility_country,
                   f.postal_code,f.sez_status,f.serviceable_areas,f.map_pin,
                   logo.object_key logo_object_key,cover.object_key cover_object_key,
                   mo.personal_information_completed,mo.company_information_completed,mo.location_completed,
                   mo.certification_completed,mo.infrastructure_completed,mo.faq_completed,mo.completion_percentage
            FROM organizations o
            LEFT JOIN organization_profiles op ON op.organization_id=o.id
            LEFT JOIN facilities f ON f.organization_id=o.id AND f.is_headquarters=true AND f.status<>'suspended'
            LEFT JOIN files logo ON logo.id=op.logo_file_id
            LEFT JOIN files cover ON cover.id=op.cover_file_id
            LEFT JOIN manufacturer_onboarding mo ON mo.organization_id=o.id
            WHERE o.id=:organization_id
        """), ctx)).first()
        certs = await self.db.execute(text("""
            SELECT ct.name,COALESCE(oc.issuer,ct.issuer) body,oc.status,oc.document_file_name
            FROM organization_certifications oc JOIN certification_types ct ON ct.id=oc.certification_type_id
            WHERE oc.organization_id=:organization_id ORDER BY oc.created_at, oc.id
        """), ctx)
        infra = await self.db.execute(text("""
            SELECT ii.code,mi.text_value FROM manufacturer_infrastructure mi
            JOIN infrastructure_items ii ON ii.id=mi.infrastructure_item_id
            WHERE mi.organization_id=:organization_id
        """), ctx)
        faqs = await self.db.execute(text("""
            SELECT q.question_text q,a.text_value a FROM manufacturer_faq_answers a
            JOIN manufacturer_faq_questions q ON q.id=a.question_id
            WHERE a.organization_id=:organization_id ORDER BY a.display_order, a.created_at
        """), ctx)
        machines = await self.db.execute(text("""
            SELECT m.id,m.name,m.description,m.status,m.publication_status,
                   COALESCE(jsonb_object_agg(ms.spec_code,ms.value_text) FILTER (WHERE ms.spec_code IS NOT NULL),
                            '{}'::jsonb) specs
            FROM machines m LEFT JOIN machine_specs ms ON ms.machine_id=m.id
            WHERE m.organization_id=:organization_id GROUP BY m.id ORDER BY m.created_at DESC, m.id
        """), ctx)
        images = await self.db.execute(text("""
            SELECT mi.machine_id,f.object_key,mi.display_order FROM machine_images mi
            JOIN files f ON f.id=mi.file_id JOIN machines m ON m.id=mi.machine_id
            WHERE m.organization_id=:organization_id ORDER BY mi.machine_id,mi.display_order
        """), ctx)
        availability = (await self.db.execute(text("""
            SELECT calendar,recurring,capacity FROM manufacturer_availability_preferences
            WHERE organization_id=:organization_id
        """), ctx)).first()
        bookings = await self.db.execute(text("""
            SELECT br.id,COALESCE(o.display_name,'Buyer') buyer,
                   COALESCE(cl.title,br.requirements,'Capacity request') item,
                   br.requested_start_date,br.status
            FROM manufacturer_booking_requests br
            JOIN organizations o ON o.id=br.demand_organization_id
            LEFT JOIN manufacturer_capacity_listings cl ON cl.id=br.capacity_listing_id
            WHERE br.manufacturer_organization_id=:organization_id ORDER BY br.created_at DESC
        """), ctx)
        return {
            "context": ctx,
            "profile": dict(profile._mapping) if profile else {},
            "certifications": [dict(r._mapping) for r in certs],
            "infrastructure": {r.code: r.text_value or "" for r in infra},
            "faqs": [dict(r._mapping) for r in faqs],
            "machines": [dict(r._mapping) for r in machines],
            "images": [dict(r._mapping) for r in images],
            "availability": dict(availability._mapping) if availability else {},
            "bookings": [dict(r._mapping) for r in bookings],
        }
