"""XY-ADMIN-01: only authorized X!Y staff can use /api/v1/admin.

An admin is a user with an active row in `platform_role_assignments` (existing
schema table). Admins sign in either way:
- X!Y (Clerk) account: `Authorization: Bearer <Clerk JWT>`. The first admins are
  bootstrapped from ADMIN_EMAILS; more with `python -m app.grant_admin <email>`.
- Admin account (email + password, `python -m app.admin_account create <email>`):
  `Authorization: Bearer xya_...` session token from POST /admin/auth/login."""
from dataclasses import dataclass, field
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import accounts
from app.core.auth import current_actor
from app.core.clerk import ClerkManagement
from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.identity.repository import upsert_user

ADMIN_ROLES = ("platform_administrator", "platform_operator", "support_specialist", "verification_analyst")


@dataclass(frozen=True)
class AdminContext:
    user_id: UUID
    clerk_user_id: str
    email: str
    name: str
    roles: tuple[str, ...] = field(default_factory=tuple)
    auth_method: str = "clerk"  # "clerk" | "password"
    account_id: UUID | None = None
    session_token: str | None = None


async def _active_roles(session: AsyncSession, user_id: UUID) -> list[str]:
    rows = await session.execute(text("""
        SELECT platform_role FROM platform_role_assignments
        WHERE user_id=:u AND status='active' AND revoked_at IS NULL ORDER BY granted_at
    """), {"u": user_id})
    return [r[0] for r in rows if r[0] in ADMIN_ROLES]


async def grant(session: AsyncSession, user_id: UUID, role: str = "platform_administrator",
                granted_by: UUID | None = None) -> None:
    await session.execute(text("""
        INSERT INTO platform_role_assignments (user_id, platform_role, status, granted_by_user_id)
        SELECT :u, :r, 'active', :g
        WHERE NOT EXISTS (SELECT 1 FROM platform_role_assignments
                          WHERE user_id=:u AND platform_role=:r AND status='active' AND revoked_at IS NULL)
    """), {"u": user_id, "r": role, "g": granted_by})


async def current_admin(
    request: Request,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> AdminContext:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if accounts.is_admin_session_token(token):
        return await _password_admin(request, token, session, settings)
    actor = await current_actor(request, authorization, settings)
    row = (await session.execute(text("""
        SELECT id, email, first_name, last_name, display_name, status FROM users WHERE clerk_user_id=:c
    """), {"c": actor.clerk_user_id})).first()
    if row is None:
        # Signed in but never synchronized (webhook not configured): create the user record.
        profile = await ClerkManagement(settings).actor_profile(actor)
        if not profile.get("email"):
            raise HTTPException(403, "Admin access only")
        await upsert_user(session, clerk_user_id=actor.clerk_user_id, email=profile["email"],
                          display_name=f'{profile.get("first_name", "")} {profile.get("last_name", "")}'.strip()
                          or profile["email"], first_name=profile.get("first_name") or None,
                          last_name=profile.get("last_name") or None)
        await session.commit()
        row = (await session.execute(text("""
            SELECT id, email, first_name, last_name, display_name, status FROM users WHERE clerk_user_id=:c
        """), {"c": actor.clerk_user_id})).first()
    if row.status != "active":
        raise HTTPException(403, "This account has been suspended.")
    roles = await _active_roles(session, row.id)
    if not roles and str(row.email).lower() in settings.admin_email_list:
        await grant(session, row.id)
        await session.commit()
        roles = await _active_roles(session, row.id)
    if not roles:
        raise HTTPException(403, "Admin access only. Ask an X!Y administrator to grant you access.")
    await _touch(session, row.id)
    name = f"{row.first_name or ''} {row.last_name or ''}".strip() or row.display_name or str(row.email)
    return AdminContext(user_id=row.id, clerk_user_id=actor.clerk_user_id, email=str(row.email),
                        name=name, roles=tuple(roles))


async def _touch(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(text("""
        UPDATE users SET last_seen_at=now()
        WHERE id=:u AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes')
    """), {"u": user_id})
    await session.commit()


async def _password_admin(request: Request, token: str, session: AsyncSession, settings: Settings) -> AdminContext:
    found = await accounts.resolve(session, settings, token)
    if found is None:
        raise HTTPException(401, "Your admin session has ended. Please sign in again.")
    row = (await session.execute(text("""
        SELECT id, clerk_user_id, email, first_name, last_name, display_name, status FROM users WHERE id=:u
    """), {"u": found["user_id"]})).first()
    if row is None or row.status != "active":
        await accounts.logout(session, token)
        raise HTTPException(403, "This account has been suspended.")
    roles = await _active_roles(session, row.id)
    if not roles:
        raise HTTPException(403, "Admin access only. Ask an X!Y administrator to grant you access.")
    request.state.clerk_user_id = row.clerk_user_id
    await _touch(session, row.id)
    name = f"{row.first_name or ''} {row.last_name or ''}".strip() or row.display_name or str(row.email)
    return AdminContext(user_id=row.id, clerk_user_id=row.clerk_user_id, email=str(row.email), name=name,
                        roles=tuple(roles), auth_method="password", account_id=found["account_id"],
                        session_token=token)
