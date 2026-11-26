"""Manufacturer magic link (plan agreed with Praveen, 25 Nov 2026).

After a call, the XfactorY team (administrators / operators) enters what it knows about a
manufacturer and sends a shareable link. The link:
* lasts `manufacturer_invite_days` (14) days, or until the account is set up;
* can be opened more than once: each open asks Clerk for a fresh one-time sign-in token
  (a Clerk token works once, the XfactorY link does not);
* signs in to a Clerk account created for that email with no password; after the Terms are
  accepted the person is the company's owner and lands on their dashboard;
* stops working when it is resent (a new code) or cancelled.

Identifiers: company + email (one open invitation per pair). The link's code is derived from the
invitation id and its send number with a server key (HMAC), so the same link can be shown again
(Copy link) and repeated in reminders without storing it; only its sha256 is stored, for look-up.
A resend changes the send number, so the previous link stops working. Reminders go out on the
days in `manufacturer_invite_reminder_days`, counted from the last send, with the same link.

Company details entered by the team are marked organizations.details_source='entered_by_xfactory'
until the manufacturer presses "Confirm details" ('confirmed_by_manufacturer'), which sends the
profile to admin approval as a separate step (review status Submitted; the admin approves, asks for
corrections or rejects with the usual Review status control). Accepting the invite does not approve:
the invited owner may edit their sections meanwhile. The 100% rule for Visionaries is unchanged.

Daily check-in with Praveen (26 Nov 2026):
* Any company can get a link, also one that already has an owner or is approved: the person then
  joins as an additional login (membership role 'admin'); the company's approval is not touched.
  The first person to accept on a company without an owner becomes its owner.
* A link can be generated without an email (sent by WhatsApp / Copy link). Whoever opens it enters
  their own email and confirms it with a code Clerk emails them (`claim`), so a link holder can
  never sign in to somebody else's existing account. Then the usual Terms and sign-in choice.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import math
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import email_templates
from app.core.clerk import ClerkManagement
from app.core.config import Settings
from app.core.email import Mailer
from app.manufacturer_approval import OWNER_ROLES
from app.manufacturer_approval import record_event as _record_event

INDIA = timezone(timedelta(hours=5, minutes=30), "IST")  # dates in emails and WhatsApp are Indian dates

log = logging.getLogger("xy.invitations")

INVITE_ROLES = ("platform_administrator", "platform_operator")
OPEN = ("invited", "opened")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class InvitationError(Exception):
    """A refusal with a message for the screen (status, machine code)."""

    def __init__(self, message: str, status: int = 409, code: str = "invitation_refused"):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


async def record_event(db: AsyncSession, *, action: str, details: dict | None = None, **kwargs) -> bool:
    """Onboarding history row for a link action: event 'note' with details.action
    (invitation_sent, invitation_opened, invitation_accepted, details_confirmed, …)."""
    return await _record_event(db, details={"action": action, **(details or {})}, **kwargs)


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def _key(settings: Settings) -> bytes:
    if not settings.clerk_secret_key:
        raise InvitationError("Invitations are not configured on the server (CLERK_SECRET_KEY).", 503,
                              "not_configured")
    return hmac.new(settings.clerk_secret_key.encode(), b"xy-manufacturer-invite-v1", hashlib.sha256).digest()


def _code(settings: Settings, invitation_id: UUID, generation: int) -> str:
    """The link code for this invitation and send number: same inputs, same link."""
    mac = hmac.new(_key(settings), f"{invitation_id}:{generation}".encode(), hashlib.sha256).digest()[:18]
    return base64.urlsafe_b64encode(UUID(str(invitation_id)).bytes + mac).rstrip(b"=").decode()


def current_link(settings: Settings, row: dict) -> str | None:
    """The working link of an open invitation (for Copy link), else None."""
    if row["status"] not in OPEN or row["expires_at"] <= datetime.now(timezone.utc):
        return None
    return invite_url(settings, _code(settings, row["id"], row["send_count"]))


def invite_url(settings: Settings, code: str) -> str:
    return f"{settings.app_base_url.rstrip('/')}/invite/{code}"


def _split_name(name: str) -> tuple[str, str]:
    parts = " ".join(name.split()).split(" ", 1)
    return parts[0], parts[1] if len(parts) > 1 else ""


def _view(row: dict, settings: Settings, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    status = row["status"]
    if status in OPEN and row["expires_at"] <= now:
        status = "expired"
    return {
        "id": str(row["id"]), "companyName": row["company_name"], "email": row["email"] or "",
        "contactName": row["contact_name"] or "", "phone": row["phone"] or "", "status": status,
        "withoutEmail": not row["email"] or bool(row.get("claimed_at")), "acceptedRole": row.get("accepted_role"),
        "expiresAt": row["expires_at"], "openedAt": row["opened_at"], "openCount": row["open_count"],
        "acceptedAt": row["accepted_at"], "cancelledAt": row["cancelled_at"],
        "remindersSent": row["reminders_sent"], "lastSentAt": row["last_sent_at"], "sendCount": row["send_count"],
        "createdAt": row["created_at"], "createdBy": row.get("created_by_name") or "",
        "respondBy": (row["last_sent_at"] + timedelta(days=settings.manufacturer_invite_respond_days)).isoformat(),
    }


async def _active_owner(db: AsyncSession, org_id: UUID) -> UUID | None:
    return await db.scalar(text(f"""
        SELECT user_id FROM memberships WHERE organization_id = :o AND status = 'active'
          AND membership_role IN {OWNER_ROLES} LIMIT 1
    """), {"o": org_id})


def respond_by_date(settings: Settings, row: dict) -> str:
    """The date the invite asks the manufacturer to confirm by (7 days after the last send;
    the link itself keeps working for 14). Shown as e.g. "2 Dec 2026"."""
    due = (row["last_sent_at"] + timedelta(days=settings.manufacturer_invite_respond_days)).astimezone(INDIA)
    return f"{due.day} {due:%b %Y}"


def days_left(expires_at: datetime) -> int:
    """Whole days the link still works, rounded up: a link made a moment ago shows 14, not 13."""
    seconds = (expires_at - datetime.now(timezone.utc)).total_seconds()
    return max(1, math.ceil(seconds / 86400))


async def _send(db: AsyncSession, settings: Settings, row: dict, code: str, reminder: bool) -> dict:
    url = invite_url(settings, code)
    days = days_left(row["expires_at"])
    respond_by = respond_by_date(settings, row)
    first, _ = _split_name(row["contact_name"])
    subject, body, html = (email_templates.manufacturer_invite_reminder if reminder
                           else email_templates.manufacturer_invite)(first, row["company_name"], url, days, respond_by,
                                                     settings.manufacturer_invite_respond_days)
    return await Mailer(settings, db).send(
        row["email"], "manufacturer_invite_reminder" if reminder else "manufacturer_invite", subject, body, html,
        organization_id=row["organization_id"])


# ---------------------------------------------------------------------------- admin side
async def list_for_company(db: AsyncSession, settings: Settings, org_id: UUID) -> list[dict]:
    rows = (await db.execute(text("""
        SELECT i.*, u.display_name created_by_name FROM manufacturer_invitations i
        LEFT JOIN users u ON u.id = i.created_by_user_id
        WHERE i.organization_id = :o ORDER BY i.created_at DESC
    """), {"o": org_id})).mappings().all()
    return [{**_view(dict(r), settings), "link": current_link(settings, dict(r))} for r in rows]


async def create(db: AsyncSession, settings: Settings, clerk: ClerkManagement, *, admin_id: UUID,
                 roles: tuple[str, ...], org_id: UUID, contact_name: str | None, email: str | None,
                 phone: str | None) -> dict:
    """Creates the invitation and returns {invitation, link, email}; the link is returned once,
    for Copy link / WhatsApp. With an email: the Clerk account is created if needed and the email
    is sent. Without: nothing is created or sent yet; the person enters their email on the link
    (email status 'none')."""
    if not set(roles) & set(INVITE_ROLES):
        raise InvitationError("Only administrators and operators can invite manufacturers.", 403, "forbidden")
    contact_name = " ".join((contact_name or "").split()) or None
    email = (email or "").strip().lower() or None
    phone = (phone or "").strip() or None
    if email and not contact_name:
        raise InvitationError("Please enter the contact person's name.", 422, "name_required")
    if email and not EMAIL_RE.match(email):
        raise InvitationError("Please enter a valid email address.", 422, "email_invalid")
    org = (await db.execute(text("""
        SELECT id, display_name, organization_type, is_archived FROM organizations WHERE id = :o FOR UPDATE
    """), {"o": org_id})).mappings().first()
    if not org or org["organization_type"] != "manufacturer":
        raise InvitationError("Manufacturer not found.", 404, "not_found")
    if org["is_archived"]:
        raise InvitationError("This company is archived. Restore it before inviting.", 409, "archived")
    if email:
        await _check_email(db, org_id, email)
        # Expired leftovers for the same pair are closed, so the unique index allows a new one.
        await db.execute(text("""
            UPDATE manufacturer_invitations SET status = 'expired', updated_at = now()
            WHERE organization_id = :o AND email = CAST(:e AS citext) AND status IN ('invited', 'opened')
        """), {"o": org_id, "e": email})
        first, last = _split_name(contact_name or "")
        try:
            clerk_user_id, created = await clerk.find_or_create_user(email, first, last)
        except RuntimeError as exc:
            log.warning("Invitation for %s: %s", org_id, exc)
            raise InvitationError(f"The sign-in account could not be created: {exc}", 502, "clerk_failed") from exc
    else:
        clerk_user_id, created = None, False
    invitation_id = await db.scalar(text("SELECT gen_random_uuid()"))
    code = _code(settings, invitation_id, 1)
    row = (await db.execute(text("""
        INSERT INTO manufacturer_invitations (id, organization_id, company_name, email, contact_name, phone,
                                              code_hash, clerk_user_id, expires_at, created_by_user_id)
        VALUES (:id, :o, :n, :e, :c, :p, :h, :cu, now() + make_interval(days => :d), :a)
        RETURNING *
    """), {"id": invitation_id, "o": org_id, "n": org["display_name"], "e": email, "c": contact_name, "p": phone,
           "h": _hash(code), "cu": clerk_user_id, "d": settings.manufacturer_invite_days,
           "a": admin_id})).mappings().one()
    row = dict(row)
    await record_event(db, event="note", action="invitation_sent", role="admin", source="admin_entry", organization_id=org_id,
                       actor=admin_id, details={"email": email, "withoutEmail": not email,
                                                "clerkAccountCreated": created})
    await db.commit()
    mail = await _send(db, settings, row, code, reminder=False) if email else {"status": "none"}
    await db.commit()
    return {"invitation": _view(row, settings), "link": invite_url(settings, code), "email": mail["status"]}


async def _check_email(db: AsyncSession, org_id: UUID, email: str, invitation_id: UUID | None = None) -> None:
    """The person's email: not already invited to this company, not managing another company."""
    if await db.scalar(text("""
        SELECT 1 FROM manufacturer_invitations WHERE organization_id = :o AND email = CAST(:e AS citext)
          AND status IN ('invited', 'opened') AND expires_at > now() AND (CAST(:i AS uuid) IS NULL OR id <> :i)
    """), {"o": org_id, "e": email, "i": invitation_id}):
        raise InvitationError("This person already has an open invitation for this company. Use Resend.",
                              409, "already_invited")
    if await db.scalar(text("""
        SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = :o AND m.status = 'active' AND u.email = CAST(:e AS citext)
    """), {"o": org_id, "e": email}):
        raise InvitationError("This person already has a login for this company.", 409, "already_member")
    # One email = one login. A person who already runs another manufacturer company on XfactorY
    # cannot be added to a second one by invitation (open question for Praveen).
    other = await db.scalar(text("""
        SELECT o.display_name FROM users u
        JOIN memberships m ON m.user_id = u.id AND m.status = 'active'
        JOIN organizations o ON o.id = m.organization_id AND o.organization_type = 'manufacturer'
        WHERE u.email = CAST(:e AS citext) AND o.id <> :o
          AND EXISTS (SELECT 1 FROM manufacturer_onboarding mo WHERE mo.organization_id = o.id
                      AND mo.personal_information_completed)
        LIMIT 1
    """), {"e": email, "o": org_id})
    if other:
        raise InvitationError(f"This email already manages another company on XfactorY ({other}). "
                              "Use a different email for this company.", 409, "email_has_company")


