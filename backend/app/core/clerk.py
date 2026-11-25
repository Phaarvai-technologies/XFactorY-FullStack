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

    # ------------------------------------------------------------ manufacturer magic link
    def _client(self, timeout: float = 15) -> httpx.AsyncClient:
        if not self.secret:
            raise RuntimeError("CLERK_SECRET_KEY is not configured")
        return httpx.AsyncClient(base_url="https://api.clerk.com/v1",
                                 headers={"Authorization": f"Bearer {self.secret}"}, timeout=timeout)

    async def find_or_create_user(self, email: str, first_name: str, last_name: str) -> tuple[str, bool]:
        """(Clerk user id, created) for this email. A new user gets NO password: the manufacturer
        signs in with the magic link, later with Google, an email code or a password they set."""
        async with self._client() as client:
            found = await client.get("/users", params={"email_address": email, "limit": 1})
            if found.status_code >= 400:
                raise RuntimeError(f"Clerk user lookup failed ({found.status_code})")
            users = found.json()
            users = users.get("data", users) if isinstance(users, dict) else users
            if users:
                return users[0]["id"], False
            created = await client.post("/users", json={
                "email_address": [email], "first_name": first_name or None, "last_name": last_name or None,
                "skip_password_requirement": True, "skip_password_checks": True,
            })
        if created.status_code >= 400:
            detail = ""
            try:
                errors = created.json().get("errors") or []
                detail = (errors[0].get("long_message") or errors[0].get("message") or "") if errors else ""
            except ValueError:
                pass
            raise RuntimeError(f"Clerk could not create the account ({created.status_code}) {detail}".strip())
        return created.json()["id"], True

    async def sign_in_token(self, clerk_user_id: str, expires_in_seconds: int = 600) -> str:
        """A one-time Clerk sign-in token (ticket) for this user. Short-lived on purpose: the
        XfactorY link itself lasts 14 days and asks for a fresh ticket each time it is opened."""
        async with self._client() as client:
            response = await client.post("/sign_in_tokens", json={
                "user_id": clerk_user_id, "expires_in_seconds": expires_in_seconds})
        if response.status_code >= 400:
            raise RuntimeError(f"Clerk could not create a sign-in link ({response.status_code})")
        return response.json()["token"]

    async def actor_profile(self, actor: Actor) -> dict:
        if not self.secret:
            raise HTTPException(503, "CLERK_SECRET_KEY is not configured on the backend")
        headers = {"Authorization": f"Bearer {self.secret}"}
        try:
            async with httpx.AsyncClient(base_url="https://api.clerk.com/v1", headers=headers, timeout=15) as client:
                user_response = await client.get(f"/users/{actor.clerk_user_id}")
                if user_response.status_code >= 400:
                    raise HTTPException(502, "Unable to read the signed-in user from Clerk")
                org = {}
                if actor.clerk_org_id:
                    org_response = await client.get(f"/organizations/{actor.clerk_org_id}")
                    if org_response.status_code < 400:
                        org = org_response.json()
        except httpx.HTTPError as exc:  # network / proxy trouble: a retry state, not a crash
            raise HTTPException(503, "Unable to reach Clerk right now. Please try again.") from exc
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
