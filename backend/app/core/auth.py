"""Clerk session-token verification for the Manufacturer API.

The frontend sends `Authorization: Bearer <Clerk session JWT>` (from
`useAuth().getToken()`). The frontend does NOT create Clerk Organizations, so
`org_id` is optional: when it is absent the backend uses the user's own
Manufacturer organization (created on first use).
"""
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends, Header, HTTPException
from jwt import PyJWKClient

from app.core.config import Settings, get_settings


@dataclass(frozen=True)
class Actor:
    clerk_user_id: str
    clerk_org_id: str | None = None


@lru_cache(maxsize=4)
def _jwks_client(url: str) -> PyJWKClient:
    # Cached so the JWKS document is not downloaded on every request.
    return PyJWKClient(url, cache_keys=True, lifespan=3600)


async def current_actor(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> Actor:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Bearer token required")
    token = authorization.removeprefix("Bearer ").strip()
    if not token or token == "null":
        raise HTTPException(401, "Bearer token required")
    try:
        key = _jwks_client(settings.clerk_jwks_url).get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=settings.clerk_issuer,
            leeway=10,
            options={"verify_aud": False, "require": ["exp", "iat", "sub"]},
        )
    except Exception as exc:  # noqa: BLE001 - any failure is an auth failure
        raise HTTPException(401, "Invalid or expired Clerk token") from exc

    if claims.get("azp") and claims["azp"] not in settings.clerk_authorized_parties:
        raise HTTPException(401, "Token authorized party is not allowed")

    # Clerk v1 tokens use `org_id`; v2 tokens use the compact `o.id` claim.
    org_id = claims.get("org_id")
    org_claim = claims.get("o")
    if not org_id and isinstance(org_claim, dict):
        org_id = org_claim.get("id")

    return Actor(clerk_user_id=claims["sub"], clerk_org_id=org_id or None)