async def _locked(db: AsyncSession, invitation_id: UUID) -> dict:
    row = (await db.execute(text("SELECT * FROM manufacturer_invitations WHERE id = :i FOR UPDATE"),
                            {"i": invitation_id})).mappings().first()
    if not row:
        raise InvitationError("Invitation not found.", 404, "not_found")
    return dict(row)


async def resend(db: AsyncSession, settings: Settings, *, admin_id: UUID, roles: tuple[str, ...],
                 invitation_id: UUID) -> dict:
    """A new link (the old one stops working), a new 14 days, the email again."""
    if not set(roles) & set(INVITE_ROLES):
        raise InvitationError("Only administrators and operators can invite manufacturers.", 403, "forbidden")
    row = await _locked(db, invitation_id)
    if row["status"] in ("accepted", "cancelled"):
        raise InvitationError("This invitation is already " + row["status"] + ".", 409, row["status"])
    code = _code(settings, invitation_id, row["send_count"] + 1)
    row = dict((await db.execute(text("""
        UPDATE manufacturer_invitations SET code_hash = :h, status = 'invited',
          expires_at = now() + make_interval(days => :d), send_count = send_count + 1, last_sent_at = now(),
          reminders_sent = 0, last_reminded_at = NULL, updated_at = now()
        WHERE id = :i RETURNING *
    """), {"i": invitation_id, "h": _hash(code), "d": settings.manufacturer_invite_days})).mappings().one())
    await record_event(db, event="note", action="invitation_resent", role="admin", source="admin_entry",
                       organization_id=row["organization_id"], actor=admin_id, details={"email": row["email"]})
    await db.commit()
    mail = await _send(db, settings, row, code, reminder=False) if row["email"] else {"status": "none"}
    await db.commit()
    return {"invitation": _view(row, settings), "link": invite_url(settings, code), "email": mail["status"]}


