from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# Frontend persona ids (src/types/personas.ts) -> marketplace_role_selections.role_selected
PERSONA_TO_DB_ROLE = {
    "manufacturer": "manufacturer",
    "visionary": "demand_requester",
    "vendor": "vendor",
    "logistics_provider": "logistics_provider",
    "labour_supplier": "labor_supplier",
    "legal_writer": "legal_compliance",
    "investor": "investor",
    "market_lead": "market_lead",
}
DB_ROLE_TO_PERSONA = {v: k for k, v in PERSONA_TO_DB_ROLE.items()}


async def upsert_user(
    session: AsyncSession,
    *,
    clerk_user_id: str,
    email: str,
    display_name: str,
    first_name: str | None = None,
    last_name: str | None = None,
    email_verified: bool = False,
) -> UUID:
    result = await session.execute(
        text("""
            INSERT INTO users (
                clerk_user_id, email, display_name, first_name, last_name, status
            ) VALUES (
                :clerk_user_id, :email, :display_name, :first_name, :last_name, 'active'
            )
            ON CONFLICT (clerk_user_id) DO UPDATE SET
                email = EXCLUDED.email,
                display_name = EXCLUDED.display_name,
                first_name = COALESCE(EXCLUDED.first_name, users.first_name),
                last_name = COALESCE(EXCLUDED.last_name, users.last_name),
                status = 'active',
                updated_at = now()
            RETURNING id
        """),
        {
            "clerk_user_id": clerk_user_id,
            "email": email,
            "display_name": display_name or email,
            "first_name": first_name,
            "last_name": last_name,
        },
    )
    user_id = result.scalar_one()
    await session.execute(
        text("""
            INSERT INTO user_auth_identities (
                user_id, provider, provider_subject, contact_verified_at,
                last_authenticated_at
            ) VALUES (
                :user_id, 'clerk', :subject,
                CASE WHEN :verified THEN now() ELSE NULL END, now()
            )
            ON CONFLICT (provider, provider_subject) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                contact_verified_at = COALESCE(
                    user_auth_identities.contact_verified_at,
                    EXCLUDED.contact_verified_at
                ),
                last_authenticated_at = now()
        """),
        {"user_id": user_id, "subject": clerk_user_id, "verified": email_verified},
    )
    return user_id


async def get_user_by_clerk_id(session: AsyncSession, clerk_user_id: str):
    result = await session.execute(
        text("""
            SELECT id, clerk_user_id, email, display_name, first_name, last_name,
                   phone, status, created_at, updated_at
            FROM users
            WHERE clerk_user_id = :clerk_user_id
        """),
        {"clerk_user_id": clerk_user_id},
    )
    return result.mappings().one_or_none()


async def deactivate_user(session: AsyncSession, clerk_user_id: str) -> None:
    await session.execute(
        text("""
            UPDATE users
            SET status = 'deactivated', updated_at = now()
            WHERE clerk_user_id = :clerk_user_id
        """),
        {"clerk_user_id": clerk_user_id},
    )


async def get_roles(session: AsyncSession, user_id: UUID) -> list[str]:
    result = await session.execute(
        text("""
            SELECT role_selected
            FROM marketplace_role_selections
            WHERE user_id = :user_id AND status = 'active'
            ORDER BY selected_at
        """),
        {"user_id": user_id},
    )
    roles = [DB_ROLE_TO_PERSONA.get(role, role) for role in result.scalars()]
    return list(dict.fromkeys(roles))


async def replace_roles(session: AsyncSession, user_id: UUID, roles: list[str]) -> None:
    await session.execute(
        text("""
            UPDATE marketplace_role_selections
            SET status = 'inactive'
            WHERE user_id = :user_id AND status = 'active'
        """),
        {"user_id": user_id},
    )
    for role in roles:
        await session.execute(
            text("""
                INSERT INTO marketplace_role_selections (user_id, role_selected, status)
                VALUES (:user_id, :role, 'active')
            """),
            {"user_id": user_id, "role": PERSONA_TO_DB_ROLE.get(role, role)},
        )



async def manufacturer_account_exists(session: AsyncSession, user_id: UUID) -> bool:
    """True once the Manufacturer details form (AccountScreen) has been saved."""
    result = await session.execute(
        text("""
            SELECT EXISTS (
              SELECT 1 FROM memberships m
              JOIN organizations o ON o.id = m.organization_id
              JOIN manufacturer_onboarding mo ON mo.organization_id = o.id
              WHERE m.user_id = :user_id AND m.status = 'active'
                AND o.organization_type = 'manufacturer' AND o.status <> 'closed'
                AND mo.personal_information_completed
            )
        """),
        {"user_id": user_id},
    )
    return bool(result.scalar())
