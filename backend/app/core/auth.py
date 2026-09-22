from dataclasses import dataclass
from fastapi import Depends, Header, HTTPException
import jwt
from jwt import PyJWKClient
from app.core.config import Settings, get_settings


@dataclass(frozen=True)
class Actor:
    clerk_user_id: str
    clerk_org_id: str


async def current_actor(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> Actor:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Bearer token required")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        key = PyJWKClient(settings.clerk_jwks_url).get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=["RS256"], issuer=settings.clerk_issuer,
                            options={"require": ["exp", "iat", "sub"]})
    except Exception as exc:
        raise HTTPException(401, "Invalid or expired Clerk token") from exc
    org_id = claims.get("org_id")
    org_claim = claims.get("o")

    if not org_id and isinstance(org_claim, dict):
            org_id = org_claim.get("id")

    if not org_id:
        raise HTTPException(
            status_code=409,
            detail="Create and activate a Clerk organization first",
        )
    if claims.get("azp") and claims["azp"] not in settings.clerk_authorized_parties:
        raise HTTPException(401, "Token authorized party is not allowed")
    if not org_id:
        raise HTTPException(409, "Create and activate a Clerk organization first")
    return Actor(clerk_user_id=claims["sub"], clerk_org_id=org_id)

