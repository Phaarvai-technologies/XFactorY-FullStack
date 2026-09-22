import re
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

COUNTRY_CODES = {
    "India": "IN", "United States": "US", "United Kingdom": "GB",
    "United Arab Emirates": "AE", "Germany": "DE", "China": "CN",
    "Vietnam": "VN", "Bangladesh": "BD", "Other": "ZZ",
}


def _capacity_number(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"\d+(?:\.\d+)?", value.replace(",", ""))
    return float(match.group()) if match else None


async def save_manufacturer_account(
    session: AsyncSession,
    *,
    user_id: UUID,
    clerk_org_id: str,
    payload,
) -> UUID:
    await session.execute(
        text("""
            UPDATE users SET
                first_name = :first_name,
                last_name = :last_name,
                display_name = :display_name,
                date_of_birth = :dob,
                phone = COALESCE(:phone, phone),
                updated_at = now()
            WHERE id = :user_id
        """),
        {
            "user_id": user_id,
            "first_name": payload.first_name,
            "last_name": payload.last_name,
            "display_name": f"{payload.first_name} {payload.last_name}",
            "dob": payload.date_of_birth,
            "phone": payload.phone,
        },
    )
    result = await session.execute(
        text("""
            INSERT INTO organizations (
                clerk_organization_id, display_name, legal_name,
                organization_type, primary_geography, status, created_by_user_id
            ) VALUES (
                :clerk_org_id, :company_name, :company_name,
                'manufacturer', :country, 'active', :user_id
            )
            ON CONFLICT (clerk_organization_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                legal_name = COALESCE(organizations.legal_name, EXCLUDED.legal_name),
                primary_geography = EXCLUDED.primary_geography,
                updated_at = now()
            RETURNING id
        """),
        {
            "clerk_org_id": clerk_org_id,
            "company_name": payload.company_name,
            "country": payload.country,
            "user_id": user_id,
        },
    )
    organization_id = result.scalar_one()
    await session.execute(
        text("""
            INSERT INTO memberships (
                user_id, organization_id, membership_role, status, accepted_at
            ) VALUES (:user_id, :organization_id, 'owner', 'active', now())
            ON CONFLICT (organization_id, user_id) DO UPDATE SET
                membership_role = 'owner', status = 'active',
                accepted_at = COALESCE(memberships.accepted_at, now()),
                version = memberships.version + 1
        """),
        {"user_id": user_id, "organization_id": organization_id},
    )
    await session.execute(
        text("""
            INSERT INTO organization_profiles (
                organization_id, contact_email, contact_phone, country_code,
                company_category, stated_production_capacity
            ) VALUES (
                :organization_id,
                CASE WHEN :contact LIKE '%@%' THEN :contact ELSE NULL END,
                COALESCE(:phone, CASE WHEN :contact NOT LIKE '%@%' THEN :contact ELSE NULL END),
                :country_code, :category, :capacity
            )
            ON CONFLICT (organization_id) DO UPDATE SET
                contact_email = EXCLUDED.contact_email,
                contact_phone = EXCLUDED.contact_phone,
                country_code = EXCLUDED.country_code,
                company_category = EXCLUDED.company_category,
                stated_production_capacity = EXCLUDED.stated_production_capacity,
                updated_at = now()
        """),
        {
            "organization_id": organization_id,
            "contact": payload.contact,
            "phone": payload.phone,
            "country_code": COUNTRY_CODES.get(payload.country, "ZZ"),
            "category": payload.company_category,
            "capacity": _capacity_number(payload.production_capacity),
        },
    )
    await session.execute(
        text("""
            INSERT INTO manufacturer_onboarding (
                organization_id, current_step, personal_information_completed,
                company_information_completed, completion_percentage, status
            ) VALUES (
                :organization_id, 'location', TRUE, TRUE, 35, 'in_progress'
            )
            ON CONFLICT (organization_id) DO UPDATE SET
                personal_information_completed = TRUE,
                company_information_completed = TRUE,
                completion_percentage = GREATEST(manufacturer_onboarding.completion_percentage, 35),
                status = 'in_progress', updated_at = now(),
                version = manufacturer_onboarding.version + 1
        """),
        {"organization_id": organization_id},
    )
    return organization_id


async def get_manufacturer_account(
    session: AsyncSession,
    *,
    user_id: UUID,
    clerk_org_id: str | None,
):
    if not clerk_org_id:
        return None
    result = await session.execute(
        text("""
            SELECT
                o.id AS organization_id,
                o.clerk_organization_id,
                o.display_name AS company_name,
                o.status AS organization_status,
                op.company_category,
                op.country_code,
                op.contact_email,
                op.contact_phone,
                op.stated_production_capacity,
                mo.current_step,
                mo.completion_percentage,
                mo.status,
                mo.updated_at
            FROM organizations o
            JOIN memberships m
              ON m.organization_id = o.id
             AND m.user_id = :user_id
             AND m.status = 'active'
            LEFT JOIN organization_profiles op ON op.organization_id = o.id
            LEFT JOIN manufacturer_onboarding mo ON mo.organization_id = o.id
            WHERE o.clerk_organization_id = :clerk_org_id
              AND o.organization_type = 'manufacturer'
            LIMIT 1
        """),
        {"user_id": user_id, "clerk_org_id": clerk_org_id},
    )
    return result.mappings().one_or_none()
