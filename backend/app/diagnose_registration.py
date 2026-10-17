"""Read-only diagnosis of "registered user is told to sign up" (changes nothing, prints no secrets).

    PYTHONPATH=. python -m app.diagnose_registration --email user@example.com \
        [--publishable-key "$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]

Reports
  1. Configuration: which Clerk instance the frontend key, the backend issuer / JWKS URL and the
     backend secret key belong to (test vs live, host), whether the webhook secret is set, and
     which database (host / name) this backend uses. A mismatch means users exist under other
     Clerk user ids or in another database.
  2. Accounts for the email: each users row with its Clerk id, registration marker and the
     legacy evidence the backend would accept; the Clerk user(s) with that email in THIS
     instance (password set? legal terms accepted?) and whether their ids match the rows.
  3. A verdict per account: REGISTERED, RECOGNISED AT NEXT SIGN-IN (evidence), NO EVIDENCE
     (must complete Sign-up), ID MISMATCH (the email's account belongs to another Clerk user id),
     or NO ACCOUNT.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import sys
from urllib.parse import urlparse

import httpx
from sqlalchemy import text

from app.core.config import Settings, get_settings
from app.identity.registration import _DB_EVIDENCE_SQL
from app.core.cli import run as run_cli


def publishable_key_host(key: str | None) -> tuple[str | None, str | None]:
    """pk_test_<base64("host$")> -> ("test", "host"). Public value; safe to decode."""
    if not key or not key.startswith(("pk_test_", "pk_live_")):
        return None, None
    kind, encoded = key[3:7], key[8:]
    try:
        host = base64.b64decode(encoded + "=" * (-len(encoded) % 4)).decode().rstrip("$")
    except Exception:  # noqa: BLE001
        return kind, None
    return kind, host


def config_report(settings: Settings, publishable_key: str | None) -> list[str]:
    lines = []
    fe_kind, fe_host = publishable_key_host(publishable_key)
    issuers = [urlparse(i).netloc or i for i in settings.clerk_issuers]
    jwks_host = urlparse(settings.clerk_jwks_url or "").netloc
    secret = settings.clerk_secret_key or ""
    secret_kind = "live" if secret.startswith("sk_live_") else "test" if secret.startswith("sk_test_") else None
    lines.append(f"frontend publishable key : {fe_kind or 'not given'} instance, host {fe_host or '?'}")
    lines.append(f"backend CLERK_ISSUER     : {', '.join(issuers) or 'NOT SET'}")
    lines.append(f"backend CLERK_JWKS_URL   : host {jwks_host or 'NOT SET'}")
    lines.append(f"backend CLERK_SECRET_KEY : {'set (' + secret_kind + ')' if secret_kind else 'NOT SET or unrecognised'}")
    lines.append(f"backend webhook secret   : {'set' if settings.clerk_webhook_signing_secret else 'not set (webhook optional)'}")
    db = urlparse(settings.database_url.replace("+asyncpg", ""))
    lines.append(f"backend database         : host {db.hostname}, database {db.path.lstrip('/')}")
    problems = []
    if fe_host and issuers and fe_host not in issuers:
        problems.append(f"frontend Clerk host {fe_host} is not in CLERK_ISSUER - tokens will be rejected (401), "
                        "or users exist under different Clerk ids")
    if fe_kind and secret_kind and fe_kind != secret_kind:
        problems.append(f"frontend key is a {fe_kind} key but CLERK_SECRET_KEY is a {secret_kind} key: different instances")
    if jwks_host and issuers and jwks_host not in issuers:
        problems.append(f"CLERK_JWKS_URL host {jwks_host} differs from CLERK_ISSUER")
    lines += [f"PROBLEM: {p}" for p in problems] or ["configuration: frontend and backend point at the same Clerk host"]
    return lines


async def clerk_users_by_email(settings: Settings, email: str, client: httpx.AsyncClient | None = None) -> list[dict] | None:
    if not settings.clerk_secret_key:
        return None
    own = client is None
    client = client or httpx.AsyncClient(timeout=10)
    try:
        r = await client.get("https://api.clerk.com/v1/users", params={"email_address": email},
                             headers={"Authorization": f"Bearer {settings.clerk_secret_key}"})
        r.raise_for_status()
        return r.json()
    finally:
        if own:
            await client.aclose()


async def account_report(session, settings: Settings, email: str, clerk_users: list[dict] | None) -> list[str]:
    lines = []
    cutoff = await session.scalar(text("SELECT value FROM registration_settings WHERE key = 'legacy_cutoff'"))
    rows = (await session.execute(text("""
        SELECT id, clerk_user_id, status, created_at, registration_completed_at, registration_method
        FROM users WHERE email = CAST(:e AS citext) ORDER BY created_at
    """), {"e": email})).mappings().all()
    clerk_ids = {u["id"]: u for u in clerk_users or []}
    lines.append(f"legacy cutoff            : {cutoff}")
    if clerk_users is None:
        lines.append("Clerk lookup             : skipped (no CLERK_SECRET_KEY)")
    else:
        for u in clerk_users:
            lines.append(f"Clerk user {u['id']}: password={'yes' if u.get('password_enabled') else 'no'}, "
                         f"legal terms accepted={'yes' if u.get('legal_accepted_at') else 'no'}")
        if not clerk_users:
            lines.append("Clerk users with this email in this instance: none")
    if not rows:
        lines.append("VERDICT: NO ACCOUNT in this database for this email")
        return lines
    for row in rows:
        head = (f"users row {row['id']} clerk={row['clerk_user_id']} status={row['status']} "
                f"created={row['created_at']:%Y-%m-%d}")
        if row["registration_completed_at"]:
            verdict = f"REGISTERED ({row['registration_method']})"
        elif row["status"] != "active":
            verdict = f"NOT ACTIVE ({row['status']})"
        else:
            evidence = None
            if cutoff and row["created_at"] < cutoff:
                evidence = await session.scalar(text(_DB_EVIDENCE_SQL), {"id": row["id"]})
                cu = clerk_ids.get(row["clerk_user_id"])
                if not evidence and cu:
                    evidence = ("legacy_password" if cu.get("password_enabled")
                                else "legacy_legal_terms" if cu.get("legal_accepted_at") else None)
            if evidence:
                verdict = f"RECOGNISED AT NEXT SIGN-IN ({evidence})"
            elif clerk_users is not None and clerk_users and row["clerk_user_id"] not in clerk_ids \
                    and not row["clerk_user_id"].startswith("local-admin:"):
                verdict = ("ID MISMATCH: this row's Clerk id is not a user of the configured Clerk instance "
                           f"(instance has {', '.join(clerk_ids)})")
            else:
                verdict = "NO EVIDENCE of a completed sign-up: the person must complete Sign-up (same account, no duplicate)"
        lines.append(f"{head}\n  VERDICT: {verdict}")
    return lines


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only registration diagnosis")
    parser.add_argument("--email", required=True)
    parser.add_argument("--publishable-key", default=None, help="frontend NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (public)")
    args = parser.parse_args(argv)
    settings = get_settings()
    print("\n".join(config_report(settings, args.publishable_key)))
    from app.core.database import SessionFactory, engine
    try:
        clerk_users = await clerk_users_by_email(settings, args.email)
    except httpx.HTTPError as exc:
        print(f"Clerk lookup failed: {type(exc).__name__} (check CLERK_SECRET_KEY / network)")
        clerk_users = None
    async with SessionFactory() as session:
        print("\n".join(await account_report(session, settings, args.email, clerk_users)))
    await engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(run_cli(main()))
