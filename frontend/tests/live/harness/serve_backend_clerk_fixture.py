"""Real backend app; ONLY Clerk's REST user lookup is answered from clerk_users.json (no network here)."""
import json, os, sys
from fastapi import HTTPException
import uvicorn
import app.identity.auth as identity_auth
USERS = os.environ["LIVE_CLERK_USERS"]
async def fake_fetch(clerk_user_id, settings):
    users = json.load(open(USERS))
    if clerk_user_id not in users:
        raise HTTPException(502, "Unable to synchronize user from Clerk")
    return users[clerk_user_id]
identity_auth._fetch_clerk_user = fake_fetch

# Clerk REST calls made through httpx with base_url https://api.clerk.com/v1 (profile reads):
# answered from the same fixture; every other host is untouched.
import httpx  # noqa: E402
_orig_init = httpx.AsyncClient.__init__
def _handler(request):
    users = json.load(open(USERS))
    parts = request.url.path.rstrip("/").split("/")
    if len(parts) >= 4 and parts[-2] == "users" and parts[-1] in users:
        return httpx.Response(200, json=users[parts[-1]])
    return httpx.Response(404, json={"errors": []})
def _init(self, *a, **kw):
    if str(kw.get("base_url", "")).startswith("https://api.clerk.com"):
        kw["transport"] = httpx.MockTransport(_handler)
    _orig_init(self, *a, **kw)
httpx.AsyncClient.__init__ = _init
from app.main import app  # noqa: E402
uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
