from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Actor, current_actor
from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.schemas.manufacturer import (
    AccountPayload,
    AvailabilityPatchPayload,
    AvailabilityPayload,
    BookingStatusPayload,
    MachineryDraftCreate,
    MachineryPatch,
    MachineryPayload,
    MachineryStatusPayload,
    ProfilePatchPayload,
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


@router.patch("/profile")
async def update_profile(body: ProfilePatchPayload, actor: Actor = Depends(current_actor),
                         svc: ManufacturerService = Depends(service)):
    """ProfileWizard step save ("Save & Next" / Skip / Previous): only the changed
    fields, plus `progress` {step, completed, nextStep}.

    Absent field = unchanged; "" or null = cleared by the user; value = saved.
    Returns the updated record read back from the database."""
    progress = body.progress.model_dump() if body.progress else None
    return await svc.update_profile(actor, body.changes(), progress)


@router.put("/profile", deprecated=True)
async def replace_profile(body: ProfilePayload, actor: Actor = Depends(current_actor),
                          svc: ManufacturerService = Depends(service)):
    """Whole-document save (older frontend). Prefer PATCH."""
    return await svc.replace_profile(actor, body.model_dump(mode="json"))


@router.post("/machinery", status_code=201)
async def create_machinery(body: MachineryPayload, actor: Actor = Depends(current_actor),
                           svc: ManufacturerService = Depends(service)):
    """MachineryWizard publish / save as draft."""
    return await svc.create_machinery(actor, body.model_dump(mode="json"))


@router.post("/machinery/drafts", status_code=201)
async def create_machinery_draft(body: MachineryDraftCreate, actor: Actor = Depends(current_actor),
                                 svc: ManufacturerService = Depends(service)):
    """Machinery wizard, first "Save & Next": creates the draft once (idempotent by clientKey)."""
    progress = body.progress.model_dump() if body.progress else None
    return await svc.create_machinery_draft(actor, body.clientKey, body.changes(), progress)


@router.patch("/machinery/{machine_id}")
async def update_machinery_draft(machine_id: UUID, body: MachineryPatch, actor: Actor = Depends(current_actor),
                                 svc: ManufacturerService = Depends(service)):
    """Machinery wizard, later steps: changed fields + progress; last step sends
    finish="Draft"|"Published" to complete the listing."""
    progress = body.progress.model_dump() if body.progress else None
    return await svc.update_machinery_draft(actor, str(machine_id), body.changes(), progress, body.finish)


@router.patch("/machinery/{machine_id}/status")
async def set_machinery_status(machine_id: UUID, body: MachineryStatusPayload,
                               actor: Actor = Depends(current_actor), svc: ManufacturerService = Depends(service)):
    return await svc.set_machinery_status(actor, str(machine_id), body.status)


@router.patch("/availability")
async def patch_availability(body: AvailabilityPatchPayload, actor: Actor = Depends(current_actor),
                             svc: ManufacturerService = Depends(service)):
    """Only the changed part: calendar, recurring and/or capacity."""
    return await svc.patch_availability(actor, body.changes())


@router.put("/availability")
async def save_availability(body: AvailabilityPayload, actor: Actor = Depends(current_actor),
                            svc: ManufacturerService = Depends(service)):
    """Calendar day toggles, recurring availability and capacity plan."""
    return await svc.save_availability(actor, body.model_dump(mode="json"))


@router.patch("/booking-requests/{booking_id}")
async def decide_booking(booking_id: UUID, body: BookingStatusPayload, actor: Actor = Depends(current_actor),
                         svc: ManufacturerService = Depends(service)):
    return await svc.decide_booking(actor, str(booking_id), body.status)
