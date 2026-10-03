"""GATEWAY_SHARED_SECRET: requests that skip the API gateway are refused."""
import httpx
from fastapi import FastAPI

from app.core.gateway_guard import GatewayGuard

SECRET = "s" * 40


def make_app():
    app = FastAPI()

    @app.get("/health/live")
    async def live():
        return {"status": "ok"}

    @app.get("/health/ready")
    async def ready():
        return {"status": "ok"}

    @app.post("/api/v1/webhooks/clerk")
    async def hook():
        return {"received": True}

    @app.get("/api/v1/identity/me")
    async def me():
        return {"ok": True}

    app.add_middleware(GatewayGuard, secret=SECRET)
    return app


async def call(method, path, headers=None):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=make_app()), base_url="http://t") as c:
        return await c.request(method, path, headers=headers or {})


async def test_direct_calls_are_refused():
    for method, path in (("GET", "/api/v1/identity/me"), ("POST", "/api/v1/webhooks/clerk"), ("GET", "/health/ready"),
                         ("OPTIONS", "/api/v1/identity/me")):
        r = await call(method, path)
        assert r.status_code == 403, (method, path)
        assert r.json() == {"detail": "Direct access is not allowed. Use the API gateway."}
    assert (await call("GET", "/api/v1/identity/me", {"X-Gateway-Secret": "wrong"})).status_code == 403
    assert (await call("GET", "/api/v1/identity/me", {"X-Gateway-Secret": SECRET[:-1]})).status_code == 403


async def test_calls_through_the_gateway_pass():
    r = await call("GET", "/api/v1/identity/me", {"X-Gateway-Secret": SECRET})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert (await call("POST", "/api/v1/webhooks/clerk", {"X-Gateway-Secret": SECRET})).status_code == 200


async def test_platform_health_check_stays_open():
    assert (await call("GET", "/health/live")).status_code == 200


def test_off_by_default():
    from app.core.config import Settings
    assert Settings.model_fields["gateway_shared_secret"].default == ""
