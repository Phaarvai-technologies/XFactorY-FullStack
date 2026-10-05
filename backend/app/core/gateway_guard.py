"""Only accept requests that came through the API gateway (optional).

When GATEWAY_SHARED_SECRET is set, every request must carry the header
`X-Gateway-Secret` with that value. The gateway adds it to everything it forwards
(and overwrites any value a visitor sends), so a request sent straight to the
backend's own URL - skipping the WAF and rate limits - gets 403.
Only /health and /health/live stay open, for the hosting platform's health check.
Leave the setting empty for local development and docker compose.
"""
import hmac
import json

OPEN_PATHS = {"/health", "/health/live"}
HEADER = b"x-gateway-secret"


class GatewayGuard:
    def __init__(self, app, secret: str):
        self.app = app
        self.secret = secret.encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] in OPEN_PATHS:
            return await self.app(scope, receive, send)
        sent = next((v for k, v in scope["headers"] if k == HEADER), b"")
        if hmac.compare_digest(sent, self.secret):
            return await self.app(scope, receive, send)
        body = json.dumps({"detail": "Direct access is not allowed. Use the API gateway."}).encode()
        await send({"type": "http.response.start", "status": 403,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
