from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.identity import router as identity_router
from app.api.routes.manufacturer import router as manufacturer_router
from app.api.routes.webhooks import router as clerk_webhook_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(title="XY Factory API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(manufacturer_router, prefix="/api/v1")
app.include_router(identity_router, prefix="/api/v1")
app.include_router(clerk_webhook_router, prefix="/api/v1")


@app.get("/health")
@app.get("/health/live")
async def health():
    return {"status": "ok"}
