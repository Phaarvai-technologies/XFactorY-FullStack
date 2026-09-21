from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.identity import router as identity_router
from app.api.routes.manufacturer import router as manufacturer_router
from app.api.routes.webhooks import router as webhook_router
from app.core.config import get_settings

settings = get_settings()
app = FastAPI(title="X!Y Factory API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
)
app.include_router(identity_router, prefix="/api/v1")
app.include_router(manufacturer_router, prefix="/api/v1")
app.include_router(webhook_router, prefix="/api/v1")


@app.get("/health/live")
async def live():
    return {"status": "ok"}

