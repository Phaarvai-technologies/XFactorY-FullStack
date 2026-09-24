import json
import logging

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import text
from svix.webhooks import Webhook, WebhookVerificationError

from app.core.config import get_settings
from app.core.database import SessionFactory
from app.identity.repository import deactivate_user, upsert_user


logger = logging.getLogger("uvicorn.error")

router = APIRouter(
    prefix="/webhooks/clerk",
    tags=["webhooks"],
)


def _email(data: dict) -> tuple[str, bool]:
    """Return the user's primary email and verification status."""

    primary_id = data.get("primary_email_address_id")
    addresses = data.get("email_addresses") or []

    entry = next(
        (
            address
            for address in addresses
            if address.get("id") == primary_id
        ),
        None,
    )

    if entry is None and addresses:
        entry = addresses[0]

    if entry is None:
        return "", False

    verification = entry.get("verification") or {}

    return (
        entry.get("email_address", ""),
        verification.get("status") == "verified",
    )


@router.post("")
async def clerk_webhook(request: Request):
    settings = get_settings()

    if not settings.clerk_webhook_signing_secret:
        logger.error("CLERK_WEBHOOK_SIGNING_SECRET is not configured")

        raise HTTPException(
            status_code=503,
            detail="Clerk webhook signing secret is not configured",
        )

    raw_body = await request.body()

    if not raw_body:
        raise HTTPException(
            status_code=400,
            detail="Empty Clerk webhook payload",
        )

    # Verify that the request was sent by Clerk.
    try:
        Webhook(
            settings.clerk_webhook_signing_secret
        ).verify(
            raw_body,
            dict(request.headers),
        )
    except WebhookVerificationError as exc:
        logger.warning("Clerk webhook signature verification failed")

        raise HTTPException(
            status_code=400,
            detail="Invalid Clerk webhook signature",
        ) from exc

    # Decode the verified payload.
    try:
        event = json.loads(raw_body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=400,
            detail="Invalid Clerk webhook JSON",
        ) from exc

    if not isinstance(event, dict):
        raise HTTPException(
            status_code=400,
            detail="Invalid Clerk webhook event",
        )

    event_type = event.get("type")
    data = event.get("data") or {}

    if not event_type:
        raise HTTPException(
            status_code=422,
            detail="Clerk webhook event type is missing",
        )

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=422,
            detail="Clerk webhook data is invalid",
        )

    logger.info(
        "Processing Clerk webhook: type=%s object_id=%s",
        event_type,
        data.get("id"),
    )

    try:
        # Commits when successful and rolls back when an exception occurs.
        async with SessionFactory.begin() as session:
            if event_type in {"user.created", "user.updated"}:
                await _handle_user_upsert(session, data)

            elif event_type == "user.deleted":
                await _handle_user_deleted(session, data)

            elif event_type in {
                "organization.created",
                "organization.updated",
            }:
                await _handle_organization_upsert(session, data)

            elif event_type == "organization.deleted":
                await _handle_organization_deleted(session, data)

            elif event_type in {
                "organizationMembership.created",
                "organizationMembership.updated",
            }:
                await _handle_membership_upsert(session, data)

            elif event_type == "organizationMembership.deleted":
                await _handle_membership_deleted(session, data)

            else:
                logger.info(
                    "Ignoring unsupported Clerk event: type=%s",
                    event_type,
                )

    except HTTPException:
        raise

    except Exception as exc:
        logger.exception(
            "Clerk webhook database operation failed: "
            "type=%s object_id=%s",
            event_type,
            data.get("id"),
        )

        raise HTTPException(
            status_code=500,
            detail="Failed to process Clerk webhook",
        ) from exc

    logger.info(
        "Clerk webhook processed successfully: "
        "type=%s object_id=%s",
        event_type,
        data.get("id"),
    )

    return {
        "received": True,
        "type": event_type,
    }


async def _handle_user_upsert(session, data: dict) -> None:
    clerk_user_id = data.get("id")
    email, email_verified = _email(data)

    if not clerk_user_id:
        raise HTTPException(
            status_code=422,
            detail="Clerk user event has no user ID",
        )

    if not email:
        raise HTTPException(
            status_code=422,
            detail="Clerk user event has no email",
        )

    display_name = " ".join(
        part
        for part in [
            data.get("first_name"),
            data.get("last_name"),
        ]
        if part
    ) or email

    await upsert_user(
        session,
        clerk_user_id=clerk_user_id,
        email=email,
        display_name=display_name,
        first_name=data.get("first_name"),
        last_name=data.get("last_name"),
        email_verified=email_verified,
    )

    logger.info(
        "Clerk user stored successfully: clerk_user_id=%s email=%s",
        clerk_user_id,
        email,
    )


