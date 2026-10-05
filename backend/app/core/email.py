"""Outgoing email over SMTP.

Off unless SMTP_HOST is set (attempts are then logged as "skipped"). To send, set SMTP_* to
an email provider. Clerk's own emails (verification codes) are sent by Clerk, not here.

Every attempt is written to `email_deliveries` (to, template, subject, result) so admins
can see the delivery status in Users -> troubleshooting. The email body, passwords and
tokens are never stored. Sending never breaks the action that triggered it: a failure is
logged and reported, and the admin's change is already saved.
"""
import asyncio
import logging
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings

log = logging.getLogger("xy.email")
EMAIL_RE = re.compile(r"^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$")


def one_line(value: str | None, limit: int = 200) -> str:
    """Header-safe text: no line breaks (prevents header injection), bounded length."""
    return re.sub(r"[\r\n\t]+", " ", value or "").strip()[:limit]


class Mailer:
    def __init__(self, settings: Settings, db: AsyncSession | None = None):
        self.settings = settings
        self.db = db

    @property
    def enabled(self) -> bool:
        return bool(self.settings.smtp_host)

    def _build(self, to: str, subject: str, text_body: str, html_body: str | None) -> EmailMessage:
        msg = EmailMessage()
        msg["From"] = self.settings.email_from
        msg["To"] = to
        msg["Subject"] = one_line(subject)
        msg["Date"] = formatdate(localtime=False)
        domain = parseaddr(self.settings.email_from)[1].split("@")[-1] or "xyfactory.local"
        msg["Message-ID"] = make_msgid(domain=domain)
        msg.set_content(text_body)
        if html_body:
            msg.add_alternative(html_body, subtype="html")
        return msg

    def _deliver(self, msg: EmailMessage) -> None:
        s = self.settings
        timeout = s.smtp_timeout_seconds
        if s.smtp_security == "ssl":
            server = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=timeout,
                                      context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=timeout)
        with server:
            if s.smtp_security == "starttls":
                server.starttls(context=ssl.create_default_context())
            if s.smtp_username:
                server.login(s.smtp_username, s.smtp_password)
            server.send_message(msg)

    async def send(self, to: str, template: str, subject: str, text_body: str, html_body: str | None = None,
                   user_id=None, organization_id=None, log_subject: str | None = None) -> dict:
        """Returns {"status": "sent" | "failed" | "skipped", "error": str | None}.
        `log_subject` replaces the subject in the delivery log (e.g. to hide a one-time code)."""
        to = one_line(to, 320)
        status, error, message_id = "sent", None, None
        if not EMAIL_RE.match(to):
            status, error = "failed", "Invalid recipient address"
        elif not self.enabled:
            status, error = "skipped", "Email is off (SMTP_HOST is not set)"
        else:
            try:
                msg = self._build(to, subject, text_body, html_body)
                message_id = msg["Message-ID"]
                await asyncio.to_thread(self._deliver, msg)
            except Exception as exc:  # noqa: BLE001 - reported, never raised to the caller
                status, error = "failed", f"{type(exc).__name__}: {exc}"[:300]
                log.warning("Email '%s' to %s failed: %s", template, to, error)
        await self._record(to, template, one_line(log_subject if log_subject is not None else subject), status, error, message_id, user_id, organization_id)
        return {"status": status, "error": error}

    async def _record(self, to, template, subject, status, error, message_id, user_id, organization_id) -> None:
        if self.db is None:
            return
        try:
            await self.db.execute(text("""
                INSERT INTO email_deliveries (to_email, user_id, organization_id, template, subject, status,
                                              error, message_id)
                VALUES (:to, :u, :o, :t, :s, :st, :e, :m)
            """), {"to": to, "u": user_id, "o": organization_id, "t": template, "s": subject, "st": status,
                   "e": error, "m": message_id})
            await self.db.commit()
        except Exception as exc:  # noqa: BLE001 - logging must not break the request
            await self.db.rollback()
            log.warning("Could not record email delivery: %s", exc)
