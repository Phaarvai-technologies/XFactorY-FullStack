"""Records failed API operations per user (XY-ADMIN-10 "recent failed operation",
"error reference"). Only the method, path, status, the error message shown to
the user and a request id are stored - never request bodies, headers or tokens."""
import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.database import SessionFactory

log = logging.getLogger("xy.activity")

TRACKED_PREFIXES = ("/api/v1/manufacturer", "/api/v1/identity")


def request_reference(request: Request) -> str:
    """The gateway's X-Request-ID when present, otherwise a new short id."""
    ref = request.headers.get("x-request-id") or getattr(request.state, "request_ref", None)
    if not ref:
        ref = uuid.uuid4().hex[:16]
        request.state.request_ref = ref
    return ref[:64]


async def record_failure(request: Request, status_code: int, detail) -> None:
    clerk_user_id = getattr(request.state, "clerk_user_id", None)
    if not clerk_user_id or not request.url.path.startswith(TRACKED_PREFIXES):
        return
    if isinstance(detail, list):  # validation errors: keep field + message only
        detail = "; ".join(f'{".".join(str(p) for p in e.get("loc", [])[1:])}: {e.get("msg")}' for e in detail)
    try:
        async with SessionFactory() as session:
            await session.execute(text("""
                INSERT INTO user_activity_events
                  (user_id, clerk_user_id, kind, method, path, status_code, detail, request_id)
                VALUES ((SELECT id FROM users WHERE clerk_user_id=:c), :c, 'error', :m, :p, :s, :d, :r)
            """), {"c": clerk_user_id, "m": request.method, "p": request.url.path, "s": status_code,
                    "d": str(detail)[:500], "r": request_reference(request)})
            await session.commit()
    except Exception as exc:  # noqa: BLE001 - recording must never break the response
        log.warning("Could not record failed operation: %s", exc)


def install(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        if exc.status_code >= 400 and exc.status_code not in (401, 404):
            await record_failure(request, exc.status_code, exc.detail)
        response = await http_exception_handler(request, exc)
        if "x-request-id" not in request.headers and getattr(request.state, "request_ref", None):
            response.headers["X-Request-ID"] = request.state.request_ref
        return response

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        await record_failure(request, 422, exc.errors())
        response = await request_validation_exception_handler(request, exc)
        if "x-request-id" not in request.headers and getattr(request.state, "request_ref", None):
            response.headers["X-Request-ID"] = request.state.request_ref
        return response
