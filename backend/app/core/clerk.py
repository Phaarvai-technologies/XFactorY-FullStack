import httpx
from app.core.auth import Actor
from app.core.config import Settings


class ClerkManagement:
    def __init__(self, settings: Settings):
        self.secret = settings.clerk_secret_key

    async def actor_profile(self, actor: Actor) -> dict:
        headers = {"Authorization": f"Bearer {self.secret}"}
        async with httpx.AsyncClient(base_url="https://api.clerk.com/v1", headers=headers, timeout=15) as client:
            user_response = await client.get(f"/users/{actor.clerk_user_id}")
            org_response = await client.get(f"/organizations/{actor.clerk_org_id}")
            user_response.raise_for_status()
            org_response.raise_for_status()
        user, org = user_response.json(), org_response.json()
        emails = user.get("email_addresses", [])
        primary = next((x.get("email_address") for x in emails if x.get("id") == user.get("primary_email_address_id")), None)
        phones = user.get("phone_numbers", [])
        phone = next((x.get("phone_number") for x in phones if x.get("id") == user.get("primary_phone_number_id")), None)
        return {"email": primary, "phone": phone, "first_name": user.get("first_name") or "",
                "last_name": user.get("last_name") or "", "organization_name": org.get("name") or "Manufacturer"}
