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