async def cancel(db: AsyncSession, settings: Settings, *, admin_id: UUID, roles: tuple[str, ...],
                 invitation_id: UUID) -> dict:
    if not set(roles) & set(INVITE_ROLES):
        raise InvitationError("Only administrators and operators can invite manufacturers.", 403, "forbidden")
    row = await _locked(db, invitation_id)
    if row["status"] == "accepted":
        raise InvitationError("This invitation was already accepted.", 409, "accepted")
    row = dict((await db.execute(text("""
        UPDATE manufacturer_invitations SET status = 'cancelled', cancelled_at = now(), updated_at = now()
        WHERE id = :i RETURNING *
    """), {"i": invitation_id})).mappings().one())
    await record_event(db, event="note", action="invitation_cancelled", role="admin", source="admin_entry",
                       organization_id=row["organization_id"], actor=admin_id, details={"email": row["email"]})
    await db.commit()
    return _view(row, settings)


# ---------------------------------------------------------------------------- the link
async def _by_code(db: AsyncSession, code: str, lock: bool = False) -> dict | None:
    row = (await db.execute(text(
        "SELECT * FROM manufacturer_invitations WHERE code_hash = :h" + (" FOR UPDATE" if lock else "")),
        {"h": _hash(code or "")})).mappings().first()
    return dict(row) if row else None


