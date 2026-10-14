from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Actor
from app.identity.registration import registered_actor
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
    NotificationsReadPayload,
    ProfilePatchPayload,
    ProfilePayload,
)
from app.services.manufacturer import ManufacturerService

router = APIRouter(prefix="/manufacturer", tags=["manufacturer"])


def service(session: AsyncSession = Depends(get_session), settings: Settings = Depends(get_settings)):
    return ManufacturerService(session, settings)


@router.get("/bootstrap")
async def bootstrap(actor: Actor = Depends(registered_actor), svc: ManufacturerService = Depends(service)):
    """Dashboard load / refresh. Returns {accountExists, state, profileData}."""
    return await svc.bootstrap(actor)


@router.post("/account", status_code=201)
async def create_account(body: AccountPayload, actor: Actor = Depends(registered_actor),
                         svc: ManufacturerService = Depends(service)):
    """AccountScreen submit."""
    return await svc.create_account(actor, body.model_dump(mode="json"))

@router.get("/companies/search")
async def search_companies(
    q: str = Query(min_length=2, max_length=100),
    actor: Actor = Depends(registered_actor),
    svc: ManufacturerService = Depends(service),
):
    """Search listed manufacturer companies by name (live, case-insensitive, ranked)."""
    companies = await svc.search_companies(actor, q)
    return {"items": companies}


@router.get("/companies/{company_id}")
async def company_details(company_id: UUID, actor: Actor = Depends(registered_actor),
                          svc: ManufacturerService = Depends(service)):
    """Saved details of the selected company (prefill only; selecting grants nothing)."""
    return await svc.company_details(actor, str(company_id))


@router.patch("/profile")
async def update_profile(body: ProfilePatchPayload, actor: Actor = Depends(registered_actor),
                         svc: ManufacturerService = Depends(service)):
    """ProfileWizard step save ("Save & Next" / Skip / Previous): only the changed
    fields, plus `progress` {step, completed, nextStep}.

    Absent field = unchanged; "" or null = cleared by the user; value = saved.
    Returns the updated record read back from the database."""
    progress = body.progress.model_dump() if body.progress else None
    return await svc.update_profile(actor, body.changes(), progress)


@router.put("/profile", deprecated=True)
async def replace_profile(body: ProfilePayload, actor: Actor = Depends(registered_actor),
                          svc: ManufacturerService = Depends(service)):
    """Whole-document save (older frontend). Prefer PATCH."""
    return await svc.replace_profile(actor, body.model_dump(mode="json"))


@router.post("/machinery", status_code=201)
async def create_machinery(body: MachineryPayload, actor: Actor = Depends(registered_actor),
                           svc: ManufacturerService = Depends(service)):
    """MachineryWizard publish / save as draft."""
    return await svc.create_machinery(actor, body.model_dump(mode="json"))


@router.post("/machinery/drafts", status_code=201)
async def create_machinery_draft(body: MachineryDraftCreate, actor: Actor = Depends(registered_actor),
                                 svc: ManufacturerService = Depends(service)):
    """Machinery wizard, first "Save & Next": creates the draft once (idempotent by clientKey)."""
    progress = body.progress.model_dump() if body.progress else None
    return await svc.create_machinery_draft(actor, body.clientKey, body.changes(), progress)


@router.patch("/machinery/{machine_id}")
async def update_machinery_draft(machine_id: UUID, body: MachineryPatch, actor: Actor = Depends(registered_actor),
                                 svc: ManufacturerService = Depends(service)):
    """Machinery wizard, later steps: changed fields + progress; last step sends
    finish="Draft"|"Published" to complete the listing."""
    progress = body.progress.model_dump() if body.progress else None
    return await svc.update_machinery_draft(actor, str(machine_id), body.changes(), progress, body.finish)


@router.patch("/machinery/{machine_id}/status")
async def set_machinery_status(machine_id: UUID, body: MachineryStatusPayload,
                               actor: Actor = Depends(registered_actor), svc: ManufacturerService = Depends(service)):
    return await svc.set_machinery_status(actor, str(machine_id), body.status)


@router.patch("/availability")
async def patch_availability(body: AvailabilityPatchPayload, actor: Actor = Depends(registered_actor),
                             svc: ManufacturerService = Depends(service)):
    """Only the changed part: calendar, recurring and/or capacity."""
    return await svc.patch_availability(actor, body.changes())


@router.put("/availability")
async def save_availability(body: AvailabilityPayload, actor: Actor = Depends(registered_actor),
                            svc: ManufacturerService = Depends(service)):
    """Calendar day toggles, recurring availability and capacity plan."""
    return await svc.save_availability(actor, body.model_dump(mode="json"))


@router.patch("/booking-requests/{booking_id}")
async def decide_booking(booking_id: UUID, body: BookingStatusPayload, actor: Actor = Depends(registered_actor),
                         svc: ManufacturerService = Depends(service)):
    return await svc.decide_booking(actor, str(booking_id), body.status)


@router.get("/notifications")
async def notifications(actor: Actor = Depends(registered_actor), svc: ManufacturerService = Depends(service)):
    """Dashboard bell: messages from the X!Y team (needs correction, profile edits, shared notes),
    unread count, whether to show the popup, and the open correction request with shared notes."""
    return await svc.notifications(actor)


@router.post("/notifications/read")
async def notifications_read(body: NotificationsReadPayload, actor: Actor = Depends(registered_actor),
                             svc: ManufacturerService = Depends(service)):
    """Opened in the panel: marks the given notifications (or all) as read."""
    ids = [str(i) for i in body.ids] if body.ids is not None else None
    return await svc.mark_notifications_read(actor, ids)


@router.post("/notifications/popup-seen")
async def notifications_popup_seen(actor: Actor = Depends(registered_actor),
                                   svc: ManufacturerService = Depends(service)):
    """The new-messages popup was shown and closed with "Later"."""
    return await svc.notifications_popup_seen(actor)