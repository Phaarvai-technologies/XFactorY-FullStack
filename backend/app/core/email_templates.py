"""Email texts. Each function returns (subject, plain_text, html).
Values from users (names, notes) are HTML-escaped; no passwords or tokens are ever included."""
from html import escape

BLUE = "#2563eb"


def _html(title: str, paragraphs: list[str], button: tuple[str, str] | None = None, note: str | None = None) -> str:
    body = "".join(f'<p style="margin:0 0 14px;line-height:1.55">{p}</p>' for p in paragraphs)
    if note:
        body += (f'<div style="margin:0 0 16px;padding:12px 14px;border-radius:10px;background:#fffbeb;'
                 f'border:1px solid #fde68a;color:#78350f;white-space:pre-wrap">{note}</div>')
    if button:
        body += (f'<p style="margin:22px 0"><a href="{escape(button[1], quote=True)}" style="background:{BLUE};'
                 f'color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;'
                 f'display:inline-block">{escape(button[0])}</a></p>')
    return f"""<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;padding:28px 16px">
<div style="font-size:18px;font-weight:800;margin-bottom:16px">X!Y <span style="color:#94a3b8;font-weight:500;font-size:14px">Factory</span></div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:26px">
<h1 style="font-size:19px;margin:0 0 16px">{escape(title)}</h1>{body}</div>
<p style="font-size:12px;color:#94a3b8;margin-top:16px">You received this because you have an X!Y account. Please do not reply to this email.</p>
</div></body></html>"""


def _hello(name: str | None) -> str:
    return f"Hello {name}," if name else "Hello,"


def welcome(name, url):
    subject = "Welcome to X!Y"
    text = (f"{_hello(name)}\n\nWelcome to X!Y! Your account is ready.\n\n"
            f"Continue setting up: {url}\n\n"
            f"If you did not create this account, you can ignore this email.\n\nThe X!Y team")
    html = _html("Welcome to X!Y",
                 [escape(_hello(name)), "Welcome to X!Y! Your account is ready.",
                  "If you did not create this account, you can ignore this email."],
                 ("Continue setting up", url))
    return subject, text, html


def needs_correction(name, company, note, url):
    subject = f"Action needed: please update your {company or 'X!Y'} profile"
    text = (f"{_hello(name)}\n\nThe X!Y team reviewed your manufacturer profile for {company} and needs a few "
            f"changes before it can be approved:\n\n{note}\n\nUpdate your profile: {url}\n\nThank you,\nThe X!Y team")
    html = _html("Your profile needs a few changes",
                 [escape(_hello(name)), f"The X!Y team reviewed your manufacturer profile for "
                  f"<b>{escape(company or '')}</b> and needs a few changes before it can be approved:"],
                 ("Update my profile", url), escape(note or ""))
    return subject, text, html


def reviewed(name, company, url):
    subject = f"Your {company or 'X!Y'} profile has been reviewed"
    text = (f"{_hello(name)}\n\nGood news: the X!Y team has reviewed your manufacturer profile for {company}.\n\n"
            f"Open your dashboard: {url}\n\nThe X!Y team")
    html = _html("Your profile has been reviewed",
                 [escape(_hello(name)), f"Good news: the X!Y team has reviewed your manufacturer profile for "
                  f"<b>{escape(company or '')}</b>."], ("Open my dashboard", url))
    return subject, text, html


def account_suspended(name):
    subject = "Your X!Y account has been suspended"
    text = (f"{_hello(name)}\n\nYour X!Y account has been suspended, so you cannot sign in for now. "
            f"If you think this is a mistake, please contact X!Y support.\n\nThe X!Y team")
    html = _html("Your account has been suspended",
                 [escape(_hello(name)), "Your X!Y account has been suspended, so you cannot sign in for now.",
                  "If you think this is a mistake, please contact X!Y support."])
    return subject, text, html


def account_reactivated(name, url):
    subject = "Your X!Y account is active again"
    text = f"{_hello(name)}\n\nYour X!Y account is active again. You can sign in: {url}\n\nThe X!Y team"
    html = _html("Your account is active again",
                 [escape(_hello(name)), "Your X!Y account is active again. You can sign in as usual."],
                 ("Sign in", url))
    return subject, text, html


def admin_account_created(name, login_url):
    subject = "Your X!Y admin account"
    text = (f"{_hello(name)}\n\nAn X!Y admin account was created for this email address. Sign in at {login_url} "
            f"with the \"Admin account\" option, using the password given to you by your administrator.\n\n"
            f"If you did not expect this, contact your X!Y administrator.\n\nThe X!Y team")
    html = _html("Your X!Y admin account",
                 [escape(_hello(name)), "An X!Y admin account was created for this email address.",
                  "Sign in with the <b>Admin account</b> option, using the password given to you by your "
                  "administrator.", "If you did not expect this, contact your X!Y administrator."],
                 ("Open admin sign-in", login_url))
    return subject, text, html


def admin_password_changed(name, login_url):
    subject = "Your X!Y admin password was changed"
    text = (f"{_hello(name)}\n\nThe password of your X!Y admin account was just changed, and your other devices "
            f"were signed out.\n\nIf this was not you, contact your X!Y administrator immediately.\n\nThe X!Y team")
    html = _html("Your admin password was changed",
                 [escape(_hello(name)), "The password of your X!Y admin account was just changed, and your "
                  "other devices were signed out.",
                  "<b>If this was not you</b>, contact your X!Y administrator immediately."],
                 ("Open admin sign-in", login_url))
    return subject, text, html


def test_email(admin_name):
    subject = "X!Y test email"
    text = (f"This is a test email sent by {admin_name or 'an X!Y admin'} from the X!Y admin dashboard.\n\n"
            f"If you can read this, outgoing email works.")
    html = _html("Test email", [f"This is a test email sent by <b>{escape(admin_name or 'an X!Y admin')}</b> "
                                f"from the X!Y admin dashboard.", "If you can read this, outgoing email works."])
    return subject, text, html
