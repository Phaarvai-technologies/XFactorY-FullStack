from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import text
from svix.webhooks import Webhook, WebhookVerificationError

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.identity.repository import deactivate_user, upsert_user

router = APIRouter(prefix="/webhooks/clerk", tags=["webhooks"])


def _email(data: dict) -> tuple[str, bool]:
    primary_id = data.get("primary_email_address_id")
    addresses = data.get("email_addresses") or []
    entry = next((item for item in addresses if item.get("id") == primary_id), None)
    if entry is None and addresses:
        entry = addresses[0]
    if entry is None:
        return "", False
    verification = entry.get("verification") or {}
    return entry.get("email_address", ""), verification.get("status") == "verified"


@router.post("")
async def clerk_webhook(request: Request):
    settings = get_settings()
    if not settings.clerk_webhook_signing_secret:
        raise HTTPException(503, "Clerk webhook signing secret is not configured")
    raw = await request.body()
    try:
        event = Webhook(settings.clerk_webhook_signing_secret).verify(raw, request.headers)
    except WebhookVerificationError as exc:
        raise HTTPException(400, "Invalid Clerk webhook signature") from exc

    event_type = event.get("type", "")
    data = event.get("data") or {}
    async with SessionLocal.begin() as session:
        if event_type in {"user.created", "user.updated"}:
            email, verified = _email(data)
            if not email:
                raise HTTPException(422, "Clerk user event has no email")
            name = " ".join(
                part for part in [data.get("first_name"), data.get("last_name")] if part
            ) or email
            await upsert_user(
                session,
                clerk_user_id=data["id"],
                email=email,
                display_name=name,
                first_name=data.get("first_name"),
                last_name=data.get("last_name"),
                email_verified=verified,
            )
        elif event_type == "user.deleted" and data.get("id"):
            await deactivate_user(session, data["id"])
        elif event_type in {"organization.created", "organization.updated"}:
            await session.execute(
                text("""
                    INSERT INTO organizations (
                        clerk_organization_id, display_name, organization_type, status
                    ) VALUES (:clerk_id, :name, 'manufacturer', 'active')
                    ON CONFLICT (clerk_organization_id) DO UPDATE SET
                        display_name = EXCLUDED.display_name,
                        updated_at = now()
                """),
                {"clerk_id": data["id"], "name": data.get("name") or "Organization"},
            )
        elif event_type == "organization.deleted" and data.get("id"):
            await session.execute(
                text("""
                    UPDATE organizations SET status = 'closed', updated_at = now()
                    WHERE clerk_organization_id = :clerk_id
                """),
                {"clerk_id": data["id"]},
            )
        elif event_type in {
            "organizationMembership.created",
            "organizationMembership.updated",
        }:
            clerk_user_id = (data.get("public_user_data") or {}).get("user_id")
            clerk_org_id = (data.get("organization") or {}).get("id")
            role = {
                "org:admin": "admin",
                "org:member": "member",
            }.get(data.get("role"), "member")
            if clerk_user_id and clerk_org_id:
                await session.execute(
                    text("""
                        INSERT INTO memberships (
                            user_id, organization_id, membership_role,
                            status, accepted_at
                        )
                        SELECT u.id, o.id, :role, 'active', now()
                        FROM users u, organizations o
                        WHERE u.clerk_user_id = :user_id
                          AND o.clerk_organization_id = :organization_id
                        ON CONFLICT (organization_id, user_id) DO UPDATE SET
                            membership_role = EXCLUDED.membership_role,
                            status = 'active',
                            version = memberships.version + 1
                    """),
                    {
                        "user_id": clerk_user_id,
                        "organization_id": clerk_org_id,
                        "role": role,
                    },
                )
        elif event_type == "organizationMembership.deleted":
            clerk_user_id = (data.get("public_user_data") or {}).get("user_id")
            clerk_org_id = (data.get("organization") or {}).get("id")
            if clerk_user_id and clerk_org_id:
                await session.execute(
                    text("""
                        UPDATE memberships m
                        SET status = 'removed', version = version + 1
                        FROM users u, organizations o
                        WHERE m.user_id = u.id
                          AND m.organization_id = o.id
                          AND u.clerk_user_id = :user_id
                          AND o.clerk_organization_id = :organization_id
                    """),
                    {"user_id": clerk_user_id, "organization_id": clerk_org_id},
                )

    return {"received": True, "type": event_type}
