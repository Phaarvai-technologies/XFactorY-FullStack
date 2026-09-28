"""Admin Dashboard API (XY-ADMIN-01..10). Every route requires an admin (current_admin)."""
from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.auth import AdminContext, current_admin
from app.admin.schemas import AccountStatusIn, AdminFields, ArchiveIn, BatchArchiveIn, FieldEdit, NoteIn
from app.admin.service import AdminService
from app.core.config import Settings, get_settings
from app.core.database import get_session

router = APIRouter(prefix="/admin", tags=["admin"])
Admin = Annotated[AdminContext, Depends(current_admin)]


def service(session: AsyncSession = Depends(get_session), settings: Settings = Depends(get_settings)):
    return AdminService(session, settings)


Svc = Annotated[AdminService, Depends(service)]
ListParam = Annotated[list[str] | None, Query()]


@router.get("/me")
async def me(admin: Admin, svc: Svc):
    """XY-ADMIN-01: 200 for admins, 403 for everyone else."""
    return await svc.me(admin)


@router.get("/admins")
async def admins(admin: Admin, svc: Svc):
    return await svc.admins()


@router.get("/overview")
async def overview(admin: Admin, svc: Svc):
    return await svc.overview()


@router.get("/manufacturers")
async def manufacturers(admin: Admin, svc: Svc, q: str | None = None, industry: str | None = None,
                        process: str | None = None, location: str | None = None,
                        completeness: Literal["complete", "incomplete"] | None = None,
                        review_status: ListParam = None, record_type: ListParam = None,
                        entry_source: ListParam = None,
                        archived: Literal["active", "archived", "all"] = "active",
                        assigned: Literal["unassigned"] | None = None,
                        sort: Literal["updated", "name", "completeness", "registered"] = "updated",
                        page: int = Query(1, ge=1), page_size: int = Query(25, ge=5, le=100)):
    filters = {"q": q, "industry": industry, "process": process, "location": location,
               "completeness": completeness, "review_status": review_status, "record_type": record_type,
               "entry_source": entry_source, "archived": archived, "assigned": assigned}
    return await svc.manufacturers(filters, page, page_size, sort)


@router.get("/review-queue")
async def review_queue(admin: Admin, svc: Svc, q: str | None = None, review_status: ListParam = None,
                       assigned: Literal["me", "unassigned"] | None = None, include_test: bool = False):
    filters = {"q": q, "review_status": review_status, "assigned": assigned,
               "record_type": None if include_test else ["REAL"]}
    return await svc.review_queue(filters, admin)


@router.get("/manufacturers/{org_id}")
async def manufacturer(org_id: UUID, admin: Admin, svc: Svc):
    return await svc.detail(str(org_id))


@router.patch("/manufacturers/{org_id}/fields")
async def edit_field(org_id: UUID, body: FieldEdit, admin: Admin, svc: Svc):
    """XY-ADMIN-06: correct one manufacturer response; old/new value, admin, time and reason are recorded."""
    return await svc.edit_field(admin, str(org_id), body.field, body.value, body.reason)


@router.patch("/manufacturers/{org_id}/admin-fields")
async def admin_fields(org_id: UUID, body: AdminFields, admin: Admin, svc: Svc):
    """XY-ADMIN-07/08: review status, assignment, record type, entry source, referral source."""
    return await svc.admin_fields(admin, str(org_id), body.model_dump(exclude_unset=True))


@router.post("/manufacturers/{org_id}/archive")
async def archive(org_id: UUID, body: ArchiveIn, admin: Admin, svc: Svc):
    await svc.archive(admin, [str(org_id)], True, body.reason)
    return await svc.detail(str(org_id))


@router.post("/manufacturers/{org_id}/restore")
async def restore(org_id: UUID, body: ArchiveIn, admin: Admin, svc: Svc):
    await svc.archive(admin, [str(org_id)], False, body.reason)
    return await svc.detail(str(org_id))


@router.post("/manufacturers/archive-batch")
async def archive_batch(body: BatchArchiveIn, admin: Admin, svc: Svc):
    """XY-ADMIN-08: batch archive - only DEMO / TEST records are archived; REAL ones are skipped."""
    return await svc.archive(admin, [str(i) for i in body.ids], True, body.reason, demo_test_only=True)


@router.post("/manufacturers/{org_id}/notes", status_code=201)
async def add_note(org_id: UUID, body: NoteIn, admin: Admin, svc: Svc):
    return await svc.add_note(admin, str(org_id), body.note)


@router.get("/users")
async def users(admin: Admin, svc: Svc, q: str | None = None,
                account_status: Literal["active", "suspended", "deactivated"] | None = None,
                onboarding_status: Literal["NO_PROFILE", "NOT_STARTED", "IN_PROGRESS", "SUBMITTED",
                                           "NEEDS_CORRECTION", "REVIEWED"] | None = None,
                page: int = Query(1, ge=1), page_size: int = Query(25, ge=5, le=100)):
    return await svc.users({"q": q, "account_status": account_status, "onboarding_status": onboarding_status},
                           page, page_size)


@router.get("/users/{user_id}")
async def user(user_id: UUID, admin: Admin, svc: Svc):
    """User details + troubleshooting (XY-ADMIN-03 / 10). Never includes passwords, codes or tokens."""
    return await svc.user_detail(str(user_id))


@router.post("/users/{user_id}/suspend")
async def suspend(user_id: UUID, body: AccountStatusIn, admin: Admin, svc: Svc):
    return await svc.set_account_status(admin, str(user_id), True, body.reason)


@router.post("/users/{user_id}/reactivate")
async def reactivate(user_id: UUID, body: AccountStatusIn, admin: Admin, svc: Svc):
    return await svc.set_account_status(admin, str(user_id), False, body.reason)


@router.get("/support/recent-errors")
async def recent_errors(admin: Admin, svc: Svc):
    return await svc.recent_errors()


@router.get("/analytics")
async def analytics(admin: Admin, svc: Svc, date_from: date | None = Query(None, alias="from"),
                    date_to: date | None = Query(None, alias="to"), include_test: bool = False):
    return await svc.analytics(date_from, date_to, include_test)
