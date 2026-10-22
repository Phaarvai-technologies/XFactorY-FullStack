"""Explicit application registration, kept separate from Clerk authentication.

A valid Clerk session proves *who* the caller is. It does not prove that the person completed
X!Y sign-up: Clerk can create an identity from a Google sign-in, and the Clerk webhook /
older read-time synchronisation create `users` rows for any identity. Registration is proven
only by `users.registration_completed_at`, which is set exclusively by `complete()` below:

* the caller is authenticated with a Clerk session token (identity key = token `sub`),
* the caller presents a sign-up flow token that the Sign-up page obtained from this backend
  (HMAC-signed with a server-only key, so a URL / storage edit cannot turn a sign-in into a
  sign-up), single use per Clerk account,
* the Clerk user's primary email is verified (read from Clerk's Backend API, so a late webhook
  never blocks a legitimate sign-up),
* the write is idempotent (repeated callbacks / retries register once, never duplicate rows).
"""
from __future__ import annotations

import base64
import hashlib
import logging
import hmac
import json
import secrets
import time
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Actor, current_actor
from app.core.config import Settings, get_settings
from app.core.database import get_session

log = logging.getLogger("xy.registration")

SIGN_UP_REQUIRED_MESSAGE = "Please sign up first, then sign in to continue."
TERMS_REQUIRED_MESSAGE = "Please accept the Terms of Service and Privacy Policy to continue."
TERMS_OUTDATED_MESSAGE = "The Terms of Service or Privacy Policy changed. Please review and accept them again."
SUSPENDED_MESSAGE = "This account has been suspended. Please contact X!Y support."
FLOW_TTL_SECONDS = 30 * 60
FLOW_PURPOSES = ("sign-in", "sign-up")
FLOW_METHODS = ("manual", "google")


class RegistrationRequired(Exception):
    """Authenticated, but the application sign-up was never completed. Rendered as
    403 {"detail": SIGN_UP_REQUIRED_MESSAGE, "code": "registration_required"} (app.main)."""


# ------------------------------------------------------------------ flow tokens
def _flow_key(settings: Settings) -> bytes:
    if not settings.clerk_secret_key:
        raise HTTPException(503, "Registration is not configured on the server (CLERK_SECRET_KEY)")
    return hmac.new(settings.clerk_secret_key.encode(), b"xy-registration-flow-v1", hashlib.sha256).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def safe_return_path(value: str | None) -> str:
    """Only a path on this site: "/x?y". Anything else (absolute URL, //host, backslash,
    control characters, over-long) becomes "/"."""
    if not isinstance(value, str) or not value.startswith("/") or value.startswith("//"):
        return "/"
    if len(value) > 512 or any(c == "\\" or ord(c) < 0x20 or ord(c) == 0x7F for c in value):
        return "/"
    return value


def issue_flow_token(settings: Settings, purpose: str, method: str, return_path: str | None,
                     now: float | None = None, terms_version: str | None = None) -> dict:
    """`terms_version`: the Terms version the user explicitly accepted on the Sign-up page.
    It is signed into the token together with the acceptance time, so registration can
    later record exactly what was accepted and when, and nobody can add it afterwards."""
    if purpose not in FLOW_PURPOSES or method not in FLOW_METHODS:
        raise HTTPException(422, "Unsupported authentication flow")
    issued = int(now if now is not None else time.time())
    payload = {"v": 1, "p": purpose, "m": method, "r": safe_return_path(return_path),
               "exp": issued + FLOW_TTL_SECONDS, "n": secrets.token_urlsafe(16)}
    if terms_version:
        payload["tv"], payload["ta"] = terms_version, issued
    body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signature = _b64(hmac.new(_flow_key(settings), body.encode(), hashlib.sha256).digest())
    return {"flowToken": f"{body}.{signature}",
            "expiresAt": datetime.fromtimestamp(payload["exp"], tz=timezone.utc).isoformat()}


