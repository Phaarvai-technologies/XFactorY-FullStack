import json
import re
from datetime import date
from typing import Any
from uuid import UUID
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import Actor
from app.storage.supabase import UploadedObject


COUNTRY_CODES = {"india": "IN", "united states": "US", "united kingdom": "GB",
                 "united arab emirates": "AE", "germany": "DE", "china": "CN",
                 "vietnam": "VN", "bangladesh": "BD"}


def slug(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", value.upper()).strip("_")[:80] or "CUSTOM"


class ManufacturerRepository:
    def __init__(self, session: AsyncSession):
        self.db = session

    async def sync_actor(self, actor: Actor, profile: dict):
        if not profile.get("email"):
            raise LookupError("Clerk user has no primary email")
        user_id = await self.db.scalar(text("""
            INSERT INTO users(clerk_user_id,email,phone,display_name,first_name,last_name)
            VALUES (:clerk,:email,:phone,:display,:first,:last)
            ON CONFLICT (clerk_user_id) DO UPDATE SET email=EXCLUDED.email,
              phone=COALESCE(EXCLUDED.phone,users.phone),first_name=EXCLUDED.first_name,
              last_name=EXCLUDED.last_name,display_name=EXCLUDED.display_name,updated_at=now()
            RETURNING id
        """), {"clerk": actor.clerk_user_id, "email": profile["email"], "phone": profile.get("phone"),
                "display": f'{profile.get("first_name","")} {profile.get("last_name","")}'.strip() or profile["email"],
                "first": profile.get("first_name"), "last": profile.get("last_name")})
        org_id = await self.db.scalar(text("""
            INSERT INTO organizations(clerk_organization_id,display_name,organization_type,status,created_by_user_id)
            VALUES (:clerk,:name,'manufacturer','active',:user)
            ON CONFLICT (clerk_organization_id) DO UPDATE SET display_name=EXCLUDED.display_name,
              organization_type='manufacturer',status='active',updated_at=now() RETURNING id
        """), {"clerk": actor.clerk_org_id, "name": profile["organization_name"], "user": user_id})
        await self.db.execute(text("""
            INSERT INTO memberships(user_id,organization_id,membership_role,status,accepted_at)
            VALUES (:user,:org,'owner','active',now())
            ON CONFLICT (organization_id,user_id) DO UPDATE SET status='active'
        """), {"user": user_id, "org": org_id})
        await self.db.commit()

    async def context(self, actor: Actor) -> dict:
        row = (await self.db.execute(text("""
            SELECT u.id user_id, u.first_name, u.last_name, u.date_of_birth, u.email, u.phone,
                   o.id organization_id, o.display_name, o.organization_type,
                   m.id membership_id
            FROM users u
            JOIN memberships m ON m.user_id=u.id AND m.status='active'
            JOIN organizations o ON o.id=m.organization_id
            WHERE u.clerk_user_id=:user AND o.clerk_organization_id=:org
        """), {"user": actor.clerk_user_id, "org": actor.clerk_org_id})).first()
        if not row:
            raise LookupError("Clerk user/organization is not synchronized to Supabase")
        result = dict(row._mapping)
        if result["organization_type"] != "manufacturer":
            raise PermissionError("Active organization is not a Manufacturer")
        return result

    async def create_account(self, actor: Actor, data: dict):
        ctx = await self.context(actor)
        country = COUNTRY_CODES.get(data["country"].lower())
        if country:
            exists = await self.db.scalar(text("SELECT 1 FROM countries WHERE code=:code"), {"code": country})
            if not exists:
                country = None
        email = data["contact"] if "@" in data["contact"] else None
        contact_phone = data["phone"] or (data["contact"] if not email else None)
        capacity = float(data["capacity"]) if data["capacity"].replace(".", "", 1).isdigit() else None
        await self.db.execute(text("""
            UPDATE users SET first_name=:first, last_name=:last, date_of_birth=CAST(:dob AS date),
              phone=COALESCE(:phone,phone), display_name=:display, updated_at=now()
            WHERE id=:user_id
        """), {"first": data["firstName"], "last": data["lastName"], "dob": data["dob"],
                "phone": contact_phone, "display": f'{data["firstName"]} {data["lastName"]}', **ctx})
        await self.db.execute(text("""
            UPDATE organizations SET display_name=:name, legal_name=COALESCE(legal_name,:name),
              organization_type='manufacturer', updated_at=now(), version=version+1 WHERE id=:organization_id
        """), {"name": data["companyName"], **ctx})
        await self.db.execute(text("""
            INSERT INTO organization_profiles
              (organization_id,contact_email,contact_phone,country_code,company_category,stated_production_capacity)
            VALUES (:organization_id,:email,:phone,:country,:category,:capacity)
            ON CONFLICT (organization_id) DO UPDATE SET contact_email=EXCLUDED.contact_email,
              contact_phone=EXCLUDED.contact_phone,country_code=EXCLUDED.country_code,
              company_category=EXCLUDED.company_category,
              stated_production_capacity=EXCLUDED.stated_production_capacity,updated_at=now()
        """), {"email": email, "phone": contact_phone, "country": country,
                "category": data["companyType"], "capacity": capacity, **ctx})
        has_role = await self.db.scalar(text("""
            SELECT 1 FROM marketplace_role_selections
            WHERE user_id=:user_id AND role_selected='manufacturer' AND status='active'
        """), ctx)
        if not has_role:
            await self.db.execute(text("""
                INSERT INTO marketplace_role_selections(user_id,role_selected) VALUES (:user_id,'manufacturer')
            """), ctx)
        await self.db.execute(text("""
            INSERT INTO manufacturer_onboarding
              (organization_id,current_step,personal_information_completed,company_information_completed,
               completion_percentage,status)
            VALUES (:organization_id,'company_information',true,true,15,'in_progress')
            ON CONFLICT (organization_id) DO UPDATE SET personal_information_completed=true,
              company_information_completed=true,current_step='company_information',
              completion_percentage=GREATEST(manufacturer_onboarding.completion_percentage,15),
              status='in_progress',version=manufacturer_onboarding.version+1
        """), ctx)
        await self.db.commit()

    async def add_file(self, ctx: dict, uploaded: UploadedObject, purpose: str) -> tuple[UUID, str]:
        file_id = await self.db.scalar(text("""
            INSERT INTO files
              (organization_id,uploaded_by_user_id,object_key,filename,content_type,size_bytes,
               checksum,classification,scan_status,purpose)
            VALUES (:organization_id,:user_id,:key,:filename,:content_type,:size,:checksum,'public','clean',:purpose)
            RETURNING id
        """), {**ctx, "key": uploaded.object_key, "filename": uploaded.filename,
                "content_type": uploaded.content_type, "size": uploaded.size_bytes,
                "checksum": uploaded.checksum, "purpose": purpose})
        return file_id, uploaded.public_url

    async def save_profile(self, actor: Actor, data: dict, asset_ids: dict[str, tuple[UUID, str]], machine_assets: list = []):
        ctx = await self.context(actor)
        company, location = data["company"], data["location"]
        logo_id = asset_ids.get("logo", (None, None))[0]
        cover_id = asset_ids.get("cover", (None, None))[0]
        await self.db.execute(text("""
            UPDATE organizations SET display_name=:name,description=:about,updated_at=now(),version=version+1
            WHERE id=:organization_id
        """), {"name": company.get("name"), "about": company.get("about"), **ctx})
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
        """), {**ctx, "logo": logo_id, "cover": cover_id, "about": company.get("about") or None,
                "vision": company.get("vision") or None, "year": int(company["estYear"]) if str(company.get("estYear", "")).isdigit() else None,
                "employees": int(company["employees"]) if str(company.get("employees", "")).isdigit() else None,
                "business": company.get("businessType") or None, "size": company.get("orgSize") or None})
        country = COUNTRY_CODES.get(str(location.get("country", "")).lower())
        facility_id = await self.db.scalar(text("""
            INSERT INTO facilities
              (organization_id,name,facility_type,address,address_line1,city,state_province,country_code,
               postal_code,is_headquarters,sez_status,serviceable_areas,status,visibility)
            VALUES (:organization_id,:name,'factory',:address,:address,:city,:state,:country,:zip,true,
                    :sez,:areas,'draft','private')
            ON CONFLICT (organization_id) WHERE is_headquarters=true AND status<>'suspended'
            DO UPDATE SET address=EXCLUDED.address,address_line1=EXCLUDED.address_line1,city=EXCLUDED.city,
              state_province=EXCLUDED.state_province,country_code=EXCLUDED.country_code,
              postal_code=EXCLUDED.postal_code,sez_status=EXCLUDED.sez_status,
              serviceable_areas=EXCLUDED.serviceable_areas
            RETURNING id
        """), {**ctx, "name": f'{company.get("name") or "Manufacturer"} Headquarters',
                "address": location.get("address") or None, "city": location.get("city") or None,
                "state": location.get("state") or None, "country": country, "zip": location.get("zip") or None,
                "sez": location.get("sez") or None, "areas": location.get("serviceableAreas", [])})
        await self._replace_certifications(ctx, facility_id, data.get("certifications", []))
        await self._replace_infrastructure(ctx, facility_id, data.get("infra", {}))
        await self._replace_faqs(ctx, facility_id, data.get("faqs", []))
        flags = self._profile_flags(data)
        pct = round(15 + sum(flags.values()) / 5 * 85)
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
              status='in_progress',version=manufacturer_onboarding.version+1
        """), {**ctx, **flags, "step": "completed" if all(flags.values()) else "company_information", "pct": pct})
        await self.db.commit()

    @staticmethod
    def _profile_flags(data: dict):
        c, loc = data["company"], data["location"]
        return {"company": bool(c.get("name") and c.get("about")),
                "location": bool(loc.get("address") and loc.get("city") and loc.get("country")),
                "certs": bool(data.get("certifications")),
                "infra": any(data.get("infra", {}).values()), "faq": bool(data.get("faqs"))}

    async def _replace_certifications(self, ctx: dict, facility_id: UUID, items: list[dict]):
        await self.db.execute(text("DELETE FROM organization_certifications WHERE organization_id=:organization_id AND status='declared'"), ctx)
        for item in items:
            code = slug(item.get("name", "Certification"))
            cert_type = await self.db.scalar(text("""
                INSERT INTO certification_types(code,name,issuer) VALUES (:code,:name,:issuer)
                ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id
            """), {"code": code, "name": item.get("name") or code, "issuer": item.get("body") or None})
            await self.db.execute(text("""
                INSERT INTO organization_certifications
                  (organization_id,facility_id,certification_type_id,issuer,status)
                VALUES (:organization_id,:facility,:type,:issuer,'declared')
            """), {**ctx, "facility": facility_id, "type": cert_type, "issuer": item.get("body") or None})

    async def _replace_infrastructure(self, ctx: dict, facility_id: UUID, values: dict):
        mapping = {"electricity": "electricity", "water": "water", "storage": "storage",
                   "packaging": "packing", "waste": "waste_disposal", "qa": "quality_assurance"}
        for code, category in mapping.items():
            item_id = await self.db.scalar(text("""
                INSERT INTO infrastructure_items(code,name,category,answer_type)
                VALUES (:code,:name,:category,'text')
                ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id
            """), {"code": code, "name": code.replace("_", " ").title(), "category": category})
            await self.db.execute(text("""
                INSERT INTO manufacturer_infrastructure
                  (organization_id,facility_id,infrastructure_item_id,text_value,updated_by_membership_id)
                VALUES (:organization_id,:facility,:item,:value,:membership_id)
                ON CONFLICT (organization_id,facility_id,infrastructure_item_id)
                DO UPDATE SET text_value=EXCLUDED.text_value,
                  updated_by_membership_id=EXCLUDED.updated_by_membership_id,version=manufacturer_infrastructure.version+1
            """), {**ctx, "facility": facility_id, "item": item_id, "value": values.get(code) or None})

    async def _replace_faqs(self, ctx: dict, facility_id: UUID, faqs: list[dict]):
        for position, faq in enumerate(faqs):
            code = f"CUSTOM_{slug(faq.get('q','QUESTION'))}"
            question_id = await self.db.scalar(text("""
                INSERT INTO manufacturer_faq_questions
                  (question_code,question_text,answer_type,display_order)
                VALUES (:code,:question,'text',:position)
                ON CONFLICT (question_code) DO UPDATE SET question_text=EXCLUDED.question_text RETURNING id
            """), {"code": code, "question": faq.get("q"), "position": position})
            await self.db.execute(text("""
                INSERT INTO manufacturer_faq_answers
                  (organization_id,facility_id,question_id,text_value,answered_by_membership_id)
                VALUES (:organization_id,:facility,:question,:answer,:membership_id)
                ON CONFLICT (organization_id,facility_id,question_id)
                DO UPDATE SET text_value=EXCLUDED.text_value,
                  answered_by_membership_id=EXCLUDED.answered_by_membership_id,
                  version=manufacturer_faq_answers.version+1
            """), {**ctx, "facility": facility_id, "question": question_id, "answer": faq.get("a")})

    async def create_machinery(self, actor: Actor, data: dict, uploaded_images: list[tuple[UploadedObject, bool]]):
        ctx = await self.context(actor)
        code = slug(data["type"])
        term_id = await self.db.scalar(text("""
            INSERT INTO taxonomy_terms(term_type,term,code,status)
            VALUES ('machinery',:term,:code,'active')
            ON CONFLICT (term_type,code,taxonomy_version) DO UPDATE SET term=EXCLUDED.term
            RETURNING id
        """), {"term": data["type"], "code": code})
        status = "active" if data["status"] != "Archived" else "archived"
        publication = {"Draft": "draft", "Published": "published", "Unpublished": "hidden", "Archived": "hidden"}[data["status"]]
        machine_id = await self.db.scalar(text("""
            INSERT INTO machines
              (organization_id,machinery_term_id,name,description,status,publication_status)
            VALUES (:organization_id,:term,:name,:description,:status,:publication) RETURNING id
        """), {**ctx, "term": term_id, "name": data["type"], "description": data.get("technical") or None,
                "status": status, "publication": publication})
        specs = {k: v for k, v in data.items() if k not in {"images", "type", "status", "technical"}}
        for key, value in specs.items():
            await self.db.execute(text("""
                INSERT INTO machine_specs(machine_id,spec_code,value_text)
                VALUES (:machine,:code,:value)
            """), {"machine": machine_id, "code": key, "value": json.dumps(value) if isinstance(value, (dict, list)) else str(value)})
        for order, (uploaded, primary) in enumerate(uploaded_images):
            file_id, _ = await self.add_file(ctx, uploaded, "machine_image")
            await self.db.execute(text("""
                INSERT INTO machine_images(machine_id,file_id,display_order,alt_text)
                VALUES (:machine,:file,:order,:alt)
            """), {"machine": machine_id, "file": file_id, "order": 0 if primary else order + 1,
                    "alt": data["type"]})
        await self.db.commit()
        return str(machine_id)

    async def set_machinery_status(self, actor: Actor, machine_id: str, display_status: str):
        ctx = await self.context(actor)
        status = "archived" if display_status == "Archived" else "active"
        publication = {"Draft": "draft", "Published": "published", "Unpublished": "hidden", "Archived": "hidden"}[display_status]
        result = await self.db.execute(text("""
            UPDATE machines SET status=:status,publication_status=:publication,version=version+1
            WHERE id=CAST(:id AS uuid) AND organization_id=:organization_id RETURNING id
        """), {**ctx, "id": machine_id, "status": status, "publication": publication})
        if not result.first():
            raise LookupError("Machinery listing not found")
        await self.db.commit()

    async def save_availability(self, actor: Actor, data: dict):
        ctx = await self.context(actor)
        await self.db.execute(text("""
            INSERT INTO manufacturer_availability_preferences
              (organization_id,calendar,recurring,capacity,updated_by_user_id)
            VALUES (:organization_id,CAST(:calendar AS jsonb),CAST(:recurring AS jsonb),
                    CAST(:capacity AS jsonb),:user_id)
            ON CONFLICT (organization_id) DO UPDATE SET calendar=EXCLUDED.calendar,
              recurring=EXCLUDED.recurring,capacity=EXCLUDED.capacity,updated_by_user_id=:user_id
        """), {**ctx, "calendar": json.dumps(data.get("calendar", {})),
                "recurring": json.dumps(data.get("recurring")), "capacity": json.dumps(data.get("capacity"))})
        await self.db.commit()

    async def update_booking(self, actor: Actor, booking_id: str, decision: str):
        ctx = await self.context(actor)
        status = "accepted" if decision == "accepted" else "declined"
        result = await self.db.execute(text("""
            UPDATE manufacturer_booking_requests
            SET status=:status,responded_by_membership_id=:membership_id,responded_at=now(),version=version+1
            WHERE id=CAST(:id AS uuid) AND manufacturer_organization_id=:organization_id
              AND status IN ('new','returned','confirmation_pending') RETURNING id
        """), {**ctx, "id": booking_id, "status": status})
        if not result.first():
            raise LookupError("Open booking request not found")
        await self.db.commit()

    async def snapshot(self, actor: Actor) -> dict:
        ctx = await self.context(actor)
        profile = (await self.db.execute(text("""
            SELECT o.display_name,op.company_category,op.stated_production_capacity,
                   op.about_company,op.vision,op.establishment_year,op.employee_count,
                   op.business_type,op.organization_size,
                   f.id facility_id,f.address_line1,f.city,f.state_province,
                   f.country_code,f.postal_code,f.sez_status,f.serviceable_areas,
                   c.name country_name,logo.object_key logo_object_key,cover.object_key cover_object_key,
                   mo.company_information_completed,mo.location_completed,mo.certification_completed,
                   mo.infrastructure_completed,mo.faq_completed,mo.completion_percentage
            FROM organizations o
            LEFT JOIN organization_profiles op ON op.organization_id=o.id
            LEFT JOIN facilities f ON f.organization_id=o.id AND f.is_headquarters=true AND f.status<>'suspended'
            LEFT JOIN countries c ON c.code=f.country_code
            LEFT JOIN files logo ON logo.id=op.logo_file_id
            LEFT JOIN files cover ON cover.id=op.cover_file_id
            LEFT JOIN manufacturer_onboarding mo ON mo.organization_id=o.id
            WHERE o.id=:organization_id
        """), ctx)).first()
        certs = await self.db.execute(text("""
            SELECT ct.name,COALESCE(oc.issuer,ct.issuer) body,oc.status
            FROM organization_certifications oc JOIN certification_types ct ON ct.id=oc.certification_type_id
            WHERE oc.organization_id=:organization_id ORDER BY oc.created_at
        """), ctx)
        infra = await self.db.execute(text("""
            SELECT ii.code,mi.text_value FROM manufacturer_infrastructure mi
            JOIN infrastructure_items ii ON ii.id=mi.infrastructure_item_id
            WHERE mi.organization_id=:organization_id
        """), ctx)
        faqs = await self.db.execute(text("""
            SELECT q.question_text q,a.text_value a FROM manufacturer_faq_answers a
            JOIN manufacturer_faq_questions q ON q.id=a.question_id
            WHERE a.organization_id=:organization_id ORDER BY q.display_order
        """), ctx)
        machines = await self.db.execute(text("""
            SELECT m.id,m.name,m.description,m.status,m.publication_status,
                   COALESCE(jsonb_object_agg(ms.spec_code,ms.value_text) FILTER (WHERE ms.spec_code IS NOT NULL),'{}') specs
            FROM machines m LEFT JOIN machine_specs ms ON ms.machine_id=m.id
            WHERE m.organization_id=:organization_id GROUP BY m.id ORDER BY m.created_at DESC
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
        return {"context": ctx, "profile": dict(profile._mapping) if profile else {},
                "certifications": [dict(r._mapping) for r in certs],
                "infrastructure": {r.code: r.text_value or "" for r in infra},
                "faqs": [dict(r._mapping) for r in faqs], "machines": [dict(r._mapping) for r in machines],
                "images": [dict(r._mapping) for r in images],
                "availability": dict(availability._mapping) if availability else {},
                "bookings": [dict(r._mapping) for r in bookings]}
