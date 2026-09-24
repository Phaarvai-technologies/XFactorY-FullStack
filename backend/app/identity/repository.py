import logging
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


logger = logging.getLogger("uvicorn.error")


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
