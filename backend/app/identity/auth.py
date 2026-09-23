from typing import Annotated

import httpx
import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import auth as core_auth
from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.identity.context import ActorContext
from app.identity.repository import get_user_by_clerk_id, upsert_user


def verify_clerk_token(token: str, settings: Settings) -> dict:
    """Same verification as the Manufacturer API (cached JWKS, issuer, azp)."""
    if not settings.clerk_issuer or not settings.clerk_jwks_url:
        raise HTTPException(503, "Clerk JWT verification is not configured")
    try:
        key = core_auth._jwks_client(settings.clerk_jwks_url).get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token, key, algorithms=["RS256"], issuer=settings.clerk_issuer, leeway=10,
            options={"verify_aud": False, "require": ["exp", "iat", "sub"]},
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(401, "Invalid or expired Clerk token") from exc
    azp = claims.get("azp")
    if azp and azp not in settings.clerk_authorized_parties:
        raise HTTPException(401, "Token authorized party is not allowed")
    return claims


async def _fetch_clerk_user(clerk_user_id: str, settings: Settings) -> dict:
    if not settings.clerk_secret_key:
        raise HTTPException(409, "User is not synchronized yet; configure the Clerk webhook")
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            f"https://api.clerk.com/v1/users/{clerk_user_id}",
            headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
        )
    if response.status_code != 200:
        raise HTTPException(502, "Unable to synchronize user from Clerk")
    return response.json()


def _primary_email(data: dict) -> tuple[str, bool]:
    primary_id = data.get("primary_email_address_id")
    emails = data.get("email_addresses") or []
    item = next((value for value in emails if value.get("id") == primary_id), None)
    if item is None and emails:
        item = emails[0]
    if item is None:
        raise HTTPException(422, "Clerk user has no email address")
    verification = item.get("verification") or {}
    return item.get("email_address", ""), verification.get("status") == "verified"


async def get_actor(
    authorization: Annotated[str | None, Header()] = None,
    session: Annotated[AsyncSession, Depends(get_session)] = None,
    settings: Annotated[Settings, Depends(get_settings)] = None,
) -> ActorContext:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Clerk session token")
    claims = verify_clerk_token(authorization.removeprefix("Bearer ").strip(), settings)
    clerk_user_id = claims["sub"]
    row = await get_user_by_clerk_id(session, clerk_user_id)
    if row is None:
        data = await _fetch_clerk_user(clerk_user_id, settings)
        email, verified = _primary_email(data)
        display_name = " ".join(
            part for part in [data.get("first_name"), data.get("last_name")] if part
        ) or email
        user_id = await upsert_user(
            session,
            clerk_user_id=clerk_user_id,
            email=email,
            display_name=display_name,
            first_name=data.get("first_name"),
            last_name=data.get("last_name"),
            email_verified=verified,
        )
        await session.commit()
    else:
        user_id = row["id"]
    # Clerk session-token v1 uses `org_id`, v2 uses `o.id`.
    organization_claim = claims.get("o")
    clerk_organization_id = claims.get("org_id")

    if not clerk_organization_id and isinstance(organization_claim, dict):
        clerk_organization_id = organization_claim.get("id")

    return ActorContext(
        user_id=user_id,
        clerk_user_id=clerk_user_id,
        clerk_organization_id=clerk_organization_id,
        claims=claims,
    )


CurrentActor = Annotated[ActorContext, Depends(get_actor)]

