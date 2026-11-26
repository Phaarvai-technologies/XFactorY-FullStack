"""Manufacturer magic link: the public link, its acceptance, and the daily reminder job
(app/invitations.py). Admin endpoints for invitations live in routes/admin.py."""
import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app import invitations
from app.core.clerk import ClerkManagement
from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.identity import auth as identity_auth
from app.identity.auth import AuthenticatedClaims

router = APIRouter(tags=["invitations"])

Db = Annotated[AsyncSession, Depends(get_session)]
Conf = Annotated[Settings, Depends(get_settings)]


class AcceptIn(BaseModel):
    termsAccepted: bool
    termsVersion: str = Field(min_length=1, max_length=100)


class ClaimIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    name: str | None = Field(default=None, max_length=200)


def refusal(exc: invitations.InvitationError) -> JSONResponse:
    return JSONResponse({"detail": exc.message, "code": exc.code}, status_code=exc.status)


@router.post("/invitations/{code}/open")
async def open_invitation(code: str, db: Db, settings: Conf):
    """Public (the link is the credential). POST, not GET, so mail scanners that fetch links do
    not use it. status 'open' carries a fresh one-time Clerk sign-in ticket."""
    if len(code) > 200:
        return {"status": "invalid"}
    try:
        return await invitations.open_link(db, settings, ClerkManagement(settings), code)
    except invitations.InvitationError as exc:
        return refusal(exc)


@router.post("/invitations/{code}/claim")
async def claim_invitation(code: str, body: ClaimIn, db: Db, settings: Conf):
    """Public. A link made without an email: the person gives their email; they confirm it with
    the code Clerk emails them (on the page), then accept as usual."""
    if len(code) > 200:
        return JSONResponse({"detail": "This link is not valid.", "code": "invalid"}, status_code=404)
    try:
        return await invitations.claim(db, settings, ClerkManagement(settings), code=code, email=body.email,
                                       name=body.name)
    except invitations.InvitationError as exc:
        await db.rollback()
        return refusal(exc)


@router.post("/invitations/{code}/accept")
async def accept_invitation(code: str, body: AcceptIn, claims: AuthenticatedClaims, db: Db, settings: Conf):
    """The person the link signed in accepts the Terms: registered, owner of the company."""
    if not body.termsAccepted:
        return JSONResponse({"detail": "Please accept the Terms of Service and Privacy Policy to continue.",
                             "code": "terms_required"}, status_code=422)
    clerk_user = await identity_auth._fetch_clerk_user(claims["sub"], settings)
    try:
        return await invitations.accept(db, settings, code=code, clerk_user_id=claims["sub"],
                                        clerk_session_id=claims.get("sid"), terms_version=body.termsVersion,
                                        clerk_user=clerk_user)
    except invitations.InvitationError as exc:
        await db.rollback()
        return refusal(exc)


@router.post("/jobs/invitation-reminders")
async def invitation_reminders(db: Db, settings: Conf,
                               x_job_secret: Annotated[str | None, Header(alias="X-Job-Secret")] = None):
    """Daily (GitHub Actions): reminders on days 3, 7 and 12; closes expired links."""
    if not settings.invitation_job_secret:
        raise HTTPException(503, "Invitation reminders are off (INVITATION_JOB_SECRET is not set).")
    if not x_job_secret or not hmac.compare_digest(x_job_secret, settings.invitation_job_secret):
        raise HTTPException(401, "Not allowed")
    return await invitations.send_reminders(db, settings)
