import json

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import text
from svix.webhooks import Webhook, WebhookVerificationError

from app.core.config import get_settings
from app.core.database import SessionFactory
from app.identity.repository import deactivate_user, upsert_user


router = APIRouter(
    prefix="/webhooks/clerk",
    tags=["webhooks"],
)


def _text(value, field: str, max_length: int = 255) -> str | None:
    """Clerk sends these fields as short strings. Anything else is rejected (422)
    before it reaches the database. Values are always passed to SQL as bound
    parameters, never joined into the SQL text."""
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > max_length or "\x00" in value:
        raise HTTPException(status_code=422, detail=f"Clerk webhook field {field} is invalid")
    return value


def _object(value) -> dict:
    return value if isinstance(value, dict) else {}


def _email(data: dict) -> tuple[str, bool]:
    primary_id = data.get("primary_email_address_id")
    addresses = data.get("email_addresses")
    addresses = [a for a in addresses if isinstance(a, dict)] if isinstance(addresses, list) else []

    entry = next(
        (
            item
            for item in addresses
            if item.get("id") == primary_id
        ),
        None,
    )

    if entry is None and addresses:
        entry = addresses[0]

    if entry is None:
        return "", False

    verification = entry.get("verification")
    verification = verification if isinstance(verification, dict) else {}

    return (
        _text(entry.get("email_address"), "email_address", 320) or "",
        verification.get("status") == "verified",
    )


@router.post("")
async def clerk_webhook(request: Request):
    settings = get_settings()

    if not settings.clerk_webhook_signing_secret:
        raise HTTPException(
            status_code=503,
            detail="Clerk webhook signing secret is not configured",
        )

    # The original raw body is required for signature verification.
    raw = await request.body()

    if not raw:
        raise HTTPException(
            status_code=400,
            detail="Empty Clerk webhook payload",
        )

    # Step 1: Verify that the request actually came from Clerk.
    try:
        Webhook(
            settings.clerk_webhook_signing_secret
        ).verify(
            raw,
            dict(request.headers),
        )
    except WebhookVerificationError as exc:
        raise HTTPException(
            status_code=400,
            detail="Invalid Clerk webhook signature",
        ) from exc

    # Step 2: Decode the verified raw JSON.
    # Newer Svix versions return None from verify().
    try:
        event = json.loads(raw)
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

    event_type = event.get("type", "")
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

    # SessionFactory.begin() commits on success and rolls back on failure.
    async with SessionFactory.begin() as session:
        if event_type in {"user.created", "user.updated"}:
            email, verified = _email(data)

            if not email:
                raise HTTPException(
                    status_code=422,
                    detail="Clerk user event has no email",
                )

            clerk_user_id = _text(data.get("id"), "id")

            if not clerk_user_id:
                raise HTTPException(
                    status_code=422,
                    detail="Clerk user event has no user ID",
                )

            first_name = _text(data.get("first_name"), "first_name")
            last_name = _text(data.get("last_name"), "last_name")
            name = " ".join(
                part
                for part in [first_name, last_name]
                if part
            ) or email

            await upsert_user(
                session,
                clerk_user_id=clerk_user_id,
                email=email,
                display_name=name,
                first_name=first_name,
                last_name=last_name,
                email_verified=verified,
            )

        elif event_type == "user.deleted":
            clerk_user_id = _text(data.get("id"), "id")

            if clerk_user_id:
                await deactivate_user(
                    session,
                    clerk_user_id,
                )

        elif event_type in {
            "organization.created",
            "organization.updated",
        }:
            clerk_organization_id = _text(data.get("id"), "id")
            organization_name = _text(data.get("name"), "name")

            if not clerk_organization_id:
                raise HTTPException(
                    status_code=422,
                    detail="Clerk organization event has no organization ID",
                )

            await session.execute(
                text(
                    """
                    INSERT INTO organizations (
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
                    "name": organization_name or "Organization",
                },
            )

        elif event_type == "organization.deleted":
            clerk_organization_id = _text(data.get("id"), "id")

            if clerk_organization_id:
                await session.execute(
                    text(
                        """
                        UPDATE organizations
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

        elif event_type in {
            "organizationMembership.created",
            "organizationMembership.updated",
        }:
            public_user_data = _object(data.get("public_user_data"))
            organization_data = _object(data.get("organization"))

            clerk_user_id = _text(public_user_data.get("user_id"), "public_user_data.user_id")
            clerk_organization_id = _text(organization_data.get("id"), "organization.id")

            membership_role = {
                "org:admin": "admin",
                "org:member": "member",
            }.get(
                data.get("role") if isinstance(data.get("role"), str) else "",
                "member",
            )

            if not clerk_user_id or not clerk_organization_id:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Clerk membership event is missing "
                        "the user or organization ID"
                    ),
                )

            result = await session.execute(
                text(
                    """
                    INSERT INTO memberships (
                        user_id,
                        organization_id,
                        membership_role,
                        status,
                        accepted_at
                    )
                    SELECT
                        u.id,
                        o.id,
                        :role,
                        'active',
                        now()
                    FROM users AS u
                    CROSS JOIN organizations AS o
                    WHERE u.clerk_user_id = :user_id
                      AND o.clerk_organization_id = :organization_id
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

            # INSERT...SELECT can succeed with zero inserted rows if the
            # user or organization webhook has not been processed yet.
            if result.rowcount == 0:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "User or organization does not exist yet. "
                        "Retry the membership webhook after processing "
                        "user.created and organization.created."
                    ),
                )

        elif event_type == "organizationMembership.deleted":
            public_user_data = _object(data.get("public_user_data"))
            organization_data = _object(data.get("organization"))

            clerk_user_id = _text(public_user_data.get("user_id"), "public_user_data.user_id")
            clerk_organization_id = _text(organization_data.get("id"), "organization.id")

            if clerk_user_id and clerk_organization_id:
                await session.execute(
                    text(
                        """
                        UPDATE memberships AS m
                        SET
                            status = 'removed',
                            version = m.version + 1
                        FROM users AS u, organizations AS o
                        WHERE m.user_id = u.id
                          AND m.organization_id = o.id
                          AND u.clerk_user_id = :user_id
                          AND o.clerk_organization_id = :organization_id
                        """
                    ),
                    {
                        "user_id": clerk_user_id,
                        "organization_id": clerk_organization_id,
                    },
                )

    return {
        "received": True,
        "type": event_type,
    }