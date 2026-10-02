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
from app.core.schema_check import MIGRATION_HINT, log_schema_status, missing_schema

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if settings.gateway_shared_secret:
    # Outermost layer: requests that did not come through the API gateway stop here.
    app.add_middleware(GatewayGuard, secret=settings.gateway_shared_secret)

app.include_router(manufacturer_router, prefix="/api/v1")
app.include_router(identity_router, prefix="/api/v1")
app.include_router(visionary_router, prefix="/api/v1")
app.include_router(admin_router, prefix="/api/v1")
app.include_router(admin_auth_router, prefix="/api/v1")
activity.install(app)
app.include_router(clerk_webhook_router, prefix="/api/v1")


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
        return JSONResponse({"status": "error", "detail": f"Database unreachable: {exc}"}, status_code=503)
    if problems:
        return JSONResponse({"status": "error", "missing": problems, "fix": MIGRATION_HINT}, status_code=503)
    return {"status": "ok"}
