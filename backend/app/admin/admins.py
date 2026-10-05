"""Admins tab: list every admin and grant / revoke admin access.

An admin is a `users` row with an active role in `platform_role_assignments`. Admins sign in
to /admin with an admin account (email + password, `admin_accounts`) and, if the same email
also has an X!Y account, with that too. Only platform administrators may change admin access.

Rules that keep the portal reachable:
- the built-in administrator (ADMIN_DEFAULT_EMAIL, admin@phaarvai.com) cannot be revoked,
  disabled or downgraded from here;
- nobody can revoke or downgrade themselves;
- the last active platform administrator cannot be revoked or downgraded.
"""
import asyncio
import uuid
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import accounts
from app.admin.accounts import LOCAL_CLERK_PREFIX, hash_password
from app.admin.auth import ADMIN_ROLES, AdminContext, grant
from app.core.config import Settings

ROLE_LABELS = {
    "platform_administrator": "Administrator",
    "platform_operator": "Operator",
    "support_specialist": "Support specialist",
    "verification_analyst": "Verification analyst",
}

# Everyone who is, or was, an admin: has (or had) a role, or has an admin account.
_LIST_SQL = """
    WITH roles AS (
      SELECT DISTINCT ON (user_id) user_id, platform_role, status, granted_at, revoked_at, granted_by_user_id
      FROM platform_role_assignments
      WHERE platform_role IN ('platform_administrator','platform_operator','support_specialist','verification_analyst')
      ORDER BY user_id, (status='active' AND revoked_at IS NULL) DESC, granted_at DESC
    )
    SELECT u.id, u.email::text AS email, u.status AS user_status, u.last_seen_at,
           coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.display_name) AS name,
           u.clerk_user_id NOT LIKE 'local-admin:%' AS has_xy_account,
           r.platform_role, (r.status='active' AND r.revoked_at IS NULL) AS role_active,
           r.granted_at, r.revoked_at,
           coalesce(nullif(btrim(concat_ws(' ', g.first_name, g.last_name)), ''), g.display_name) AS granted_by,
           a.id AS account_id, a.status AS account_status, a.last_login_at, a.must_change_password,
           a.locked_until > now() AS locked
    FROM users u
    LEFT JOIN roles r ON r.user_id=u.id
    LEFT JOIN users g ON g.id=r.granted_by_user_id
    LEFT JOIN admin_accounts a ON a.user_id=u.id
    WHERE (r.user_id IS NOT NULL OR a.id IS NOT NULL)
"""


def _status(row: dict) -> str:
    if not row["role_active"] or row["account_status"] == "disabled":
        return "revoked"
    if row["user_status"] != "active":
        return "suspended"
    return "active"


