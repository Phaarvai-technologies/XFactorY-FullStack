"""Turn an unexpected exception into a JSON 500 *inside* the CORS layer.

Starlette's own error handler sits outside every middleware, so its plain-text 500 reaches the
browser without CORS headers and is reported as a CORS failure. This keeps the real status visible.
"""
import json
import logging

log = logging.getLogger("xy.errors")


class JsonServerErrors:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = False

        async def tracking_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception:  # noqa: BLE001
            log.exception("Unhandled error on %s %s", scope.get("method"), scope.get("path"))
            if started:
                raise
            body = json.dumps({"detail": "Something went wrong on the server. Please try again."}).encode()
            await send({"type": "http.response.start", "status": 500,
                        "headers": [(b"content-type", b"application/json"),
                                    (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
