"""Database access for the Visionaries portal.

Every query that reads or changes a Visionary's own data is scoped by the signed-in
user's id (record ownership). Manufacturer data is only read, and only the public
fields of manufacturers that are discoverable (see DISCOVERABLE).
"""
import secrets
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# A manufacturer is listed for Visionaries once its account details are saved (the same
# moment the Manufacturer portal made it discoverable), while the organization is active,
# not archived by an admin, not a TEST record, not rejected in review, and its owner's
# account is not suspended.
DISCOVERABLE = """
    FROM organizations o
    JOIN manufacturer_onboarding mo ON mo.organization_id = o.id
         AND mo.personal_information_completed AND mo.status <> 'rejected'
    JOIN LATERAL (
        SELECT u.status FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = o.id AND m.status = 'active'
        ORDER BY (m.membership_role = 'owner') DESC, m.created_at LIMIT 1
    ) owner_user ON owner_user.status = 'active'
    LEFT JOIN organization_profiles op ON op.organization_id = o.id
    LEFT JOIN facilities f ON f.organization_id = o.id AND f.is_headquarters AND f.status <> 'suspended'
    LEFT JOIN files logo ON logo.id = op.logo_file_id
    WHERE o.organization_type = 'manufacturer' AND o.status = 'active'
      AND NOT o.is_archived AND o.record_type <> 'TEST'
"""

ORG_COLUMNS = """
    o.id, o.display_name, o.verification_status, op.company_category, op.about_company,
    op.stated_production_capacity, op.production_capacity_label, op.business_type,
    op.organization_size, op.employee_count, op.establishment_year,
    COALESCE(f.country_name, op.country_name) country, f.city, f.state_province,
    logo.object_key logo_object_key
"""


def _uuid(value: str) -> UUID | None:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def request_number() -> str:
    return f"REQ-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(3).upper()}"


