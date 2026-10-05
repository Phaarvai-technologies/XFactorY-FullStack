"""Outgoing email. Unit tests need nothing; the end-to-end tests need PostgreSQL
(E2E_DATABASE_URL). No mail server is used: sent messages are captured in memory."""
import os
import uuid

import pytest

from test_admin import auth, make_admin, new_manufacturer, no_clerk  # noqa: F401
from test_e2e_local import client  # noqa: F401

needs_all = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="needs E2E_DATABASE_URL")


def settings(**kw):
    from app.core.config import Settings
    return Settings(database_url="postgresql+asyncpg://x@localhost/x", clerk_issuer="x", clerk_jwks_url="x", **kw)


async def test_email_off_without_smtp_host():
    from app.core.email import Mailer
    r = await Mailer(settings(smtp_host="")).send("a@example.com", "test", "Hi", "Body")
    assert r == {"status": "skipped", "error": "Email is off (SMTP_HOST is not set)"}


async def test_bad_recipient_is_refused_before_smtp():
    from app.core.email import Mailer
    m = Mailer(settings(smtp_host="127.0.0.1", smtp_port=9))
    for bad in ("not-an-email", "a@b.com, c@d.com", "x@y.com\nBcc: evil@z.com"):
        assert (await m.send(bad, "test", "Hi", "Body"))["status"] == "failed"


async def test_unreachable_smtp_is_reported_not_raised():
    from app.core.email import Mailer
    r = await Mailer(settings(smtp_host="127.0.0.1", smtp_port=9, smtp_timeout_seconds=2)).send(
        "a@example.com", "test", "Hi", "Body")
    assert r["status"] == "failed" and r["error"]


def test_subject_line_breaks_are_removed():
    from app.core.email import Mailer
    msg = Mailer(settings(smtp_host="x"))._build("a@example.com", "Hello\r\nBcc: evil@z.com", "b", None)
    assert "\n" not in msg["Subject"] and msg["Subject"] == "Hello Bcc: evil@z.com"


def test_templates_escape_html_and_never_contain_secrets():
    from app.core import email_templates as tpl
    subject, text, html = tpl.needs_correction("<b>Ravi</b>", "Acme <script>", "Fix <img src=x>", "https://x/y")
    assert "<script>" not in html and "&lt;script&gt;" in html and "&lt;img" in html
    for fn in (tpl.admin_password_changed("A", "https://x/admin/login"), tpl.admin_account_created("A", "u")):
        assert "password:" not in fn[1].lower()


@pytest.fixture
def outbox(monkeypatch):
    """Email on (SMTP_HOST set), but delivery is captured here instead of an SMTP server."""
    from app.core.config import get_settings
    from app.core.email import Mailer
    s = get_settings()
    monkeypatch.setattr(s, "smtp_host", "smtp.test.invalid")
    monkeypatch.setattr(s, "app_base_url", "https://app.example.com")
    class Outbox(list):
        def to(self, addr):
            return [m for m in self if m["To"] == addr]

        @staticmethod
        def text(m):
            return m.get_body(("plain",)).get_content()

    sent = Outbox()
    monkeypatch.setattr(Mailer, "_deliver", lambda self, msg: sent.append(msg))
    return sent


