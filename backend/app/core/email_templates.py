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
<div style="font-size:18px;font-weight:800;margin-bottom:16px">XfactorY <span style="color:#94a3b8;font-weight:500;font-size:14px">Factory</span></div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:26px">
<h1 style="font-size:19px;margin:0 0 16px">{escape(title)}</h1>{body}</div>
<p style="font-size:12px;color:#94a3b8;margin-top:16px">You received this because you have an XfactorY account. Please do not reply to this email.</p>
</div></body></html>"""


def _hello(name: str | None) -> str:
    return f"Hello {name}," if name else "Hello,"


def welcome(name, url):
    subject = "Welcome to XfactorY"
    text = (f"{_hello(name)}\n\nWelcome to XfactorY! Your account is ready.\n\n"
            f"Continue setting up: {url}\n\n"
            f"If you did not create this account, you can ignore this email.\n\nThe XfactorY team")
    html = _html("Welcome to XfactorY",
                 [escape(_hello(name)), "Welcome to XfactorY! Your account is ready.",
                  "If you did not create this account, you can ignore this email."],
                 ("Continue setting up", url))
    return subject, text, html


def needs_correction(name, company, note, url):
    subject = f"Action needed: please update your {company or 'XfactorY'} profile"
    text = (f"{_hello(name)}\n\nThe XfactorY team reviewed your manufacturer profile for {company} and needs a few "
            f"changes before it can be approved:\n\n{note}\n\nUpdate your profile: {url}\n\nThank you,\nThe XfactorY team")
    html = _html("Your profile needs a few changes",
                 [escape(_hello(name)), f"The XfactorY team reviewed your manufacturer profile for "
                  f"<b>{escape(company or '')}</b> and needs a few changes before it can be approved:"],
                 ("Update my profile", url), escape(note or ""))
    return subject, text, html


def reviewed(name, company, url):
    subject = f"Your {company or 'XfactorY'} profile has been reviewed"
    text = (f"{_hello(name)}\n\nGood news: the XfactorY team has reviewed your manufacturer profile for {company}.\n\n"
            f"Open your dashboard: {url}\n\nThe XfactorY team")
    html = _html("Your profile has been reviewed",
                 [escape(_hello(name)), f"Good news: the XfactorY team has reviewed your manufacturer profile for "
                  f"<b>{escape(company or '')}</b>."], ("Open my dashboard", url))
    return subject, text, html


def application_submitted(applicant, company, kind_label, resubmitted, url):
    """To XfactorY admins: a manufacturer application (or its corrections) is waiting for review."""
    what = "Corrections submitted" if resubmitted else "New manufacturer application"
    subject = f"{what}: {company or 'company'}"
    text = (f"Hello,\n\n{what.lower() if resubmitted else what} from {applicant} for {company} "
            f"({kind_label}). It is waiting for review in the admin portal.\n\nReview it: {url}\n\nXfactorY")
    html = _html(what, [f"{escape(applicant or 'An applicant')} sent "
                        f"{'corrections to their application' if resubmitted else 'a manufacturer application'} for "
                        f"<b>{escape(company or '')}</b> ({escape(kind_label)}).",
                        "It is waiting for review in the admin portal."], ("Open the review", url))
    return subject, text, html


def application_rejected(name, company, note, reapply_from, url):
    """To the applicant: the manufacturer application was not approved (applicant-facing reason only)."""
    subject = f"Your manufacturer application for {company or 'XfactorY'} was not approved"
    text = (f"{_hello(name)}\n\nThe XfactorY team reviewed your manufacturer application for {company} and could not "
            f"approve it:\n\n{note}\n\nYou can send a new application from {reapply_from}.\n\n"
            f"Open your dashboard: {url}\n\nThe XfactorY team")
    html = _html("Your application was not approved",
                 [escape(_hello(name)), f"The XfactorY team reviewed your manufacturer application for "
                  f"<b>{escape(company or '')}</b> and could not approve it:",
                  f"You can send a new application from {escape(reapply_from)}."],
                 ("Open my dashboard", url), escape(note or ""))
    return subject, text, html


def account_suspended(name):
    subject = "Your XfactorY account has been suspended"
    text = (f"{_hello(name)}\n\nYour XfactorY account has been suspended, so you cannot sign in for now. "
            f"If you think this is a mistake, please contact XfactorY support.\n\nThe XfactorY team")
    html = _html("Your account has been suspended",
                 [escape(_hello(name)), "Your XfactorY account has been suspended, so you cannot sign in for now.",
                  "If you think this is a mistake, please contact XfactorY support."])
    return subject, text, html


def account_reactivated(name, url):
    subject = "Your XfactorY account is active again"
    text = f"{_hello(name)}\n\nYour XfactorY account is active again. You can sign in: {url}\n\nThe XfactorY team"
    html = _html("Your account is active again",
                 [escape(_hello(name)), "Your XfactorY account is active again. You can sign in as usual."],
                 ("Sign in", url))
    return subject, text, html


def admin_account_created(name, login_url):
    subject = "Your XfactorY admin account"
    text = (f"{_hello(name)}\n\nAn XfactorY admin account was created for this email address. Sign in at {login_url} "
            f"with the \"Admin account\" option, using the password given to you by your administrator.\n\n"
            f"If you did not expect this, contact your XfactorY administrator.\n\nThe XfactorY team")
    html = _html("Your XfactorY admin account",
                 [escape(_hello(name)), "An XfactorY admin account was created for this email address.",
                  "Sign in with the <b>Admin account</b> option, using the password given to you by your "
                  "administrator.", "If you did not expect this, contact your XfactorY administrator."],
                 ("Open admin sign-in", login_url))
    return subject, text, html


def admin_password_changed(name, login_url):
    subject = "Your XfactorY admin password was changed"
    text = (f"{_hello(name)}\n\nThe password of your XfactorY admin account was just changed, and your other devices "
            f"were signed out.\n\nIf this was not you, contact your XfactorY administrator immediately.\n\nThe XfactorY team")
    html = _html("Your admin password was changed",
                 [escape(_hello(name)), "The password of your XfactorY admin account was just changed, and your "
                  "other devices were signed out.",
                  "<b>If this was not you</b>, contact your XfactorY administrator immediately."],
                 ("Open admin sign-in", login_url))
    return subject, text, html


def test_email(admin_name):
    subject = "XfactorY test email"
    text = (f"This is a test email sent by {admin_name or 'an XfactorY admin'} from the XfactorY admin dashboard.\n\n"
            f"If you can read this, outgoing email works.")
    html = _html("Test email", [f"This is a test email sent by <b>{escape(admin_name or 'an XfactorY admin')}</b> "
                                f"from the XfactorY admin dashboard.", "If you can read this, outgoing email works."])
    return subject, text, html