class VisionaryRepository:
    def __init__(self, session: AsyncSession):
        self.db = session

    # ------------------------------------------------------------------ identity
    async def user_row(self, user_id: UUID) -> dict:
        row = (await self.db.execute(text(
            "SELECT id, display_name, email FROM users WHERE id=:u"), {"u": user_id})).mappings().first()
        return dict(row) if row else {}

    async def organization_id(self, user_id: UUID) -> UUID | None:
        """The Visionary's own 'buyer' organization, if it exists yet."""
        org = await self.db.scalar(text(
            "SELECT organization_id FROM visionary_profiles WHERE user_id=:u"), {"u": user_id})
        if org:
            return org
        return await self.db.scalar(text("""
            SELECT o.id FROM organizations o
            JOIN memberships m ON m.organization_id=o.id AND m.user_id=:u AND m.status='active'
            WHERE o.organization_type='buyer' AND o.created_by_user_id=:u AND o.status<>'closed'
            ORDER BY o.created_at LIMIT 1
        """), {"u": user_id})

    async def ensure_organization(self, user_id: UUID, display_name: str) -> UUID:
        """Creates the Visionary's buyer organization + owner membership on first save,
        and records the 'visionary' persona (demand_requester) for the user."""
        await self.db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
                              {"k": f"xy-visionary-org:{user_id}"})
        org_id = await self.organization_id(user_id)
        if org_id is None:
            org_id = await self.db.scalar(text("""
                INSERT INTO organizations(display_name, organization_type, status, created_by_user_id)
                VALUES (:name, 'buyer', 'active', :u) RETURNING id
            """), {"name": display_name or "Visionary", "u": user_id})
            await self.db.execute(text("""
                INSERT INTO memberships(user_id, organization_id, membership_role, status, accepted_at)
                VALUES (:u, :o, 'owner', 'active', now())
                ON CONFLICT (organization_id, user_id) DO UPDATE SET status='active'
            """), {"u": user_id, "o": org_id})
        await self.db.execute(text("""
            INSERT INTO marketplace_role_selections(user_id, role_selected, status)
            SELECT :u, 'demand_requester', 'active'
            WHERE NOT EXISTS (SELECT 1 FROM marketplace_role_selections
                              WHERE user_id=:u AND role_selected='demand_requester' AND status='active')
        """), {"u": user_id})
        return org_id

    # ------------------------------------------------------------------ profile
    async def profile(self, user_id: UUID) -> dict | None:
        row = (await self.db.execute(text("""
            SELECT full_name, role_title, organization_name, location, introduction
            FROM visionary_profiles WHERE user_id=:u
        """), {"u": user_id})).mappings().first()
        return dict(row) if row else None

    async def save_profile(self, user_id: UUID, data: dict) -> None:
        display = data["org"] or data["name"]
        org_id = await self.ensure_organization(user_id, display)
        await self.db.execute(text("""
            INSERT INTO visionary_profiles(user_id, organization_id, full_name, role_title,
                                           organization_name, location, introduction)
            VALUES (:u, :o, :name, :role, NULLIF(:org,''), :location, NULLIF(:intro,''))
            ON CONFLICT (user_id) DO UPDATE SET full_name=EXCLUDED.full_name,
              role_title=EXCLUDED.role_title, organization_name=EXCLUDED.organization_name,
              location=EXCLUDED.location, introduction=EXCLUDED.introduction
        """), {"u": user_id, "o": org_id, **data})
        # The organization's name is what manufacturers see as the requester.
        await self.db.execute(text("""
            UPDATE organizations SET display_name=:name, primary_geography=:location, updated_at=now()
            WHERE id=:o AND organization_type='buyer'
        """), {"o": org_id, "name": display, "location": data["location"]})
        await self.db.commit()

    # ------------------------------------------------------------------ project
    async def project(self, user_id: UUID) -> dict | None:
        """The Visionary's current (most recent) project."""
        row = (await self.db.execute(text("""
            SELECT vp.*, op.title project_name, op.narrative idea_description, op.status opportunity_status
            FROM visionary_projects vp JOIN opportunities op ON op.id=vp.opportunity_id
            WHERE vp.user_id=:u AND op.status NOT IN ('closed','cancelled')
            ORDER BY vp.created_at DESC LIMIT 1
        """), {"u": user_id})).mappings().first()
        return dict(row) if row else None

    async def _ensure_project(self, user_id: UUID, title: str) -> dict | None:
        current = await self.project(user_id)
        if current or not title:
            return current
        user = await self.user_row(user_id)
        org_id = await self.ensure_organization(user_id, user.get("display_name") or "Visionary")
        opportunity_id = await self.db.scalar(text("""
            INSERT INTO opportunities(organization_id, created_by_user_id, owner_user_id, title, status)
            VALUES (:o, :u, :u, :title, 'draft') RETURNING id
        """), {"o": org_id, "u": user_id, "title": title})
        await self.db.execute(text("""
            INSERT INTO visionary_projects(opportunity_id, user_id) VALUES (:op, :u)
        """), {"op": opportunity_id, "u": user_id})
        return await self.project(user_id)

    async def save_idea(self, user_id: UUID, data: dict, complete: bool) -> None:
        project = await self._ensure_project(user_id, data["project"])
        if project is None:  # "Previous" before any project name was typed: nothing to keep
            await self.db.commit()
            return
        await self.db.execute(text("""
            UPDATE opportunities SET title=COALESCE(NULLIF(:title,''), title),
              narrative=NULLIF(:idea,''), updated_at=now(), version=version+1
            WHERE id=:op AND owner_user_id=:u
        """), {"op": project["opportunity_id"], "u": user_id, "title": data["project"], "idea": data["idea"]})
        await self.db.execute(text("""
            UPDATE visionary_projects SET product=NULLIF(:product,''), industry=NULLIF(:industry,''),
              idea_saved_at=CASE WHEN :complete THEN now() ELSE idea_saved_at END
            WHERE id=:id AND user_id=:u
        """), {"id": project["id"], "u": user_id, "product": data["product"],
               "industry": data["industry"], "complete": complete})
        await self.db.commit()

    async def save_stage(self, user_id: UUID, stage: str) -> None:
        project = await self.project(user_id)
        if project is None:
            raise LookupError("Tell us about your idea first")
        await self.db.execute(text("""
            UPDATE visionary_projects SET project_stage=:stage, stage_saved_at=now()
            WHERE id=:id AND user_id=:u
        """), {"id": project["id"], "u": user_id, "stage": stage})
        await self.db.commit()

    async def save_requirements(self, user_id: UUID, data: dict, complete: bool) -> None:
        project = await self.project(user_id)
        if project is None:
            raise LookupError("Tell us about your idea first")
        await self.db.execute(text("""
            UPDATE visionary_projects SET manufacturing_location=NULLIF(:location,''),
              quantity=NULLIF(:quantity,0), budget_amount=NULLIF(:budget,0), timeline=NULLIF(:timeline,''),
              additional_requirements=NULLIF(:additional,''),
              requirements_saved_at=CASE WHEN :complete THEN now() ELSE requirements_saved_at END
            WHERE id=:id AND user_id=:u
        """), {"id": project["id"], "u": user_id, "location": data["manufacturing_location"],
               "quantity": data["quantity"]["value"], "budget": data["budget"]["amount"],
               "timeline": data["timeline"], "additional": data["additional_requirements"],
               "complete": complete})
        if complete:
            await self.db.execute(text("""
                UPDATE opportunities SET status='active', updated_at=now()
                WHERE id=:op AND owner_user_id=:u AND status IN ('draft','structuring')
            """), {"op": project["opportunity_id"], "u": user_id})
        await self.db.commit()

    # ------------------------------------------------------------------ manufacturers
    async def manufacturers(self, org_id: str | None = None) -> list[dict]:
        sql = f"SELECT {ORG_COLUMNS} {DISCOVERABLE}"
        params: dict = {}
        if org_id is not None:
            sql += " AND o.id = :org"
            params["org"] = org_id
        sql += " ORDER BY o.display_name, o.id"
        return [dict(r) for r in (await self.db.execute(text(sql), params)).mappings()]

    async def manufacturer_details(self, org_ids: list[UUID]) -> dict:
        """Published machinery, certifications and availability for the given manufacturers."""
        if not org_ids:
            return {"machines": [], "certs": [], "availability": []}
        p = {"ids": org_ids}
        machines = await self.db.execute(text("""
            SELECT m.organization_id, m.id, m.name, m.description,
                   COALESCE(jsonb_object_agg(ms.spec_code, ms.value_text)
                            FILTER (WHERE ms.spec_code IS NOT NULL), '{}'::jsonb) specs,
                   (SELECT f.object_key FROM machine_images mi JOIN files f ON f.id=mi.file_id
                    WHERE mi.machine_id=m.id ORDER BY mi.display_order LIMIT 1) image_key
            FROM machines m LEFT JOIN machine_specs ms ON ms.machine_id=m.id
            WHERE m.organization_id = ANY(:ids) AND m.publication_status='published' AND m.status<>'archived'
            GROUP BY m.id ORDER BY m.created_at, m.id
        """), p)
        certs = await self.db.execute(text("""
            SELECT oc.organization_id, ct.name, COALESCE(oc.issuer, ct.issuer) body, oc.status
            FROM organization_certifications oc JOIN certification_types ct ON ct.id=oc.certification_type_id
            WHERE oc.organization_id = ANY(:ids) ORDER BY oc.created_at, oc.id
        """), p)
        availability = await self.db.execute(text("""
            SELECT organization_id, calendar, recurring, capacity
            FROM manufacturer_availability_preferences WHERE organization_id = ANY(:ids)
        """), p)
        return {"machines": [dict(r) for r in machines.mappings()],
                "certs": [dict(r) for r in certs.mappings()],
                "availability": [dict(r) for r in availability.mappings()]}

    async def is_member_of(self, user_id: UUID, org_id: UUID) -> bool:
        return bool(await self.db.scalar(text("""
            SELECT EXISTS(SELECT 1 FROM memberships WHERE user_id=:u AND organization_id=:o AND status='active')
        """), {"u": user_id, "o": org_id}))

    # ------------------------------------------------------------------ drafts
    async def draft(self, user_id: UUID, org_id: UUID) -> dict | None:
        row = (await self.db.execute(text("""
            SELECT machine_name, quantity, required_duration, manufacturing_location, budget_amount,
                   timeline, additional_requirements, updated_at
            FROM visionary_request_drafts WHERE user_id=:u AND manufacturer_organization_id=:o
        """), {"u": user_id, "o": org_id})).mappings().first()
        return dict(row) if row else None

    async def save_draft(self, user_id: UUID, org_id: UUID, data: dict) -> None:
        await self.db.execute(text("""
            INSERT INTO visionary_request_drafts(user_id, manufacturer_organization_id, machine_name, quantity,
              required_duration, manufacturing_location, budget_amount, timeline, additional_requirements)
            VALUES (:u, :o, NULLIF(:machine,''), NULLIF(:quantity,0), NULLIF(:duration,''), NULLIF(:location,''),
                    NULLIF(:budget,0), NULLIF(:timeline,''), NULLIF(:additional,''))
            ON CONFLICT (user_id, manufacturer_organization_id) DO UPDATE SET
              machine_name=EXCLUDED.machine_name, quantity=EXCLUDED.quantity,
              required_duration=EXCLUDED.required_duration, manufacturing_location=EXCLUDED.manufacturing_location,
              budget_amount=EXCLUDED.budget_amount, timeline=EXCLUDED.timeline,
              additional_requirements=EXCLUDED.additional_requirements
        """), {"u": user_id, "o": org_id, "machine": data["machine"], "quantity": data["quantity"]["value"],
               "duration": data["required_duration"], "location": data["manufacturing_location"],
               "budget": data["budget"]["amount"], "timeline": data["timeline"],
               "additional": data["additional_requirements"]})
        await self.db.commit()

    # ------------------------------------------------------------------ requests
    async def create_request(self, user_id: UUID, org_id: UUID, project: dict, manufacturer: dict,
                             visionary_name: str, data: dict, machine_id: UUID | None) -> UUID:
        demand_org = await self.ensure_organization(user_id, visionary_name)
        engagement_id = await self.db.scalar(text("""
            INSERT INTO engagements(opportunity_id, demand_organization_id, supply_organization_id,
                                    request_type, type, status, created_by_user_id)
            VALUES (:op, :demand, :supply, 'availability_request', 'sourcing', 'sent', :u) RETURNING id
        """), {"op": project["opportunity_id"], "demand": demand_org, "supply": org_id, "u": user_id})
        await self.db.execute(text("""
            INSERT INTO engagement_participants(engagement_id, organization_id, user_id, role)
            VALUES (:e, :demand, :u, 'demand'), (:e, :supply, NULL, 'supply')
        """), {"e": engagement_id, "demand": demand_org, "supply": org_id, "u": user_id})
        quantity = data["quantity"]["value"]
        # What the Manufacturer dashboard shows in its booking list ("item").
        summary = f'{data["machine"]} — {project["project_name"]} ({quantity:,} units)'
        request_id = await self.db.scalar(text("""
            INSERT INTO manufacturer_booking_requests(request_number, engagement_id, demand_organization_id,
              manufacturer_organization_id, requested_by_user_id, requested_capacity, unit_code,
              requirements, status)
            VALUES (:number, :e, :demand, :supply, :u, :quantity, 'units', :summary, 'new') RETURNING id
        """), {"number": request_number(), "e": engagement_id, "demand": demand_org, "supply": org_id,
               "u": user_id, "quantity": quantity, "summary": summary})
        await self.db.execute(text("""
            INSERT INTO visionary_request_details(booking_request_id, project_id, machine_name, machine_id,
              required_duration, manufacturing_location, budget_amount, timeline, additional_requirements,
              project_name, visionary_name)
            VALUES (:r, :project, :machine, :machine_id, :duration, :location, :budget, :timeline,
                    NULLIF(:additional,''), :project_name, :visionary)
        """), {"r": request_id, "project": project["id"], "machine": data["machine"], "machine_id": machine_id,
               "duration": data["required_duration"], "location": data["manufacturing_location"],
               "budget": data["budget"]["amount"], "timeline": data["timeline"],
               "additional": data["additional_requirements"], "project_name": project["project_name"],
               "visionary": visionary_name})
        await self.db.execute(text("""
            DELETE FROM visionary_request_drafts WHERE user_id=:u AND manufacturer_organization_id=:o
        """), {"u": user_id, "o": org_id})
        await self.db.execute(text("""
            UPDATE opportunities SET status='matched', updated_at=now()
            WHERE id=:op AND owner_user_id=:u AND status IN ('draft','structuring','active')
        """), {"op": project["opportunity_id"], "u": user_id})
        await self.db.commit()
        return request_id

    async def requests(self, user_id: UUID, request_id: UUID | None = None) -> list[dict]:
        """The Visionary's own requests, oldest first (the screens show the latest)."""
        sql = """
            SELECT br.id, br.request_number, br.manufacturer_organization_id, br.requested_capacity,
                   br.status, br.created_at, o.display_name manufacturer_name, d.machine_name,
                   d.required_duration, d.manufacturing_location, d.budget_amount, d.budget_currency,
                   d.timeline, d.additional_requirements, d.project_name, d.visionary_name
            FROM manufacturer_booking_requests br
            JOIN visionary_request_details d ON d.booking_request_id=br.id
            JOIN organizations o ON o.id=br.manufacturer_organization_id
            WHERE br.requested_by_user_id=:u
        """
        params: dict = {"u": user_id}
        if request_id is not None:
            sql += " AND br.id=:id"
            params["id"] = request_id
        sql += " ORDER BY br.created_at, br.id"
        return [dict(r) for r in (await self.db.execute(text(sql), params)).mappings()]
