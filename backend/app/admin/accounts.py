"""Admin email + password sign-in (separate from Clerk).

- Passwords: scrypt (Python standard library), random 16-byte salt, stored as
  "scrypt$N$r$p$salt$hash". Never logged, never returned.
- Sessions: random 256-bit token given to the browser once ("xya_..."); only its
  SHA-256 is stored. Ends after `admin_session_hours`, or after `admin_idle_minutes`
  without activity, or on logout / password change / suspension.
- Lockout: `admin_max_failed_logins` wrong passwords in a row lock the account for
  `admin_lockout_minutes`. Unknown emails get the same answer and the same delay.
"""
import asyncio
import base64
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings

TOKEN_PREFIX = "xya_"
LOCAL_CLERK_PREFIX = "local-admin:"
_N, _R, _P = 2**14, 8, 1
GENERIC_LOGIN_ERROR = "Incorrect email or password."


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                                dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except Exception:  # noqa: BLE001 - malformed hash = no match
        return False


# Used for unknown emails so the response time does not reveal whether an account exists.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def password_problem(password: str, email: str = "") -> str | None:
    """None when acceptable, otherwise a message for the user."""
    if len(password) < 12:
        return "Use at least 12 characters."
    if len(password) > 128:
        return "Use at most 128 characters."
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "Use letters and at least one number."
    local = email.split("@")[0].lower()
    if len(local) >= 4 and local in password.lower():
        return "Do not include your email name in the password."
    if password.lower() in {"password1234", "admin1234567", "xyfactory123", "123456789abc"}:
        return "This password is too common."
    return None


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def is_admin_session_token(token: str) -> bool:
    return token.startswith(TOKEN_PREFIX)