def verify_flow_token(settings: Settings, token: str | None, now: float | None = None) -> dict:
    """Payload of a valid, unexpired token signed by this server, else HTTP 400."""
    invalid = HTTPException(400, {"code": "invalid_flow",
                                  "message": "This sign-up session is no longer valid. Please start again."})
    if not isinstance(token, str) or token.count(".") != 1 or len(token) > 2048:
        raise invalid
    body, signature = token.split(".")
    expected = _b64(hmac.new(_flow_key(settings), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected):
        raise invalid
    try:
        payload = json.loads(_unb64(body))
    except (ValueError, json.JSONDecodeError):
        raise invalid from None
    if (not isinstance(payload, dict) or payload.get("v") != 1 or payload.get("p") not in FLOW_PURPOSES
            or payload.get("m") not in FLOW_METHODS or not isinstance(payload.get("exp"), int)):
        raise invalid
    if payload["exp"] < int(now if now is not None else time.time()):
        raise HTTPException(400, {"code": "flow_expired",
                                  "message": "This sign-up session has expired. Please try again."})
    return payload


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def require_terms(settings: Settings, flow: dict) -> None:
    """The sign-up token must carry acceptance of the CURRENT Terms version."""
    if not flow.get("tv") or not isinstance(flow.get("ta"), int):
        raise HTTPException(422, {"code": "terms_required", "message": TERMS_REQUIRED_MESSAGE})
    if flow["tv"] != settings.terms_version:
        raise HTTPException(409, {"code": "terms_outdated", "message": TERMS_OUTDATED_MESSAGE})


# ------------------------------------------------------------------ status
async def registration_row(session: AsyncSession, clerk_user_id: str):
    """users row for the Clerk id with its registration fields, or None. Database errors
    propagate (callers must never read an outage as "not registered")."""
    result = await session.execute(text("""
        SELECT id, status, registration_completed_at, registration_method, created_at
        FROM users WHERE clerk_user_id = :c
    """), {"c": clerk_user_id})
    return result.mappings().one_or_none()


def require_registered(row) -> None:
    """Raise unless `row` is an active, registered account."""
    if row is None:
        raise RegistrationRequired()
    if row["status"] != "active":
        raise HTTPException(403, SUSPENDED_MESSAGE)
    if row["registration_completed_at"] is None:
        raise RegistrationRequired()


# ------------------------------------------------------------------ legacy accounts
# Evidence that an account created BEFORE explicit registration (migration 014) was a deliberate
# sign-up. Checked in this order; the first match is recorded as users.registration_method.
#   legacy_signup_flow  - a completed sign-up flow recorded for this Clerk user
#   legacy_terms        - Terms acceptance recorded on the users row
#   legacy_activity     - saved marketplace roles / submitted Manufacturer details form /
#                         saved Visionary profile / admin role (only possible after signing up)
#   legacy_password     - the Clerk account has a password: only the Sign-up page (or X!Y staff)
#                         creates password accounts; a sign-in attempt never does
#   legacy_legal_terms  - Clerk recorded legal-terms acceptance, which only the Sign-up page sends
# NOT evidence: a users row existing, a webhook or welcome email, a verified email, or a
# Google account alone (the old sign-in bug created those for unknown Google users).
_DB_EVIDENCE_SQL = """
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM registration_flows f
                   WHERE f.completed_clerk_user_id = u.clerk_user_id AND f.purpose = 'sign-up')
        THEN 'legacy_signup_flow'
      WHEN NULLIF(btrim(COALESCE(u.accepted_terms_version, '')), '') IS NOT NULL THEN 'legacy_terms'
      WHEN EXISTS (SELECT 1 FROM marketplace_role_selections s WHERE s.user_id = u.id AND s.status = 'active')
        OR EXISTS (SELECT 1 FROM memberships m
                   JOIN organizations o ON o.id = m.organization_id AND o.organization_type = 'manufacturer'
                   JOIN manufacturer_onboarding mo ON mo.organization_id = o.id AND mo.personal_information_completed
                   WHERE m.user_id = u.id AND m.status = 'active')
        OR EXISTS (SELECT 1 FROM visionary_profiles v WHERE v.user_id = u.id)
        OR EXISTS (SELECT 1 FROM platform_role_assignments p
                   WHERE p.user_id = u.id AND p.status = 'active' AND p.revoked_at IS NULL)
        THEN 'legacy_activity'
    END
    FROM users u WHERE u.id = :id
"""


async def legacy_cutoff(session: AsyncSession):
    return await session.scalar(text("SELECT value FROM registration_settings WHERE key = 'legacy_cutoff'"))


async def legacy_evidence(session: AsyncSession, settings: Settings, row) -> str | None:
    """Evidence label for a pre-registration account, or None. Raises an HTTP 5xx (never
    returns None) when Clerk cannot be asked: an outage is not "not registered"."""
    cutoff = await legacy_cutoff(session)
    if cutoff is None or row["created_at"] is None or row["created_at"] >= cutoff:
        return None
    label = await session.scalar(text(_DB_EVIDENCE_SQL), {"id": row["id"]})
    if label:
        return label
    from app.identity import auth as identity_auth  # local import: avoids a cycle
    clerk_user_id = await session.scalar(text("SELECT clerk_user_id FROM users WHERE id = :id"), {"id": row["id"]})
    if not settings.clerk_secret_key:
        raise HTTPException(503, "The registration check is not configured on the server (CLERK_SECRET_KEY).")
    clerk_user = await identity_auth._fetch_clerk_user(clerk_user_id, settings)  # 502/503 on failure
    if clerk_user.get("password_enabled") is True:
        return "legacy_password"
    if clerk_user.get("legal_accepted_at"):
        return "legacy_legal_terms"
    return None


async def ensure_registered(session: AsyncSession, settings: Settings, clerk_user_id: str,
                            clerk_session_id: str | None = None):
    """The registration rule used by every protected API and the registration status check.

    Registered = users.registration_completed_at is set. An account from before explicit
    registration that has recorded sign-up evidence is marked registered once (auditable:
    registration_method names the evidence). Raises RegistrationRequired only when the account
    is confirmed not registered; database / Clerk failures propagate as server errors."""
    row = await registration_row(session, clerk_user_id)
    if row is None:
        raise RegistrationRequired()
    if row["status"] != "active":
        raise HTTPException(403, SUSPENDED_MESSAGE)
    if row["registration_completed_at"] is not None:
        return row
    label = await legacy_evidence(session, settings, row)
    if not label:
        raise RegistrationRequired()
    await session.execute(text("""
        UPDATE users SET registration_completed_at = now(), registration_method = :m,
                         registration_session_id = :sid, updated_at = now(),
                         -- channel (how they registered), separate from the evidence / sign-in method
                         registration_channel = COALESCE(registration_channel, 'legacy_account')
        WHERE id = :id AND registration_completed_at IS NULL
    """), {"id": row["id"], "m": label, "sid": clerk_session_id})
    await session.commit()
    log.info("Existing account %s recognised as registered (%s)", row["id"], label)
    return await registration_row(session, clerk_user_id)


async def registered_actor(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    session: Annotated[AsyncSession, Depends(get_session)] = None,
    settings: Annotated[Settings, Depends(get_settings)] = None,
) -> Actor:
    """Manufacturer API dependency: a valid Clerk token AND a completed registration."""
    actor = await current_actor(request, authorization, settings)
    await ensure_registered(session, settings, actor.clerk_user_id)
    return actor


# ------------------------------------------------------------------ completion
async def complete(session: AsyncSession, settings: Settings, *, clerk_user_id: str,
                   clerk_session_id: str | None, flow_token: str, clerk_user: dict) -> dict:
    """Finalize registration for an authenticated Clerk user (idempotent).

    `clerk_user` is the Clerk Backend API user object (fetched by the caller)."""
    from app.identity.auth import _primary_email  # local import: avoids a cycle
    from app.identity.repository import upsert_user

    flow = verify_flow_token(settings, flow_token)
    if flow["p"] != "sign-up":
        # A sign-in flow can never complete registration, however the client relabels it.
        raise HTTPException(403, {"code": "not_sign_up", "message": SIGN_UP_REQUIRED_MESSAGE})
    require_terms(settings, flow)
    if clerk_user.get("id") not in (None, clerk_user_id):
        raise HTTPException(403, "Clerk user mismatch")
    email, verified = _primary_email(clerk_user)
    if not verified:
        raise HTTPException(409, {"code": "email_unverified",
                                  "message": "Please verify your email address to finish signing up."})

    # One completion at a time per Clerk user (double-submit, repeated callbacks).
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
                          {"k": f"xy-register:{clerk_user_id}"})
    digest = token_hash(flow_token)
    inserted = await session.scalar(text("""
        INSERT INTO registration_flows (token_hash, purpose, method, return_path, expires_at,
                                        completed_clerk_user_id)
        VALUES (:h, :p, :m, :r, to_timestamp(:exp), :c)
        ON CONFLICT (token_hash) DO NOTHING
        RETURNING token_hash
    """), {"h": digest, "p": flow["p"], "m": flow["m"], "r": flow["r"], "exp": flow["exp"], "c": clerk_user_id})
    if inserted is None:
        owner = await session.scalar(text(
            "SELECT completed_clerk_user_id FROM registration_flows WHERE token_hash=:h"), {"h": digest})
        if owner != clerk_user_id:
            await session.rollback()
            raise HTTPException(409, {"code": "flow_used",
                                      "message": "This sign-up session was already used. Please start again."})

    first, last = clerk_user.get("first_name"), clerk_user.get("last_name")
    try:
        user_id = await upsert_user(
            session, clerk_user_id=clerk_user_id, email=email,
            display_name=" ".join(p for p in [first, last] if p) or email,
            first_name=first, last_name=last, email_verified=verified,
        )
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(409, "This email is already linked to another account. Please contact X!Y support.") from exc

    current = (await session.execute(text("""
        SELECT status, registration_completed_at, registration_method FROM users WHERE id = :id FOR UPDATE
    """), {"id": user_id})).mappings().one()
    if current["status"] != "active":
        await session.rollback()
        raise HTTPException(403, SUSPENDED_MESSAGE)
    newly = current["registration_completed_at"] is None
    terms = {"tv": flow["tv"], "ta": flow["ta"]}
    if newly:
        await session.execute(text("""
            UPDATE users SET registration_completed_at = now(), registration_method = :m,
                             registration_session_id = :sid,
                             -- website Sign-up is the channel; :m (manual / google) is the method
                             registration_channel = COALESCE(registration_channel, 'web_signup'),
                             accepted_terms_version = :tv, terms_accepted_at = to_timestamp(:ta),
                             updated_at = now()
            WHERE id = :id AND registration_completed_at IS NULL
        """), {"id": user_id, "m": flow["m"], "sid": clerk_session_id, **terms})
    else:
        # Already registered (repeat callback, or an older account signing up again): this
        # explicit acceptance is genuine, so record it when it is newer than what is stored.
        await session.execute(text("""
            UPDATE users SET accepted_terms_version = :tv, terms_accepted_at = to_timestamp(:ta), updated_at = now()
            WHERE id = :id AND (accepted_terms_version IS DISTINCT FROM :tv
                                OR terms_accepted_at IS NULL OR terms_accepted_at < to_timestamp(:ta))
        """), {"id": user_id, **terms})
    await session.commit()
    return {"registered": True, "alreadyRegistered": not newly, "userId": user_id,
            "returnPath": flow["r"], "method": flow["m"] if newly else current["registration_method"]}
