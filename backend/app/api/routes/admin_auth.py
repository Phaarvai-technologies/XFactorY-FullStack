"""Admin email + password sign-in. Clerk sign-in needs no endpoint here: the
frontend signs in with Clerk and calls /admin/me with the Clerk token."""
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import accounts
from app.admin.auth import AdminContext, current_admin
from app.admin.schemas import ChangePasswordIn, LoginIn
from app.core import email_templates as tpl
from app.core.config import Settings, get_settings
from app.core.email import Mailer
from app.core.database import get_session

router = APIRouter(prefix="/admin/auth", tags=["admin-auth"])
Db = Annotated[AsyncSession, Depends(get_session)]
Cfg = Annotated[Settings, Depends(get_settings)]


@router.post("/login")
async def login(body: LoginIn, request: Request, db: Db, settings: Cfg):
    try:
        token, expires = await accounts.login(db, settings, body.email, body.password,
                                              request.client.host if request.client else None,
                                              request.headers.get("user-agent"))
    except accounts.LoginError as exc:
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
        return JSONResponse({"detail": exc.message}, status_code=exc.status, headers=headers)
    return {"token": token, "expiresAt": expires, "idleMinutes": settings.admin_idle_minutes}


@router.post("/logout", status_code=204)
async def logout(db: Db, authorization: str | None = Header(default=None)):
    token = (authorization or "").removeprefix("Bearer ").strip()
    if accounts.is_admin_session_token(token):
        await accounts.logout(db, token)
    return Response(status_code=204)


@router.post("/change-password", status_code=204)
async def change_password(body: ChangePasswordIn, db: Db, settings: Cfg,
                          admin: Annotated[AdminContext, Depends(current_admin)]):
    if admin.auth_method != "password" or not admin.account_id:
        raise HTTPException(422, "Your password is managed by your X!Y (Clerk) account.")
    try:
        await accounts.change_password(db, admin.account_id, admin.session_token or "", body.current_password,
                                       body.new_password)
    except accounts.LoginError as exc:
        raise HTTPException(exc.status, exc.message) from exc
    # Security notice to the account's email (never contains the password).
    subject, text_body, html = tpl.admin_password_changed(
        admin.name, f"{settings.app_base_url.rstrip('/')}/admin/login")
    await Mailer(settings, db).send(admin.email, "admin_password_changed", subject, text_body, html,
                                    user_id=admin.user_id)
    return Response(status_code=204)