class LoginError(Exception):
    def __init__(self, status: int, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.status, self.message, self.retry_after = status, message, retry_after


async def _event(db: AsyncSession, user_id, kind: str, detail: str, ip: str | None) -> None:
    await db.execute(text("""
        INSERT INTO user_activity_events (user_id, clerk_user_id, kind, detail, path, method)
        SELECT :u, (SELECT clerk_user_id FROM users WHERE id=:u), :k, :d, '/api/v1/admin/auth/login', 'POST'
    """), {"u": user_id, "k": kind, "d": f"{detail} (IP {ip or 'unknown'})"})


async def login(db: AsyncSession, settings: Settings, email: str, password: str,
                ip: str | None, user_agent: str | None) -> tuple[str, datetime]:
    """Returns (token, expires_at) or raises LoginError."""
    acct = (await db.execute(text("""
        SELECT a.id, a.user_id, a.password_hash, a.status, a.failed_attempts, a.locked_until, u.status AS user_status
        FROM admin_accounts a JOIN users u ON u.id = a.user_id
        WHERE a.email = CAST(:e AS citext) FOR UPDATE OF a
    """), {"e": email.strip()})).mappings().first()
    now = datetime.now(timezone.utc)

    if acct is None:
        await asyncio.to_thread(verify_password, password, _DUMMY_HASH)
        raise LoginError(401, GENERIC_LOGIN_ERROR)

    if acct["locked_until"] and acct["locked_until"] > now:
        minutes = max(1, int((acct["locked_until"] - now).total_seconds() // 60) + 1)
        raise LoginError(429, f"Too many failed attempts. Try again in {minutes} minute{'s' if minutes > 1 else ''}.",
                         retry_after=minutes * 60)

    ok = await asyncio.to_thread(verify_password, password, acct["password_hash"])
    if not ok:
        failed = acct["failed_attempts"] + 1
        lock = failed >= settings.admin_max_failed_logins
        await db.execute(text("""
            UPDATE admin_accounts SET failed_attempts=:f, updated_at=now(),
                   locked_until = CASE WHEN :lock THEN now() + make_interval(mins => :m) ELSE locked_until END
            WHERE id=:id
        """), {"f": 0 if lock else failed, "lock": lock, "m": settings.admin_lockout_minutes, "id": acct["id"]})
        await _event(db, acct["user_id"], "admin_login_failed",
                     "Admin sign-in failed: wrong password" + (" - account locked" if lock else ""), ip)
        await db.commit()
        if lock:
            raise LoginError(429, f"Too many failed attempts. Try again in {settings.admin_lockout_minutes} minutes.",
                             retry_after=settings.admin_lockout_minutes * 60)
        raise LoginError(401, GENERIC_LOGIN_ERROR)

    if acct["status"] != "active":
        raise LoginError(403, "This admin account is disabled.")
    if acct["user_status"] != "active":
        raise LoginError(403, "This account has been suspended.")

    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    expires = now + timedelta(hours=settings.admin_session_hours)
    await db.execute(text("""
        INSERT INTO admin_sessions (account_id, token_hash, expires_at, ip_address, user_agent)
        VALUES (:a, :h, :x, :ip, :ua)
    """), {"a": acct["id"], "h": token_hash(token), "x": expires, "ip": ip, "ua": (user_agent or "")[:300]})
    await db.execute(text("""
        UPDATE admin_accounts SET failed_attempts=0, locked_until=NULL, last_login_at=now(), updated_at=now()
        WHERE id=:id
    """), {"id": acct["id"]})
    await _event(db, acct["user_id"], "admin_login", "Admin signed in with email and password", ip)
    await db.commit()
    return token, expires


async def resolve(db: AsyncSession, settings: Settings, token: str) -> dict | None:
    """The session's user id and account id, or None when invalid / expired / revoked."""
    row = (await db.execute(text("""
        SELECT s.id AS session_id, s.last_used_at, a.id AS account_id, a.user_id, a.status
        FROM admin_sessions s JOIN admin_accounts a ON a.id = s.account_id
        WHERE s.token_hash=:h AND s.revoked_at IS NULL AND s.expires_at > now()
          AND s.last_used_at > now() - make_interval(mins => :idle)
    """), {"h": token_hash(token), "idle": settings.admin_idle_minutes})).mappings().first()
    if row is None or row["status"] != "active":
        return None
    if row["last_used_at"] < datetime.now(timezone.utc) - timedelta(seconds=60):
        await db.execute(text("UPDATE admin_sessions SET last_used_at=now() WHERE id=:s"), {"s": row["session_id"]})
        await db.commit()
    return dict(row)


async def logout(db: AsyncSession, token: str) -> None:
    await db.execute(text("UPDATE admin_sessions SET revoked_at=now() WHERE token_hash=:h AND revoked_at IS NULL"),
                     {"h": token_hash(token)})
    await db.commit()


async def change_password(db: AsyncSession, account_id: UUID, current_token: str, current: str, new: str) -> None:
    acct = (await db.execute(text("SELECT email::text AS email, password_hash FROM admin_accounts WHERE id=:a"),
                             {"a": account_id})).mappings().first()
    if not acct or not await asyncio.to_thread(verify_password, current, acct["password_hash"]):
        raise LoginError(422, "Your current password is incorrect.")
    problem = password_problem(new, acct["email"])
    if problem:
        raise LoginError(422, problem)
    if current == new:
        raise LoginError(422, "Choose a password different from the current one.")
    hashed = await asyncio.to_thread(hash_password, new)
    await db.execute(text("""
        UPDATE admin_accounts SET password_hash=:p, password_changed_at=now(), updated_at=now() WHERE id=:a
    """), {"p": hashed, "a": account_id})
    # Sign out every other device.
    await db.execute(text("""
        UPDATE admin_sessions SET revoked_at=now()
        WHERE account_id=:a AND revoked_at IS NULL AND token_hash <> :h
    """), {"a": account_id, "h": token_hash(current_token)})
    await db.commit()


async def revoke_user_sessions(db: AsyncSession, user_id) -> None:
    """Used when an admin's user account is suspended."""
    await db.execute(text("""
        UPDATE admin_sessions SET revoked_at=now()
        WHERE revoked_at IS NULL AND account_id IN (SELECT id FROM admin_accounts WHERE user_id=CAST(:u AS uuid))
    """), {"u": str(user_id)})
