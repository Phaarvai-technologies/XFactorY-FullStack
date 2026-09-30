"""Welcome email for a newly registered user.

Called right after the user record is created (first API call after sign-up, or the Clerk
`user.created` webhook - whichever comes first). It runs in the background, so a slow or
unreachable mail server never delays sign-up, and it is sent at most once per user:
`users.welcome_email_sent_at` is claimed atomically before sending.

Note: the sign-up *verification code* email is sent by Clerk, not by this backend.
"""
import asyncio
import logging
from uuid import UUID

from sqlalchemy import text

from app.core import email_templates as tpl
from app.core.config import get_settings
from app.core.database import SessionFactory
from app.core.email import Mailer

log = logging.getLogger("xy.email")
_running: set[asyncio.Task] = set()


def send_welcome_soon(user_id: UUID | str) -> None:
    try:
        task = asyncio.get_running_loop().create_task(send_welcome(user_id))
    except RuntimeError:  # no event loop (should not happen inside FastAPI)
        return
    _running.add(task)
    task.add_done_callback(_running.discard)


async def send_welcome(user_id: UUID | str) -> dict | None:
    settings = get_settings()
    mailer_check = Mailer(settings)
    if not mailer_check.enabled:
        return None  # email off: do not claim, nothing is recorded
    try:
        async with SessionFactory() as db:
            row = (await db.execute(text("""
                UPDATE users SET welcome_email_sent_at = now()
                WHERE id = CAST(:u AS uuid) AND welcome_email_sent_at IS NULL AND status = 'active'
                  AND clerk_user_id NOT LIKE 'local-admin:%'
                RETURNING email::text AS email, first_name
            """), {"u": str(user_id)})).first()
            await db.commit()
            if row is None:
                return None  # already welcomed (or staff-only / suspended account)
            subject, text_body, html = tpl.welcome(row.first_name or "", f"{settings.app_base_url.rstrip('/')}/")
            return await Mailer(settings, db).send(row.email, "welcome", subject, text_body, html,
                                                   user_id=str(user_id))
    except Exception as exc:  # noqa: BLE001 - never break sign-up
        log.warning("Welcome email for user %s not sent: %s", user_id, exc)
        return None


async def wait_for_pending() -> None:
    """Tests and shutdown: wait for welcome emails still being sent."""
    if _running:
        await asyncio.gather(*list(_running), return_exceptions=True)