class AdminManager:
    def __init__(self, db: AsyncSession, settings: Settings):
        self.db = db
        self.settings = settings

    def _is_default(self, email: str) -> bool:
        return email.strip().lower() == self.settings.admin_default_email.strip().lower()

    def _view(self, row: dict, me: AdminContext) -> dict:
        last_login = max([d for d in (row["last_login_at"], row["last_seen_at"]) if d], default=None)
        return {
            "id": str(row["id"]), "name": row["name"], "email": row["email"],
            "role": row["platform_role"] or "", "roleLabel": ROLE_LABELS.get(row["platform_role"] or "", ""),
            "status": _status(row),
            "hasAdminAccount": row["account_id"] is not None,
            "hasXyAccount": bool(row["has_xy_account"]),
            "mustChangePassword": bool(row["must_change_password"]),
            "locked": bool(row["locked"]),
            "grantedAt": row["granted_at"].isoformat() if row["granted_at"] else None,
            "grantedBy": row["granted_by"],
            "revokedAt": row["revoked_at"].isoformat() if row["revoked_at"] and not row["role_active"] else None,
            "lastSignIn": last_login.isoformat() if last_login else None,
            "isDefault": self._is_default(row["email"]),
            "isYou": row["id"] == me.user_id,
        }

    async def _rows(self, user_id: UUID | None = None) -> list[dict]:
        sql = _LIST_SQL + (" AND u.id=:u" if user_id else "") + " ORDER BY role_active DESC NULLS LAST, name"
        return [dict(r) for r in (await self.db.execute(text(sql), {"u": user_id})).mappings()]

    async def list(self, me: AdminContext) -> list[dict]:
        return [self._view(r, me) for r in await self._rows()]

    async def _one(self, user_id: UUID, me: AdminContext) -> dict:
        rows = await self._rows(user_id)
        if not rows:
            raise HTTPException(404, "Admin not found")
        return self._view(rows[0], me)

    # ------------------------------------------------------------------ guards
    @staticmethod
    def require_administrator(me: AdminContext) -> None:
        if "platform_administrator" not in me.roles:
            raise HTTPException(403, "Only administrators can change admin access.")

    async def _active_administrators(self) -> int:
        return int(await self.db.scalar(text("""
            SELECT count(DISTINCT p.user_id) FROM platform_role_assignments p
            JOIN users u ON u.id=p.user_id
            LEFT JOIN admin_accounts a ON a.user_id=u.id
            WHERE p.platform_role='platform_administrator' AND p.status='active' AND p.revoked_at IS NULL
              AND u.status='active' AND coalesce(a.status,'active')='active'
        """)) or 0)

    async def _guard_change(self, target: dict, me: AdminContext, action: str) -> None:
        """action: "revoked" or "downgraded"."""
        if target["isDefault"]:
            raise HTTPException(422, f"The built-in administrator ({target['email']}) cannot be "
                                     + ("revoked." if action == "revoked" else "given another role."))
        if target["isYou"]:
            raise HTTPException(422, "You cannot revoke your own admin access." if action == "revoked"
                                else "You cannot change your own role.")
        if target["role"] == "platform_administrator" and target["status"] == "active" \
                and await self._active_administrators() <= 1:
            raise HTTPException(422, "At least one active administrator must remain.")

    async def _log(self, user_id: UUID, me: AdminContext, detail: str) -> None:
        await self.db.execute(text("""
            INSERT INTO user_activity_events (user_id, clerk_user_id, kind, detail, actor_user_id)
            SELECT id, clerk_user_id, 'account_status', :d, :a FROM users WHERE id=:u
        """), {"u": user_id, "a": me.user_id, "d": f"{detail} by {me.name or me.email}"})

    async def _end_sessions(self, user_id: UUID) -> None:
        await accounts.revoke_user_sessions(self.db, user_id)

    async def _set_role(self, user_id: UUID, role: str, me: AdminContext) -> None:
        """Exactly one active admin role per person."""
        await self.db.execute(text("""
            UPDATE platform_role_assignments SET status='revoked', revoked_at=now()
            WHERE user_id=:u AND status='active' AND revoked_at IS NULL AND platform_role<>:r
              AND platform_role = ANY(:roles)
        """), {"u": user_id, "r": role, "roles": list(ADMIN_ROLES)})
        await grant(self.db, user_id, role, granted_by=me.user_id)

    # ------------------------------------------------------------------ actions
    async def add(self, me: AdminContext, email: str, name: str, role: str) -> dict:
        """Grants admin access to an email. Creates the admin account (temporary password, to be
        changed at first sign-in) and, when the email is new, a staff-only user record."""
        self.require_administrator(me)
        email = email.strip()
        user = (await self.db.execute(text("""
            SELECT id, status FROM users WHERE email=CAST(:e AS citext)
        """), {"e": email})).mappings().first()
        if user is None:
            first, _, last = name.strip().partition(" ")
            user_id = await self.db.scalar(text("""
                INSERT INTO users (clerk_user_id, email, display_name, first_name, last_name, status)
                VALUES (:c, :e, :d, NULLIF(:f, ''), NULLIF(:l, ''), 'active') RETURNING id
            """), {"c": f"{LOCAL_CLERK_PREFIX}{uuid.uuid4()}", "e": email, "d": name.strip() or email,
                   "f": first, "l": last.strip()})
        else:
            user_id = user["id"]
            if user["status"] != "active":
                raise HTTPException(422, "This person's X!Y account is suspended. Reactivate it in Users first.")
            existing = await self._rows(user_id)
            if existing and _status(existing[0]) == "active":
                raise HTTPException(409, f"{email} is already an admin.")
        temporary = accounts.temporary_password()
        hashed = await asyncio.to_thread(hash_password, temporary)
        await self.db.execute(text("""
            INSERT INTO admin_accounts (user_id, email, password_hash, must_change_password, created_by_user_id)
            VALUES (:u, :e, :p, true, :by)
            ON CONFLICT (user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash, status='active',
              must_change_password=true, failed_attempts=0, locked_until=NULL, password_changed_at=now(),
              updated_at=now()
        """), {"u": user_id, "e": email, "p": hashed, "by": me.user_id})
        await self._set_role(user_id, role, me)
        await self._end_sessions(user_id)
        await self._log(user_id, me, f"Admin access granted ({ROLE_LABELS[role]})")
        await self.db.commit()
        return {"admin": await self._one(user_id, me), "temporaryPassword": temporary}

    async def revoke(self, me: AdminContext, user_id: UUID) -> dict:
        self.require_administrator(me)
        target = await self._one(user_id, me)
        if target["status"] == "revoked":
            raise HTTPException(422, "This admin's access is already revoked.")
        await self._guard_change(target, me, "revoked")
        await self.db.execute(text("""
            UPDATE platform_role_assignments SET status='revoked', revoked_at=now()
            WHERE user_id=:u AND status='active' AND revoked_at IS NULL AND platform_role = ANY(:roles)
        """), {"u": user_id, "roles": list(ADMIN_ROLES)})
        await self.db.execute(text("""
            UPDATE admin_accounts SET status='disabled', updated_at=now() WHERE user_id=:u
        """), {"u": user_id})
        await self._end_sessions(user_id)
        await self._log(user_id, me, "Admin access revoked")
        await self.db.commit()
        return await self._one(user_id, me)

    async def restore(self, me: AdminContext, user_id: UUID, role: str | None) -> dict:
        self.require_administrator(me)
        target = await self._one(user_id, me)
        if target["status"] == "active":
            raise HTTPException(422, "This admin already has access.")
        role = role or target["role"] or "platform_administrator"
        await self._set_role(user_id, role, me)
        await self.db.execute(text("""
            UPDATE admin_accounts SET status='active', failed_attempts=0, locked_until=NULL, updated_at=now()
            WHERE user_id=:u
        """), {"u": user_id})
        await self._log(user_id, me, f"Admin access restored ({ROLE_LABELS[role]})")
        await self.db.commit()
        return await self._one(user_id, me)

    async def change_role(self, me: AdminContext, user_id: UUID, role: str) -> dict:
        self.require_administrator(me)
        target = await self._one(user_id, me)
        if target["status"] != "active":
            raise HTTPException(422, "Restore this admin's access first.")
        if target["role"] == role:
            return target
        if target["role"] == "platform_administrator":
            await self._guard_change(target, me, "downgraded")
        elif target["isYou"]:
            raise HTTPException(422, "You cannot change your own role.")
        await self._set_role(user_id, role, me)
        await self._log(user_id, me, f"Admin role changed to {ROLE_LABELS[role]}")
        await self.db.commit()
        return await self._one(user_id, me)

    async def reset_password(self, me: AdminContext, user_id: UUID) -> dict:
        self.require_administrator(me)
        target = await self._one(user_id, me)
        if target["isYou"]:
            raise HTTPException(422, "Use Change password in the sidebar for your own password.")
        if target["isDefault"]:
            raise HTTPException(422, "The built-in administrator's password is changed in the terminal "
                                     "(python -m app.admin_account password).")
        if not target["hasAdminAccount"]:
            raise HTTPException(422, "This admin has no admin account yet.")
        temporary = accounts.temporary_password()
        hashed = await asyncio.to_thread(hash_password, temporary)
        await self.db.execute(text("""
            UPDATE admin_accounts SET password_hash=:p, must_change_password=true, failed_attempts=0,
                   locked_until=NULL, password_changed_at=now(), updated_at=now()
            WHERE user_id=:u
        """), {"u": user_id, "p": hashed})
        await self._end_sessions(user_id)
        await self._log(user_id, me, "Admin password reset")
        await self.db.commit()
        return {"admin": await self._one(user_id, me), "temporaryPassword": temporary}
