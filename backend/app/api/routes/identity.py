from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.core.welcome import send_welcome_soon
from app.identity import registration
from app.identity import auth as identity_auth
from app.identity.auth import AuthenticatedClaims, CurrentActor
from app.identity.schemas import RoleUpdate
from app.identity.service import read_identity, update_roles

router = APIRouter(prefix="/identity", tags=["identity"])


class SignUpFlowRequest(BaseModel):
    method: Literal["manual", "google"]
    returnPath: str | None = Field(default=None, max_length=2048)
    # The Terms checkbox on the Sign-up page (never preselected; required for both methods).
    termsAccepted: bool = False
    termsVersion: str | None = Field(default=None, max_length=100)


class CompleteRegistrationRequest(BaseModel):
    flowToken: str = Field(min_length=10, max_length=2048)


@router.post("/registration/flows", status_code=201)
async def start_sign_up_flow(
    body: SignUpFlowRequest,
    settings: Annotated[Settings, Depends(get_settings)],
):
    """Sign-up page, before creating the Clerk account (manual) or leaving for Google.

    Public and stateless (no database write): returns a short-lived token signed with a
    server-only key that marks the attempt as an explicit sign-up. Sign-in never needs one;
    the absence of a valid sign-up token always means "sign-in". It reveals nothing about
    whether any account exists. Refused unless the Terms (current version) were accepted."""
    if body.termsAccepted is not True:
        raise HTTPException(422, {"code": "terms_required", "message": registration.TERMS_REQUIRED_MESSAGE})
    if body.termsVersion != settings.terms_version:
        raise HTTPException(409, {"code": "terms_outdated", "message": registration.TERMS_OUTDATED_MESSAGE})
    return registration.issue_flow_token(settings, "sign-up", body.method, body.returnPath,
                                         terms_version=settings.terms_version)


@router.get("/registration")
async def registration_status(
    claims: AuthenticatedClaims,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    """Is the signed-in Clerk identity a registered X!Y user? Authentication only; it never
    creates a user. 200 {registered: bool}; 403 if suspended; 409 identity_mismatch when this
    sign-in's email belongs to an X!Y account under a different Clerk user (e.g. another Clerk
    instance) - not "unregistered"; a database / Clerk failure is a 5xx (callers retry)."""
    try:
        await registration.ensure_registered(session, settings, claims["sub"], claims.get("sid"))
        return {"registered": True}
    except registration.RegistrationRequired:
        pass
    if await registration.registration_row(session, claims["sub"]) is None:
        await _refuse_identity_mismatch(session, settings, claims["sub"])
    return {"registered": False}


async def _refuse_identity_mismatch(session: AsyncSession, settings: Settings, clerk_user_id: str) -> None:
    """No account for this Clerk user id. If its verified email already belongs to an account
    with ANOTHER Clerk id, sending the person to Sign-up would be wrong (and would fail): say so.
    Accounts are never re-linked by email here (only the existing trusted rule in upsert_user)."""
    if not settings.clerk_secret_key:
        return
    clerk_user = await identity_auth._fetch_clerk_user(clerk_user_id, settings)
    email, verified = identity_auth._primary_email(clerk_user)
    if not verified:
        return
    other = await session.scalar(text("""
        SELECT 1 FROM users WHERE email = CAST(:e AS citext) AND clerk_user_id <> :c
          AND clerk_user_id NOT LIKE 'local-admin:%' LIMIT 1
    """), {"e": email, "c": clerk_user_id})
    if other:
        registration.log.warning("Sign-in by Clerk user %s matches an account with another Clerk id", clerk_user_id)
        raise HTTPException(409, {"code": "identity_mismatch", "message":
                                  "This email is linked to an existing X!Y account that uses a different sign-in. "
                                  "Please contact X!Y support - do not create a new account."})


@router.post("/registration/complete")
async def complete_registration(
    body: CompleteRegistrationRequest,
    claims: AuthenticatedClaims,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    """Called once by the Sign-up page / Google sign-up callback after Clerk finished the
    explicit sign-up. Idempotent: repeating it (retry, double callback, late webhook) never
    creates a second user and never fails a completed registration."""
    flow = registration.verify_flow_token(settings, body.flowToken)  # cheap checks before Clerk
    if flow["p"] != "sign-up":
        raise HTTPException(403, {"code": "not_sign_up", "message": registration.SIGN_UP_REQUIRED_MESSAGE})
    registration.require_terms(settings, flow)  # before any Clerk call or database write
    clerk_user = await identity_auth._fetch_clerk_user(claims["sub"], settings)  # no webhook needed
    result = await registration.complete(
        session, settings, clerk_user_id=claims["sub"], clerk_session_id=claims.get("sid"),
        flow_token=body.flowToken, clerk_user=clerk_user,
    )
    if not result["alreadyRegistered"]:
        send_welcome_soon(result["userId"])  # once, in the background
    return {"registered": True, "alreadyRegistered": result["alreadyRegistered"],
            "returnPath": result["returnPath"]}


@router.get("/me")
async def me(
    actor: CurrentActor,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Roles page load. Returns {user, roles, manufacturerAccountExists}."""
    return await read_identity(session, actor)


@router.put("/me/roles")
async def save_roles(
    payload: RoleUpdate,
    actor: CurrentActor,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Roles page "Continue". Returns {roles, manufacturerAccountExists}."""
    try:
        return await update_roles(session, actor, payload)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(422, str(exc)) from exc