async def open_link(db: AsyncSession, settings: Settings, clerk: ClerkManagement, code: str) -> dict:
    """Public. {status: 'open', ticket, ...} signs the person in (a fresh one-time Clerk token);
    'accepted' -> they sign in normally; 'expired' / 'cancelled' / 'invalid' -> a message."""
    row = await _by_code(db, code, lock=True)
    if not row:
        return {"status": "invalid"}
    base = {"companyName": row["company_name"], "email": row["email"] or "", "contactName": row["contact_name"] or ""}
    if row["status"] in ("accepted", "cancelled"):
        return {"status": row["status"], **base}
    if row["status"] == "expired" or row["expires_at"] <= datetime.now(timezone.utc):
        await db.execute(text("""
            UPDATE manufacturer_invitations SET status = 'expired', updated_at = now()
            WHERE id = :i AND status IN ('invited', 'opened')
        """), {"i": row["id"]})
        await db.commit()
        return {"status": "expired", **base}
    if row.get("claimed_at"):
        # A link made without an email, already claimed: never a ticket; the person signs in with
        # the code Clerk emails to the address they gave (so a link holder cannot use it for
        # somebody else's account).
        return {"status": "verify", **base}
    if not row["clerk_user_id"]:
        # A link made without an email: the person enters their email and confirms it (claim).
        await db.execute(text("""
            UPDATE manufacturer_invitations SET status = 'opened', opened_at = COALESCE(opened_at, now()),
              open_count = open_count + 1, updated_at = now()
            WHERE id = :i
        """), {"i": row["id"]})
        await record_event(db, event="note", action="invitation_opened", role="requester", source="web_dashboard",
                           organization_id=row["organization_id"], details={"openCount": row["open_count"] + 1})
        await db.commit()
        return {"status": "claim", **base}
    try:
        ticket = await clerk.sign_in_token(row["clerk_user_id"])
    except RuntimeError as exc:
        log.warning("Sign-in token for invitation %s: %s", row["id"], exc)
        raise InvitationError("We couldn't open your account right now. Please try again in a minute.",
                              502, "clerk_failed") from exc
    await db.execute(text("""
        UPDATE manufacturer_invitations SET status = 'opened', opened_at = COALESCE(opened_at, now()),
          open_count = open_count + 1, updated_at = now()
        WHERE id = :i
    """), {"i": row["id"]})
    await record_event(db, event="note", action="invitation_opened", role="requester", source="web_dashboard",
                       organization_id=row["organization_id"], details={"openCount": row["open_count"] + 1})
    await db.commit()
    return {"status": "open", "ticket": ticket, **base}


