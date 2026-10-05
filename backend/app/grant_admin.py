"""Grant or revoke admin dashboard access.

    PYTHONPATH=. python -m app.grant_admin someone@company.com            # grant
    PYTHONPATH=. python -m app.grant_admin someone@company.com --revoke   # revoke

The person must have signed in to X!Y at least once (so their user record exists).
"""
import asyncio
import sys

from sqlalchemy import text

from app.admin.auth import grant
from app.core.database import SessionFactory


async def main(email: str, revoke: bool) -> int:
    async with SessionFactory() as session:
        user_id = await session.scalar(text("SELECT id FROM users WHERE lower(email::text)=lower(:e)"), {"e": email})
        if not user_id:
            print(f"No user with email {email}. They must sign in to X!Y once first.")
            return 1
        if revoke:
            await session.execute(text("""
                UPDATE platform_role_assignments SET status='revoked', revoked_at=now()
                WHERE user_id=:u AND status='active'
            """), {"u": user_id})
            print(f"Admin access revoked for {email}.")
        else:
            await grant(session, user_id)
            print(f"{email} is now a platform administrator.")
        await session.commit()
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1], "--revoke" in sys.argv[2:])))
