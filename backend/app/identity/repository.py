import logging
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


logger = logging.getLogger("uvicorn.error")


# ---------------------------------------------------------------------------
# Role mappings
# ---------------------------------------------------------------------------

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

DB_ROLE_TO_PERSONA = {
    value: key
    for key, value in PERSONA_TO_DB_ROLE.items()
}


# ---------------------------------------------------------------------------
# User operations
# ---------------------------------------------------------------------------

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
    logger.info(
        "Upserting user: clerk_user_id=%s email=%s",
        clerk_user_id,
        email,
    )

    result = await session.execute(
        text(
            """
            INSERT INTO public.users (
                clerk_user_id,
                email,
                display_name,
                first_name,
                last_name,
                status
            )
            VALUES (
                :clerk_user_id,
                :email,
                :display_name,
                :first_name,
                :last_name,
                'active'
            )
            ON CONFLICT (clerk_user_id)
            DO UPDATE SET
                email = EXCLUDED.email,
                display_name = EXCLUDED.display_name,
                first_name = COALESCE(
                    EXCLUDED.first_name,
                    users.first_name
                ),
                last_name = COALESCE(
                    EXCLUDED.last_name,
                    users.last_name
                ),
                status = 'active',
                updated_at = now()
            RETURNING id
            """
        ),
        {
            "clerk_user_id": clerk_user_id,
            "email": email,
            "display_name": display_name or email,
            "first_name": first_name,
            "last_name": last_name,
        },
    )

    user_id = result.scalar_one()

    logger.info(
        "User row upserted: user_id=%s clerk_user_id=%s",
        user_id,
        clerk_user_id,
    )

    await session.execute(
        text(
            """
            INSERT INTO public.user_auth_identities (
                user_id,
                provider,
                provider_subject,
                contact_verified_at,
                last_authenticated_at
            )
            VALUES (
                :user_id,
                'clerk',
                :provider_subject,
                CASE
                    WHEN :email_verified THEN now()
                    ELSE NULL
                END,
                now()
            )
            ON CONFLICT (provider, provider_subject)
            DO UPDATE SET
                user_id = EXCLUDED.user_id,
                contact_verified_at = CASE
                    WHEN :email_verified THEN COALESCE(
                        user_auth_identities.contact_verified_at,
                        now()
                    )
                    ELSE user_auth_identities.contact_verified_at
                END,
                last_authenticated_at = now()
            """
        ),
        {
            "user_id": user_id,
            "provider_subject": clerk_user_id,
            "email_verified": email_verified,
        },
    )

    logger.info(
        "Clerk identity upserted: user_id=%s clerk_user_id=%s",
        user_id,
        clerk_user_id,
    )

    return user_id


async def get_user_by_clerk_id(
    session: AsyncSession,
    clerk_user_id: str,
):
    result = await session.execute(
        text(
            """
            SELECT
                id,
                clerk_user_id,
                email,
                display_name,
                first_name,
                last_name,
                phone,
                status,
                created_at,
                updated_at
            FROM public.users
            WHERE clerk_user_id = :clerk_user_id
            """
        ),
        {
            "clerk_user_id": clerk_user_id,
        },
    )

    return result.mappings().one_or_none()


async def deactivate_user(
    session: AsyncSession,
    clerk_user_id: str,
) -> None:
    await session.execute(
        text(
            """
            UPDATE public.users
            SET
                status = 'deactivated',
                updated_at = now()
            WHERE clerk_user_id = :clerk_user_id
            """
        ),
        {
            "clerk_user_id": clerk_user_id,
        },
    )


# ---------------------------------------------------------------------------
# Role operations
# ---------------------------------------------------------------------------

async def get_roles(
    session: AsyncSession,
    user_id: UUID,
) -> list[str]:
    result = await session.execute(
        text(
            """
            SELECT role_selected
            FROM public.marketplace_role_selections
            WHERE user_id = :user_id
              AND status = 'active'
            ORDER BY selected_at
            """
        ),
        {
            "user_id": user_id,
        },
    )

    roles = [
        DB_ROLE_TO_PERSONA.get(role, role)
        for role in result.scalars()
    ]

    return list(dict.fromkeys(roles))


async def replace_roles(
    session: AsyncSession,
    user_id: UUID,
    roles: list[str],
) -> None:
    await session.execute(
        text(
            """
            UPDATE public.marketplace_role_selections
            SET status = 'inactive'
            WHERE user_id = :user_id
              AND status = 'active'
            """
        ),
        {
            "user_id": user_id,
        },
    )

    for role in roles:
        await session.execute(
            text(
                """
                INSERT INTO public.marketplace_role_selections (
                    user_id,
                    role_selected,
                    status
                )
                VALUES (
                    :user_id,
                    :role,
                    'active'
                )
                """
            ),
            {
                "user_id": user_id,
                "role": PERSONA_TO_DB_ROLE.get(role, role),
            },
        )


# ---------------------------------------------------------------------------
# Manufacturer operations
# ---------------------------------------------------------------------------

async def manufacturer_account_exists(
    session: AsyncSession,
    user_id: UUID,
) -> bool:
    result = await session.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM public.memberships AS memberships
                JOIN public.organizations AS organizations
                  ON organizations.id = memberships.organization_id
                JOIN public.manufacturer_onboarding AS onboarding
                  ON onboarding.organization_id = organizations.id
                WHERE memberships.user_id = :user_id
                  AND memberships.status = 'active'
                  AND organizations.organization_type = 'manufacturer'
                  AND organizations.status <> 'closed'
                  AND onboarding.personal_information_completed
            )
            """
        ),
        {
            "user_id": user_id,
        },
    )

    return bool(result.scalar())