async def claim(db: AsyncSession, settings: Settings, clerk: ClerkManagement, *, code: str, email: str,
                name: str | None) -> dict:
    """A link made without an email: the person gives their email (and name). Their Clerk account
    is found or created and tied to the link; they then confirm the email with a code Clerk sends
    (on the page), so nobody can use a link to get into somebody else's account."""
    email, name = (email or "").strip().lower(), " ".join((name or "").split()) or None
    if not EMAIL_RE.match(email):
        raise InvitationError("Please enter a valid email address.", 422, "email_invalid")
    row = await _by_code(db, code, lock=True)
    if not row:
        raise InvitationError("This link is not valid. Ask XfactorY to send a new one.", 404, "invalid")
    if row["status"] in ("accepted", "cancelled") or row["status"] == "expired" \
            or row["expires_at"] <= datetime.now(timezone.utc):
        raise InvitationError("This link is no longer active. Ask XfactorY to send a new one.", 410, "not_open")
    if row["accepted_user_id"] or (row.get("claimed_at") and row["email"] == email):
        return {"status": "verify", "email": row["email"]}
    await _check_email(db, row["organization_id"], email, row["id"])
    first, last = _split_name(name or row["contact_name"] or "")
    try:
        clerk_user_id, created = await clerk.find_or_create_user(email, first, last)
    except RuntimeError as exc:
        log.warning("Claim for invitation %s: %s", row["id"], exc)
        raise InvitationError("We couldn't set up your account right now. Please try again in a minute.",
                              502, "clerk_failed") from exc
    await db.execute(text("""
        UPDATE manufacturer_invitations SET email = :e, contact_name = COALESCE(:n, contact_name),
          clerk_user_id = :cu, claimed_at = now(), updated_at = now() WHERE id = :i
    """), {"i": row["id"], "e": email, "n": name, "cu": clerk_user_id})
    await record_event(db, event="note", action="invitation_claimed", role="requester", source="web_dashboard",
                       organization_id=row["organization_id"], details={"email": email,
                                                                        "clerkAccountCreated": created})
    await db.commit()
    return {"status": "verify", "email": email}


