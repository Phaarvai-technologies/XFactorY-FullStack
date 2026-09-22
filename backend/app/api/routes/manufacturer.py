from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import Actor, current_actor
from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.schemas.manufacturer import AccountPayload, AvailabilityPayload, BookingStatusPayload, MachineryPayload, MachineryStatusPayload, ProfilePayload
from app.services.manufacturer import ManufacturerService

router = APIRouter(prefix="/manufacturer", tags=["manufacturer"])


def service(session: AsyncSession = Depends(get_session), settings: Settings = Depends(get_settings)):
    return ManufacturerService(session, settings)


@router.get("/bootstrap")
async def bootstrap(actor: Actor = Depends(current_actor), svc: ManufacturerService = Depends(service)):
    return await svc.bootstrap(actor)


@router.post("/account")
async def account(body: AccountPayload, actor: Actor = Depends(current_actor), svc: ManufacturerService = Depends(service)):
    return await svc.create_account(actor, body.model_dump())


@router.put("/profile")
async def profile(body: ProfilePayload, actor: Actor = Depends(current_actor), svc: ManufacturerService = Depends(service)):
    return await svc.save_profile(actor, body.model_dump())


@router.post("/machinery", status_code=201)
async def machinery(body: MachineryPayload, actor: Actor = Depends(current_actor), svc: ManufacturerService = Depends(service)):
    return await svc.create_machinery(actor, body.model_dump())


@router.patch("/machinery/{machine_id}/status")
async def machine_status(machine_id: str, body: MachineryStatusPayload, actor: Actor = Depends(current_actor), svc: ManufacturerService = Depends(service)):
    return await svc.set_machinery_status(actor, machine_id, body.status)


@router.put("/availability")
async def availability(body: AvailabilityPayload, actor: Actor = Depends(current_actor), svc: ManufacturerService = Depends(service)):
    return await svc.save_availability(actor, body.model_dump())


@router.patch("/booking-requests/{booking_id}")
async def booking(booking_id: str, body: BookingStatusPayload, actor: Actor = Depends(current_actor), svc: ManufacturerService = Depends(service)):
    return await svc.decide_booking(actor, booking_id, body.status)

