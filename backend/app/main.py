import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.admin import router as admin_router
from app.api.routes.admin_auth import router as admin_auth_router
from app.api.routes.identity import router as identity_router
from app.api.routes.manufacturer import router as manufacturer_router
from app.api.routes.visionary import router as visionary_router
from app.api.routes.webhooks import router as clerk_webhook_router
from app.core import activity
from app.core.config import get_settings
from app.core.database import engine
from app.core.gateway_guard import GatewayGuard
from app.core.json_errors import JsonServerErrors
from app.core.schema_check import MIGRATION_HINT, log_schema_status, missing_schema
from app.identity.registration import SIGN_UP_REQUIRED_MESSAGE, RegistrationRequired

logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s - %(message)s")
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await log_schema_status(engine)
    yield


# The interactive API docs list every endpoint: available in development only.
# On Render set ENVIRONMENT=production to switch them off.
_docs = settings.environment.lower() != "production"
app = FastAPI(title="XY Factory API", version="1.2.0", lifespan=lifespan,
              docs_url="/docs" if _docs else None, redoc_url="/redoc" if _docs else None,
              openapi_url="/openapi.json" if _docs else None)

def install_middleware(target: FastAPI, cfg) -> None:
    """Middleware order (the last added runs first): CORS is the OUTERMOST layer, so every response
    the browser receives - including a gateway refusal or an unexpected server error - carries the
    CORS headers, and preflight (OPTIONS) requests are answered before anything else. Otherwise the
    browser hides the real status behind "No 'Access-Control-Allow-Origin' header"."""
    target.add_middleware(JsonServerErrors)  # unexpected errors -> JSON 500 (inside CORS)
    if cfg.gateway_shared_secret:
        # requests that did not come through the API gateway stop here (still with CORS headers)
        target.add_middleware(GatewayGuard, secret=cfg.gateway_shared_secret)
    target.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    cors_log = logging.getLogger("xy.cors")
    cors_log.info("CORS allowed origins: %s", ", ".join(cfg.cors_origins) or "(none)")
    if cfg.environment.lower() == "production" and all("localhost" in o for o in cfg.cors_origins):
        cors_log.error("CORS_ORIGINS allows only localhost in production: browsers on the real site will be "
                       "blocked. Set CORS_ORIGINS to the site origin(s), e.g. "
                       "https://www.phaarvai.com,https://phaarvai.com")


install_middleware(app, settings)

@app.exception_handler(RegistrationRequired)
async def registration_required(_request, _exc):
    # Authenticated with Clerk, but XfactorY sign-up was never completed. The frontend keys on `code`.
    return JSONResponse({"detail": SIGN_UP_REQUIRED_MESSAGE, "code": "registration_required"}, status_code=403)


app.include_router(manufacturer_router, prefix="/api/v1")
app.include_router(identity_router, prefix="/api/v1")
app.include_router(visionary_router, prefix="/api/v1")
app.include_router(admin_router, prefix="/api/v1")
app.include_router(admin_auth_router, prefix="/api/v1")
activity.install(app)
app.include_router(clerk_webhook_router, prefix="/api/v1")

@app.get("/")
async def root():
    return {"message": "Welcome to XY Factory API", "status": "running"}

@app.get("/health")
@app.get("/health/live")
async def health():
    return {"status": "ok"}


@app.get("/health/ready")
async def ready():
    """Database reachable and all migrations applied."""
    try:
        problems = await missing_schema(engine)
    except Exception as exc:  # noqa: BLE001
        # The reason goes to the server log only: it can name hosts, users or the database.
        logging.getLogger("xy.health").warning("Readiness check failed: %s", exc)
        return JSONResponse({"status": "error", "detail": "Database unreachable"}, status_code=503)
    if problems:
        return JSONResponse({"status": "error", "missing": problems, "fix": MIGRATION_HINT}, status_code=503)
    return {"status": "ok"}