async def accept(db: AsyncSession, settings: Settings, *, code: str, clerk_user_id: str,
                 clerk_session_id: str | None, terms_version: str | None, clerk_user: dict) -> dict:
    """The signed-in person accepts the Terms: registered, owner of the company, on the dashboard."""
    from app.identity.registration import SUSPENDED_MESSAGE, TERMS_OUTDATED_MESSAGE, TERMS_REQUIRED_MESSAGE
    from app.identity.repository import upsert_user

    if not terms_version:
        raise InvitationError(TERMS_REQUIRED_MESSAGE, 422, "terms_required")
    if terms_version != settings.terms_version:
        raise InvitationError(TERMS_OUTDATED_MESSAGE, 409, "terms_outdated")
    row = await _by_code(db, code, lock=True)
    if not row:
        raise InvitationError("This link is not valid. Ask XfactorY to send a new one.", 404, "invalid")
    if not row["clerk_user_id"] or row["clerk_user_id"] != clerk_user_id:
        raise InvitationError("This link belongs to another account. Sign out and open the link again.",
                              403, "other_account")
    if row["status"] == "accepted":
        return {"accepted": True, "alreadyAccepted": True, "returnPath": "/manufacturer/dashboard"}
    if row["status"] == "cancelled":
        raise InvitationError("This invitation was cancelled. Ask XfactorY to send a new link.", 410, "cancelled")
    if row["status"] == "expired" or row["expires_at"] <= datetime.now(timezone.utc):
        raise InvitationError("This link has expired. Ask XfactorY to send a new one.", 410, "expired")
    org_id = row["organization_id"]
    await db.execute(text("SELECT 1 FROM organizations WHERE id = :o FOR UPDATE"), {"o": org_id})

    first, last = clerk_user.get("first_name") or None, clerk_user.get("last_name") or None
    if not first:
        first, last = _split_name(row["contact_name"])
    user_id = await upsert_user(db, clerk_user_id=clerk_user_id, email=row["email"],
                                display_name=" ".join(p for p in (first, last) if p) or row["email"],
                                first_name=first, last_name=last or None, email_verified=True)
    status = await db.scalar(text("SELECT status FROM users WHERE id = :u"), {"u": user_id})
    if status != "active":
        raise InvitationError(SUSPENDED_MESSAGE, 403, "suspended")
    owner = await _active_owner(db, org_id)
    # The first person on a company without an owner becomes its owner; anyone else joins as an
    # additional login (role 'admin', can manage the company) and the company's approval is not touched.
    role = "owner" if not owner or owner == user_id else "admin"
    await db.execute(text("""
        UPDATE users SET registration_completed_at = COALESCE(registration_completed_at, now()),
          registration_method = COALESCE(registration_method, 'magic_link'),
          registration_channel = COALESCE(registration_channel, 'admin_portal'),
          registration_session_id = COALESCE(registration_session_id, :sid),
          accepted_terms_version = :tv, terms_accepted_at = now(),
          phone = COALESCE(NULLIF(phone, ''), :p), updated_at = now()
        WHERE id = :u
    """), {"u": user_id, "sid": clerk_session_id, "tv": terms_version, "p": row["phone"]})
    await db.execute(text("""
        INSERT INTO memberships (user_id, organization_id, membership_role, status, accepted_at)
        VALUES (:u, :o, :r, 'active', now())
        ON CONFLICT (organization_id, user_id) DO UPDATE SET
          membership_role = CASE WHEN memberships.membership_role = 'owner' THEN 'owner' ELSE :r END,
          status = 'active', accepted_at = COALESCE(memberships.accepted_at, now()), version = memberships.version + 1
    """), {"u": user_id, "o": org_id, "r": role})
    await db.execute(text("""
        INSERT INTO marketplace_role_selections (user_id, role_selected)
        SELECT :u, 'manufacturer' WHERE NOT EXISTS (
          SELECT 1 FROM marketplace_role_selections WHERE user_id = :u AND role_selected = 'manufacturer'
            AND status = 'active')
    """), {"u": user_id})
    # Not approved yet: the owner first checks the details the team entered and presses "Confirm
    # details", which sends them to admin approval (a separate step). Their sections are open
    # meanwhile (app/manufacturer_access.py, invited owner). An already approved company stays approved.
    if role == "owner":
        await db.execute(text("""
            INSERT INTO manufacturer_onboarding (organization_id, status, personal_information_completed, current_step)
            VALUES (:o, 'in_progress', true, 'company_information')
            ON CONFLICT (organization_id) DO UPDATE SET personal_information_completed = true,
              status = CASE WHEN manufacturer_onboarding.status IN ('approved', 'submitted', 'under_review')
                            THEN manufacturer_onboarding.status ELSE 'in_progress' END,
              version = manufacturer_onboarding.version + 1
        """), {"o": org_id})
        await db.execute(text("UPDATE organizations SET status = 'active', updated_at = now() WHERE id = :o"),
                         {"o": org_id})
    # Other open invitations stay open: a company can have several logins.
    await db.execute(text("""
        UPDATE manufacturer_invitations SET status = 'accepted', accepted_at = now(), accepted_user_id = :u,
          accepted_role = :r, updated_at = now() WHERE id = :i
    """), {"i": row["id"], "u": user_id, "r": role})
    await record_event(db, event="note", action="invitation_accepted", role="requester", source="web_dashboard",
                       organization_id=org_id, actor=user_id, details={"email": row["email"], "role": role})
    await db.commit()
    return {"accepted": True, "alreadyAccepted": False, "returnPath": "/manufacturer/dashboard",
            "userId": str(user_id), "role": role}


