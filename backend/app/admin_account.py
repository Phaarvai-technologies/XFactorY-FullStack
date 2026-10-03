"""Manage admin email + password accounts (the "Admin account" sign-in at /admin/login).

    PYTHONPATH=. python -m app.admin_account create  you@company.com --name "Priya Nair"
    PYTHONPATH=. python -m app.admin_account password you@company.com     # set a new password
    PYTHONPATH=. python -m app.admin_account disable  you@company.com     # blocks sign-in, ends sessions
    PYTHONPATH=. python -m app.admin_account enable   you@company.com     # also clears a lockout
    PYTHONPATH=. python -m app.admin_account list

The password is asked for (hidden input), never passed on the command line.
For scripts, add --password-stdin and pipe it in.

If the email already belongs to an X!Y (Clerk) user, the admin account is linked to
that user: they can then sign in either way. Otherwise a staff-only user record is
created. `create` also grants the platform_administrator role.
"""
import argparse
import asyncio
import getpass
import sys
import uuid

from sqlalchemy import text

from app.admin.accounts import LOCAL_CLERK_PREFIX, hash_password, password_problem
from app.admin.auth import grant
from app.core import email_templates as tpl
from app.core.config import get_settings
from app.core.database import SessionFactory
from app.core.email import Mailer


def read_password(email: str, from_stdin: bool) -> str:
    if from_stdin:
        password = sys.stdin.readline().rstrip("\n")
        problem = password_problem(password, email)
        if problem:
            raise SystemExit(f"Password rejected: {problem}")
        return password
    while True:
        password = getpass.getpass("Password: ")
        problem = password_problem(password, email)
        if problem:
            print(f"  {problem}")
            continue
        if getpass.getpass("Repeat password: ") != password:
            print("  The passwords do not match.")
            continue
        return password


async def create(email: str, name: str | None, from_stdin: bool) -> int:
    async with SessionFactory() as db:
        if await db.scalar(text("SELECT 1 FROM admin_accounts WHERE email=CAST(:e AS citext)"), {"e": email}):
            print(f"An admin account for {email} already exists. Use 'password' to change its password.")
            return 1
        password = read_password(email, from_stdin)
        user = (await db.execute(text("SELECT id, clerk_user_id FROM users WHERE email=CAST(:e AS citext)"),
                                 {"e": email})).first()
        if user:
            user_id = user.id
            linked = not str(user.clerk_user_id).startswith(LOCAL_CLERK_PREFIX)
        else:
            first, _, last = (name or "").strip().partition(" ")
            user_id = await db.scalar(text("""
                INSERT INTO users (clerk_user_id, email, display_name, first_name, last_name, status)
                VALUES (:c, :e, :d, NULLIF(:f, ''), NULLIF(:l, ''), 'active') RETURNING id
            """), {"c": f"{LOCAL_CLERK_PREFIX}{uuid.uuid4()}", "e": email, "d": (name or email).strip(),
                   "f": first, "l": last.strip()})
            linked = False
        await db.execute(text("""
            INSERT INTO admin_accounts (user_id, email, password_hash) VALUES (:u, :e, :p)
        """), {"u": user_id, "e": email, "p": hash_password(password)})
        await grant(db, user_id)
        await db.commit()
        settings = get_settings()
        subject, text_body, html = tpl.admin_account_created(
            (name or "").strip().split(" ")[0], f"{settings.app_base_url.rstrip('/')}/admin/login")
        sent = await Mailer(settings, db).send(email, "admin_account_created", subject, text_body, html,
                                               user_id=user_id)
    print(f"Welcome email: {sent['status']}" + (f" ({sent['error']})" if sent["error"] else ""))
    print(f"Admin account created for {email}"
          + (" (linked to their X!Y sign-in; both work)." if linked else " (staff-only account).")
          + " Sign in at /admin/login.")
    return 0


async def set_password(email: str, from_stdin: bool) -> int:
    async with SessionFactory() as db:
        acct = await db.scalar(text("SELECT id FROM admin_accounts WHERE email=CAST(:e AS citext)"), {"e": email})
        if not acct:
            print(f"No admin account for {email}.")
            return 1
        password = read_password(email, from_stdin)
        await db.execute(text("""
            UPDATE admin_accounts SET password_hash=:p, password_changed_at=now(), failed_attempts=0,
                   locked_until=NULL, updated_at=now() WHERE id=:a
        """), {"p": hash_password(password), "a": acct})
        await db.execute(text("UPDATE admin_sessions SET revoked_at=now() WHERE account_id=:a AND revoked_at IS NULL"),
                         {"a": acct})
        await db.commit()
    print(f"Password changed for {email}. Existing sessions were signed out.")
    return 0


async def set_status(email: str, active: bool) -> int:
    async with SessionFactory() as db:
        acct = await db.scalar(text("""
            UPDATE admin_accounts SET status=:s, failed_attempts=0, locked_until=NULL, updated_at=now()
            WHERE email=CAST(:e AS citext) RETURNING id
        """), {"s": "active" if active else "disabled", "e": email})
        if not acct:
            print(f"No admin account for {email}.")
            return 1
        if not active:
            await db.execute(text("UPDATE admin_sessions SET revoked_at=now() WHERE account_id=:a AND revoked_at IS NULL"),
                             {"a": acct})
        await db.commit()
    print(f"Admin account {email} {'enabled' if active else 'disabled'}.")
    return 0


async def list_accounts() -> int:
    async with SessionFactory() as db:
        rows = (await db.execute(text("""
            SELECT a.email::text, a.status, a.last_login_at, a.locked_until > now() AS locked,
                   u.clerk_user_id NOT LIKE 'local-admin:%' AS linked
            FROM admin_accounts a JOIN users u ON u.id=a.user_id ORDER BY a.email
        """))).all()
    if not rows:
        print("No admin accounts yet.")
    for r in rows:
        print(f"{r[0]:40} {r[1]:9} {'locked ' if r[3] else ''}{'linked to X!Y sign-in ' if r[4] else ''}"
              f"last sign-in: {r[2] or 'never'}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Manage admin email + password accounts.")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create")
    c.add_argument("email")
    c.add_argument("--name")
    c.add_argument("--password-stdin", action="store_true")
    pw = sub.add_parser("password")
    pw.add_argument("email")
    pw.add_argument("--password-stdin", action="store_true")
    for n in ("disable", "enable"):
        sub.add_parser(n).add_argument("email")
    sub.add_parser("list")
    a = p.parse_args()
    if a.cmd == "create":
        return asyncio.run(create(a.email.strip(), a.name, a.password_stdin))
    if a.cmd == "password":
        return asyncio.run(set_password(a.email.strip(), a.password_stdin))
    if a.cmd in ("disable", "enable"):
        return asyncio.run(set_status(a.email.strip(), a.cmd == "enable"))
    return asyncio.run(list_accounts())


if __name__ == "__main__":
    sys.exit(main())