@needs_all
async def test_review_and_account_emails_are_sent(client, no_clerk, outbox):  # noqa: F811
    from app.core.welcome import wait_for_pending
    admin = await make_admin(client, f"admin_{uuid.uuid4().hex[:8]}")
    tag = uuid.uuid4().hex[:6]
    sub, mh, org = await new_manufacturer(client, f"Mail Co {tag}")
    owner = (await client.sql("SELECT email::text, id FROM users WHERE clerk_user_id=:s", s=sub))[0]

    r = await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=admin,
                           json={"review_status": "NEEDS_CORRECTION", "reason": "Please add at least one FAQ."})
    assert r.status_code == 200 and r.json()["email"]["status"] == "sent"
    r = await client.patch(f"/admin/manufacturers/{org}/admin-fields", headers=admin,
                           json={"review_status": "REVIEWED"})
    assert r.json()["email"]["template"] == "review_reviewed"

    uid = str(owner[1])
    assert (await client.post(f"/admin/users/{uid}/suspend", headers=admin, json={"reason": "Spam"})).json()[
        "email"]["status"] == "sent"
    r = await client.post(f"/admin/users/{uid}/reactivate", headers=admin, json={"reason": "Checked, all fine"})
    assert r.status_code == 200, r.text
    assert r.json()["email"]["status"] == "sent", r.json()["email"]

    await wait_for_pending()
    mails = outbox.to(owner[0])
    assert sorted(m["Subject"] for m in mails) == sorted([
        "Welcome to X!Y", f"Action needed: please update your Mail Co {tag} profile",
        f"Your Mail Co {tag} profile has been reviewed",
        "Your X!Y account has been suspended", "Your X!Y account is active again"])
    first = next(m for m in mails if m["Subject"].startswith("Action needed"))
    assert "Please add at least one FAQ." in outbox.text(first)
    assert "https://app.example.com/manufacturer/dashboard" in outbox.text(first)
    assert all("Spam" not in m.as_string() for m in mails)  # internal reason is not sent to the user

    detail = (await client.get(f"/admin/users/{uid}", headers=admin)).json()["troubleshooting"]
    assert len(detail["emails"]) == 5 and all(e["status"] == "sent" for e in detail["emails"])
    assert detail["notificationStatus"].startswith("Last email sent:")


@needs_all
async def test_test_email_and_log(client, outbox):  # noqa: F811
    admin = await make_admin(client, f"admin_{uuid.uuid4().hex[:8]}")
    to = f"check_{uuid.uuid4().hex[:6]}@example.com"
    r = (await client.post("/admin/support/test-email", headers=admin, json={"to": to})).json()
    assert r["status"] == "sent" and r["smtpConfigured"] is True
    assert [m["Subject"] for m in outbox.to(to)] == ["X!Y test email"]
    log = (await client.get("/admin/support/emails", headers=admin)).json()
    assert any(e["to_email"] == to and e["status"] == "sent" for e in log["emails"])
    bad = (await client.post("/admin/support/test-email", headers=admin, json={"to": "nope"})).json()
    assert bad["status"] == "failed"


@needs_all
async def test_email_off_by_default_is_logged_as_skipped(client):  # noqa: F811
    admin = await make_admin(client, f"admin_{uuid.uuid4().hex[:8]}")
    r = (await client.post("/admin/support/test-email", headers=admin, json={"to": "x@example.com"})).json()
    assert r["status"] == "skipped" and r["smtpConfigured"] is False


@needs_all
async def test_new_user_gets_one_welcome_email(client, outbox):  # noqa: F811
    from app.core.welcome import send_welcome, wait_for_pending
    sub = f"user_{uuid.uuid4().hex[:10]}"
    h = {"Authorization": f"Bearer {client.token_for(sub)}"}
    for _ in range(3):  # first request creates the user; later requests must not resend
        assert (await client.get("/identity/me", headers=h)).status_code < 500
    await wait_for_pending()
    uid = (await client.sql("SELECT id FROM users WHERE clerk_user_id=:s", s=sub))[0][0]
    assert await send_welcome(uid) is None  # e.g. the Clerk webhook arriving later: no duplicate
    mails = outbox.to(f"{sub}@example.com")
    assert [m["Subject"] for m in mails] == ["Welcome to X!Y"]
    assert "Hello Jordan," in outbox.text(mails[0]) and "https://app.example.com/" in outbox.text(mails[0])
    log = await client.sql("SELECT template, status FROM email_deliveries WHERE user_id=:u", u=uid)
    assert [tuple(r) for r in log] == [("welcome", "sent")]


async def test_welcome_is_skipped_when_email_is_off(monkeypatch):
    from app.core import welcome
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "smtp_host", "")
    assert await welcome.send_welcome(uuid.uuid4()) is None  # no DB call, nothing claimed