# ---------------------------------------------------------------------------- details source
async def mark_entered_by_xfactory(db: AsyncSession, org_id: UUID | str, admin_id: UUID) -> None:
    """Called when the team edits a company that has no owner yet (no commit)."""
    await db.execute(text(f"""
        UPDATE organizations SET details_source = 'entered_by_xfactory', details_source_at = now(),
          details_source_by_user_id = :a, details_reviewed_at = NULL, details_reviewed_by_user_id = NULL
        WHERE id = CAST(:o AS uuid) AND NOT EXISTS (
          SELECT 1 FROM memberships m WHERE m.organization_id = organizations.id AND m.status = 'active'
            AND m.membership_role IN {OWNER_ROLES})
    """), {"o": str(org_id), "a": admin_id})


async def confirm_details(db: AsyncSession, org_id: UUID, user_id: UUID) -> dict:
    """The manufacturer checked the details the team entered: they go to admin approval
    (review status Submitted, the admin's Onboarding & review queue). A correction request
    from the admin is answered the same way."""
    await db.execute(text("""
        UPDATE organizations SET details_source = 'confirmed_by_manufacturer', details_source_at = now(),
          details_source_by_user_id = :u, details_reviewed_at = NULL, details_reviewed_by_user_id = NULL
        WHERE id = :o
    """), {"o": org_id, "u": user_id})
    await db.execute(text("""
        INSERT INTO manufacturer_onboarding (organization_id, status, personal_information_completed, submitted_at)
        VALUES (:o, 'submitted', true, now())
        ON CONFLICT (organization_id) DO UPDATE SET
          status = CASE WHEN manufacturer_onboarding.status = 'approved' THEN 'approved' ELSE 'submitted' END,
          submitted_at = CASE WHEN manufacturer_onboarding.status = 'approved'
                              THEN manufacturer_onboarding.submitted_at ELSE now() END,
          version = manufacturer_onboarding.version + 1
    """), {"o": org_id})
    await record_event(db, event="note", action="details_confirmed", role="requester", source="web_dashboard",
                       organization_id=org_id, actor=user_id)
    await db.commit()
    return await details_state(db, org_id)