async def _handle_user_deleted(session, data: dict) -> None:
    clerk_user_id = data.get("id")

    if not clerk_user_id:
        raise HTTPException(
            status_code=422,
            detail="Clerk user deletion event has no user ID",
        )

    await deactivate_user(session, clerk_user_id)

    logger.info(
        "Clerk user deactivated: clerk_user_id=%s",
        clerk_user_id,
    )


async def _handle_organization_upsert(session, data: dict) -> None:
    clerk_organization_id = data.get("id")

    if not clerk_organization_id:
        raise HTTPException(
            status_code=422,
            detail="Clerk organization event has no organization ID",
        )

    await session.execute(
        text(
            """
            INSERT INTO public.organizations (
                clerk_organization_id,
                display_name,
                organization_type,
                status
            )
            VALUES (
                :clerk_id,
                :name,
                'manufacturer',
                'active'
            )
            ON CONFLICT (clerk_organization_id)
            DO UPDATE SET
                display_name = EXCLUDED.display_name,
                status = 'active',
                updated_at = now()
            """
        ),
        {
            "clerk_id": clerk_organization_id,
            "name": data.get("name") or "Organization",
        },
    )

    logger.info(
        "Clerk organization stored: clerk_organization_id=%s",
        clerk_organization_id,
    )


async def _handle_organization_deleted(session, data: dict) -> None:
    clerk_organization_id = data.get("id")

    if not clerk_organization_id:
        raise HTTPException(
            status_code=422,
            detail="Clerk organization deletion event has no organization ID",
        )

    await session.execute(
        text(
            """
            UPDATE public.organizations
            SET
                status = 'closed',
                updated_at = now()
            WHERE clerk_organization_id = :clerk_id
            """
        ),
        {
            "clerk_id": clerk_organization_id,
        },
    )

    logger.info(
        "Clerk organization closed: clerk_organization_id=%s",
        clerk_organization_id,
    )


async def _handle_membership_upsert(session, data: dict) -> None:
    public_user_data = data.get("public_user_data") or {}
    organization_data = data.get("organization") or {}

    clerk_user_id = public_user_data.get("user_id")
    clerk_organization_id = organization_data.get("id")

    if not clerk_user_id or not clerk_organization_id:
        raise HTTPException(
            status_code=422,
            detail="Membership event is missing user or organization ID",
        )

    membership_role = {
        "org:admin": "admin",
        "org:member": "member",
    }.get(
        data.get("role"),
        "member",
    )

    result = await session.execute(
        text(
            """
            INSERT INTO public.memberships (
                user_id,
                organization_id,
                membership_role,
                status,
                accepted_at
            )
            SELECT
                users.id,
                organizations.id,
                :role,
                'active',
                now()
            FROM public.users
            CROSS JOIN public.organizations
            WHERE users.clerk_user_id = :user_id
              AND organizations.clerk_organization_id = :organization_id
            ON CONFLICT (organization_id, user_id)
            DO UPDATE SET
                membership_role = EXCLUDED.membership_role,
                status = 'active',
                accepted_at = COALESCE(
                    memberships.accepted_at,
                    now()
                ),
                version = memberships.version + 1
            """
        ),
        {
            "user_id": clerk_user_id,
            "organization_id": clerk_organization_id,
            "role": membership_role,
        },
    )

    if result.rowcount == 0:
        raise HTTPException(
            status_code=409,
            detail=(
                "User or organization is not stored yet. "
                "Replay this membership webhook after processing "
                "user.created and organization.created."
            ),
        )

    logger.info(
        "Clerk membership stored: user_id=%s organization_id=%s",
        clerk_user_id,
        clerk_organization_id,
    )


async def _handle_membership_deleted(session, data: dict) -> None:
    public_user_data = data.get("public_user_data") or {}
    organization_data = data.get("organization") or {}

    clerk_user_id = public_user_data.get("user_id")
    clerk_organization_id = organization_data.get("id")

    if not clerk_user_id or not clerk_organization_id:
        raise HTTPException(
            status_code=422,
            detail="Membership event is missing user or organization ID",
        )

    await session.execute(
        text(
            """
            UPDATE public.memberships AS memberships
            SET
                status = 'removed',
                version = memberships.version + 1
            FROM
                public.users AS users,
                public.organizations AS organizations
            WHERE memberships.user_id = users.id
              AND memberships.organization_id = organizations.id
              AND users.clerk_user_id = :user_id
              AND organizations.clerk_organization_id = :organization_id
            """
        ),
        {
            "user_id": clerk_user_id,
            "organization_id": clerk_organization_id,
        },
    )

    logger.info(
        "Clerk membership removed: user_id=%s organization_id=%s",
        clerk_user_id,
        clerk_organization_id,
    )
