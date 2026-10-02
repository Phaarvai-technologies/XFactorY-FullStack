import httpx
from fastapi import HTTPException

from app.core.auth import Actor
from app.core.config import Settings


class ClerkManagement:
    """Reads the signed-in user (and optional organization) from Clerk's Backend API.

    Used only when the Clerk webhook has not synchronised the user yet.
    """

    def __init__(self, settings: Settings):
        self.secret = settings.clerk_secret_key

    async def update_user_name(self, clerk_user_id: str, first_name: str, last_name: str) -> None:
        """Keep Clerk's copy of the name equal to the one edited in onboarding, so
        Clerk's user.updated webhook can't bring back the old name."""
        if not self.secret:
            raise RuntimeError("CLERK_SECRET_KEY is not configured")
        async with httpx.AsyncClient(base_url="https://api.clerk.com/v1",
                                     headers={"Authorization": f"Bearer {self.secret}"}, timeout=15) as client:
            response = await client.patch(f"/users/{clerk_user_id}",
                                          json={"first_name": first_name, "last_name": last_name})
        if response.status_code >= 400:
            raise RuntimeError(f"Clerk rejected the name update ({response.status_code})")

    async def set_banned(self, clerk_user_id: str, banned: bool) -> None:
        """Suspend / reactivate sign-in in Clerk (admin user management)."""
        if not self.secret:
            raise RuntimeError("CLERK_SECRET_KEY is not configured")
        async with httpx.AsyncClient(base_url="https://api.clerk.com/v1",
                                     headers={"Authorization": f"Bearer {self.secret}"}, timeout=15) as client:
            response = await client.post(f"/users/{clerk_user_id}/{'ban' if banned else 'unban'}")
        if response.status_code >= 400:
            raise RuntimeError(f"Clerk rejected the {'ban' if banned else 'unban'} ({response.status_code})")

    async def login_info(self, clerk_user_id: str) -> dict:
        """Last sign-in / activity times from Clerk. Never returns secrets."""
        if not self.secret:
            raise RuntimeError("CLERK_SECRET_KEY is not configured")
        async with httpx.AsyncClient(base_url="https://api.clerk.com/v1",
                                     headers={"Authorization": f"Bearer {self.secret}"}, timeout=10) as client:
            response = await client.get(f"/users/{clerk_user_id}")
        if response.status_code >= 400:
            raise RuntimeError(f"Clerk lookup failed ({response.status_code})")
        data = response.json()
        return {"last_sign_in_at": data.get("last_sign_in_at"), "last_active_at": data.get("last_active_at"),
                "banned": bool(data.get("banned"))}

    async def actor_profile(self, actor: Actor) -> dict:
        if not self.secret:
            raise HTTPException(503, "CLERK_SECRET_KEY is not configured on the backend")
        headers = {"Authorization": f"Bearer {self.secret}"}
        async with httpx.AsyncClient(base_url="https://api.clerk.com/v1", headers=headers, timeout=15) as client:
            user_response = await client.get(f"/users/{actor.clerk_user_id}")
            if user_response.status_code >= 400:
                raise HTTPException(502, "Unable to read the signed-in user from Clerk")
            org = {}
            if actor.clerk_org_id:
                org_response = await client.get(f"/organizations/{actor.clerk_org_id}")
                if org_response.status_code < 400:
                    org = org_response.json()
        user = user_response.json()
        emails = user.get("email_addresses", [])
        primary = next(
            (x.get("email_address") for x in emails if x.get("id") == user.get("primary_email_address_id")),
            emails[0].get("email_address") if emails else None,
        )
        phones = user.get("phone_numbers", [])
        phone = next(
            (x.get("phone_number") for x in phones if x.get("id") == user.get("primary_phone_number_id")),
            None,
        )
        first, last = user.get("first_name") or "", user.get("last_name") or ""
        return {
            "email": primary,
            "phone": phone,
            "first_name": first,
            "last_name": last,
            "organization_name": org.get("name") or f"{first} {last}".strip() or "Manufacturer",
        }
