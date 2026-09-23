from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Actor, current_actor
from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.schemas.manufacturer import (
    AccountPayload,
    AvailabilityPayload,
    BookingStatusPayload,
    MachineryPayload,
    MachineryStatusPayload,
    ProfilePayload,
)
from app.services.manufacturer import ManufacturerService

router = APIRouter(prefix="/manufacturer", tags=["manufacturer"])


def service(session: AsyncSession = Depends(get_session), settings: Settings = Depends(get_settings)):
    return ManufacturerService(session, settings)


@router.get("/bootstrap")
async def bootstrap(actor: Actor = Depends(current_actor), svc: ManufacturerService = Depends(service)):
    """Dashboard load / refresh. Returns {accountExists, state, profileData}."""
    return await svc.bootstrap(actor)


@router.post("/account", status_code=201)
async def create_account(body: AccountPayload, actor: Actor = Depends(current_actor),
                         svc: ManufacturerService = Depends(service)):
    """AccountScreen submit."""
    return await svc.create_account(actor, body.model_dump(mode="json"))


@router.put("/profile")
async def save_profile(body: ProfilePayload, actor: Actor = Depends(current_actor),
                       svc: ManufacturerService = Depends(service)):
    """ProfileWizard changes (all five steps in one document)."""
    return await svc.save_profile(actor, body.model_dump(mode="json"))


@router.post("/machinery", status_code=201)
async def create_machinery(body: MachineryPayload, actor: Actor = Depends(current_actor),
                           svc: ManufacturerService = Depends(service)):
    """MachineryWizard publish / save as draft."""
    return await svc.create_machinery(actor, body.model_dump(mode="json"))


@router.patch("/machinery/{machine_id}/status")
async def set_machinery_status(machine_id: UUID, body: MachineryStatusPayload,
                               actor: Actor = Depends(current_actor), svc: ManufacturerService = Depends(service)):
    return await svc.set_machinery_status(actor, str(machine_id), body.status)


@router.put("/availability")
async def save_availability(body: AvailabilityPayload, actor: Actor = Depends(current_actor),
                            svc: ManufacturerService = Depends(service)):
    """Calendar day toggles, recurring availability and capacity plan."""
    return await svc.save_availability(actor, body.model_dump(mode="json"))


@router.patch("/booking-requests/{booking_id}")
async def decide_booking(booking_id: UUID, body: BookingStatusPayload, actor: Actor = Depends(current_actor),
                         svc: ManufacturerService = Depends(service)):
    return await svc.decide_booking(actor, str(booking_id), body.status)
