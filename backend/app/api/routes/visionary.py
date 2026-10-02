"""Visionaries portal API (/api/v1/visionary/...).

Authentication: the Clerk session token (Authorization: Bearer ...), verified the same
way as the identity API. Every route works on the signed-in user's own data only;
manufacturer data is read-only and limited to public fields.
"""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.identity.auth import CurrentActor
from app.visionary.schemas import IdeaIn, ProfileIn, RequestDraftIn, RequestIn, RequirementsIn, StageIn
from app.visionary.service import VisionaryService

router = APIRouter(prefix="/visionary", tags=["visionary"])


def service(session: Annotated[AsyncSession, Depends(get_session)],
            settings: Annotated[Settings, Depends(get_settings)]) -> VisionaryService:
    return VisionaryService(session, settings)


Service = Annotated[VisionaryService, Depends(service)]


@router.get("/me")
async def overview(actor: CurrentActor, svc: Service):
    """Flow load / refresh: {profile, idea, stage, requirements, requests}."""
    return await svc.overview(actor)


@router.put("/profile")
async def save_profile(body: ProfileIn, actor: CurrentActor, svc: Service):
    """Step 1 "Let's Start With You" -> Continue. Returns the same shape as GET /me."""
    return await svc.save_profile(actor, body.model_dump())


@router.put("/project/idea")
async def save_idea(body: IdeaIn, actor: CurrentActor, svc: Service):
    """Step 2 "Your idea" -> Save & Next (complete=true) or Previous (complete=false)."""
    return await svc.save_idea(actor, body.model_dump(exclude={"complete"}), body.complete)


@router.put("/project/stage")
async def save_stage(body: StageIn, actor: CurrentActor, svc: Service):
    """Step 3 "Project stage" -> Save & Next / Previous."""
    return await svc.save_stage(actor, body.stage)


@router.put("/project/requirements")
async def save_requirements(body: RequirementsIn, actor: CurrentActor, svc: Service):
    """Step 4 "Manufacturing needs" -> Find a Manufacturer (complete=true) or Previous."""
    return await svc.save_requirements(actor, body.model_dump(exclude={"complete"}), body.complete)


@router.get("/manufacturers")
async def manufacturers(actor: CurrentActor, svc: Service):
    """"Find a Manufacturer": discoverable manufacturers (ManufacturerRecord[])."""
    return await svc.manufacturers()


@router.get("/manufacturers/{manufacturer_id}")
async def manufacturer(manufacturer_id: str, actor: CurrentActor, svc: Service):
    """One manufacturer: {record, profile} (card data and public profile)."""
    return await svc.manufacturer(manufacturer_id)


@router.get("/manufacturers/{manufacturer_id}/draft")
async def request_draft(manufacturer_id: str, actor: CurrentActor, svc: Service):
    """Request form load: the saved draft for this manufacturer, or null."""
    return await svc.draft(actor, manufacturer_id)


@router.put("/manufacturers/{manufacturer_id}/draft")
async def save_request_draft(manufacturer_id: str, body: RequestDraftIn, actor: CurrentActor, svc: Service):
    """Request form "Save"."""
    return await svc.save_draft(actor, manufacturer_id, body.model_dump())


@router.get("/requests")
async def requests(actor: CurrentActor, svc: Service):
    """The Visionary's manufacturing requests, oldest first."""
    return await svc.requests(actor)


@router.post("/requests", status_code=201)
async def create_request(body: RequestIn, actor: CurrentActor, svc: Service):
    """Request form "Send Request to Manufacturer". The manufacturer sees it in its
    dashboard's booking requests (status New)."""
    return await svc.create_request(actor, body.model_dump())


@router.get("/requests/{request_id}")
async def request(request_id: UUID, actor: CurrentActor, svc: Service):
    return await svc.request(actor, request_id)