async def mark_reviewed(db: AsyncSession, org_id: UUID, admin_id: UUID) -> dict:
    """Quick review by the team after the manufacturer confirmed."""
    await db.execute(text("""
        UPDATE organizations SET details_reviewed_at = now(), details_reviewed_by_user_id = :a WHERE id = :o
    """), {"o": org_id, "a": admin_id})
    await record_event(db, event="note", action="details_reviewed", role="admin", source="admin_entry", organization_id=org_id,
                       actor=admin_id)
    await db.commit()
    return await details_state(db, org_id)


async def details_state(db: AsyncSession, org_id: UUID | str) -> dict:
    row = (await db.execute(text("""
        SELECT o.details_source, o.details_source_at, o.details_reviewed_at, u.display_name source_by,
               r.display_name reviewed_by, mo.status approval_status, mo.rejection_reason
        FROM organizations o
        LEFT JOIN users u ON u.id = o.details_source_by_user_id
        LEFT JOIN users r ON r.id = o.details_reviewed_by_user_id
        LEFT JOIN manufacturer_onboarding mo ON mo.organization_id = o.id
        WHERE o.id = CAST(:o AS uuid)
    """), {"o": str(org_id)})).mappings().first()
    if not row:
        return {"source": None, "at": None, "by": "", "reviewedAt": None, "reviewedBy": "",
                "approvalStatus": None, "feedback": None}
    return {"source": row["details_source"], "at": row["details_source_at"], "by": row["source_by"] or "",
            "reviewedAt": row["details_reviewed_at"], "reviewedBy": row["reviewed_by"] or "",
            "approvalStatus": row["approval_status"],
            "feedback": row["rejection_reason"] if row["approval_status"] == "changes_requested" else None}


# ---------------------------------------------------------------------------- reminders
async def send_reminders(db: AsyncSession, settings: Settings, now: datetime | None = None) -> dict:
    """Daily job: reminder emails on the configured days after the last send, with the same
    link; expired links are closed."""
    now = now or datetime.now(timezone.utc)
    expired = (await db.execute(text("""
        UPDATE manufacturer_invitations SET status = 'expired', updated_at = now()
        WHERE status IN ('invited', 'opened') AND expires_at <= :now RETURNING id
    """), {"now": now})).scalars().all()
    await db.commit()
    days = sorted(d for d in settings.manufacturer_invite_reminder_days if d > 0)
    rows = (await db.execute(text("""
        SELECT * FROM manufacturer_invitations WHERE status IN ('invited', 'opened') AND expires_at > :now
          AND email IS NOT NULL ORDER BY last_sent_at
    """), {"now": now})).mappings().all()
    sent = 0
    for raw in rows:
        row = dict(raw)
        due = sum(1 for d in days if now - row["last_sent_at"] >= timedelta(days=d))
        if due <= row["reminders_sent"]:
            continue
        code = _code(settings, row["id"], row["send_count"])
        await db.execute(text("""
            UPDATE manufacturer_invitations SET reminders_sent = :n, last_reminded_at = :now, updated_at = now()
            WHERE id = :i
        """), {"i": row["id"], "n": due, "now": now})
        await db.commit()
        await _send(db, settings, row, code, reminder=True)
        await db.commit()
        sent += 1
    return {"reminded": sent, "expired": len(expired)}
