"""Admin Dashboard API (XY-ADMIN-01..10). Every route requires an admin (current_admin)."""
from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.admins import AdminManager
from app.admin.auth import AdminContext, current_admin
from app.admin.schemas import (AccountStatusIn, AdminAddIn, AdminFields, AdminRestoreIn, AdminRoleIn, ArchiveIn,
                               BatchArchiveIn, CompanyCreate, FieldEdit, NoteIn, TestEmailIn, UpdateRequestDecision,
                               UpdateRequestEdit)
from app.admin.service import AdminService
from app.core.config import Settings, get_settings
from app.core.database import get_session

router = APIRouter(prefix="/admin", tags=["admin"])


def jsonable(value):
    from fastapi.encoders import jsonable_encoder
    return jsonable_encoder(value)
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


# ---------------------------------------------------------------- Admins tab
def manager(session: AsyncSession = Depends(get_session), settings: Settings = Depends(get_settings)):
    return AdminManager(session, settings)


Mgr = Annotated[AdminManager, Depends(manager)]


@router.get("/admin-users")
async def admin_users(admin: Admin, mgr: Mgr):
    """Every admin (active and revoked), for the Admins tab."""
    return await mgr.list(admin)


@router.post("/admin-users", status_code=201)
async def add_admin_user(body: AdminAddIn, admin: Admin, mgr: Mgr):
    """Grant admin access. Returns {admin, temporaryPassword}; the temporary password is shown
    once and must be changed at the first sign-in. Administrators only."""
    return await mgr.add(admin, body.email, body.name, body.role)


@router.post("/admin-users/{user_id}/revoke")
async def revoke_admin_user(user_id: UUID, admin: Admin, mgr: Mgr):
    return await mgr.revoke(admin, user_id)


@router.post("/admin-users/{user_id}/restore")
async def restore_admin_user(user_id: UUID, body: AdminRestoreIn, admin: Admin, mgr: Mgr):
    return await mgr.restore(admin, user_id, body.role)


@router.patch("/admin-users/{user_id}/role")
async def change_admin_role(user_id: UUID, body: AdminRoleIn, admin: Admin, mgr: Mgr):
    return await mgr.change_role(admin, user_id, body.role)


@router.post("/admin-users/{user_id}/reset-password")
async def reset_admin_password(user_id: UUID, admin: Admin, mgr: Mgr):
    """New temporary password (shown once). Administrators only."""
    return await mgr.reset_password(admin, user_id)


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


@router.post("/manufacturers", status_code=201)
async def create_manufacturer(body: CompanyCreate, admin: Admin, svc: Svc,
                              idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None):
    """Admin Entry: add a manufacturer company (administrators / operators). The onboarding source
    is set to admin_entry by the backend. Duplicates -> 409 with the existing company's id."""
    from app.admin.company_create import CreateError, create_company
    try:
        org_id, created = await create_company(svc.db, admin_id=admin.user_id, roles=admin.roles,
                                               data=body.model_dump(), idempotency_key=idempotency_key)
    except CreateError as exc:
        await svc.db.rollback()
        return JSONResponse({"detail": exc.message, "code": exc.code, "existingId": exc.existing_id},
                            status_code=exc.status)
    await svc.db.commit()
    detail = await svc.detail(org_id)
    return JSONResponse(jsonable(detail), status_code=201 if created else 200)


@router.get("/review-queue")
async def review_queue(admin: Admin, svc: Svc, q: str | None = None, review_status: ListParam = None,
                       assigned: Literal["me", "unassigned"] | None = None, include_test: bool = False):
    filters = {"q": q, "review_status": review_status, "assigned": assigned,
               "record_type": None if include_test else ["REAL"]}
    return await svc.review_queue(filters, admin)


@router.get("/manufacturers/{org_id}")
async def manufacturer(org_id: UUID, admin: Admin, svc: Svc):
    return await svc.detail(str(org_id))


@router.get("/manufacturers/{org_id}/people")
async def manufacturer_people(org_id: UUID, admin: Admin, svc: Svc):
    """Registered users (memberships, any status) and onboarding / change requests for this company.
    Requesters are listed separately and are not counted as members."""
    return await svc.people(str(org_id))


@router.patch("/manufacturers/{org_id}/fields")
async def edit_field(org_id: UUID, body: FieldEdit, admin: Admin, svc: Svc):
    """XY-ADMIN-06: correct one manufacturer response; old/new value, admin, time and reason are recorded."""
    return await svc.edit_field(admin, str(org_id), body.field, body.value, body.reason)


@router.patch("/manufacturers/{org_id}/admin-fields")
async def admin_fields(org_id: UUID, body: AdminFields, admin: Admin, svc: Svc):
    """XY-ADMIN-07/08: review status, assignment, record type, entry source, referral source."""
    return await svc.admin_fields(admin, str(org_id), body.model_dump(exclude_unset=True))


@router.patch("/manufacturers/{org_id}/update-requests/{request_id}")
async def edit_update_request(org_id: UUID, request_id: UUID, body: UpdateRequestEdit, admin: Admin, svc: Svc):
    """Review an update request from a user who does not manage the company: edit the proposed
    values and / or record verification and contact notes (internal)."""
    return await svc.edit_update_request(admin, str(org_id), str(request_id), body.values, body.notes)


@router.post("/manufacturers/{org_id}/update-requests/{request_id}/decision")
async def decide_update_request(org_id: UUID, request_id: UUID, body: UpdateRequestDecision, admin: Admin,
                                svc: Svc):
    """Approve (merge the chosen fields), request corrections, or decline (feedback recorded)."""
    return await svc.decide_update_request(admin, str(org_id), str(request_id), body.model_dump())


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
    return await svc.add_note(admin, str(org_id), body.note, body.share)


@router.get("/users")
async def users(admin: Admin, svc: Svc, q: str | None = None,
                account_status: Literal["active", "suspended", "deactivated"] | None = None,
                onboarding_status: Literal["NO_PROFILE", "NOT_STARTED", "IN_PROGRESS", "SUBMITTED",
                                           "NEEDS_CORRECTION", "REVIEWED"] | None = None,
                role: Literal["manufacturer", "visionary"] | None = None,
                page: int = Query(1, ge=1), page_size: int = Query(25, ge=5, le=100)):
    return await svc.users({"q": q, "account_status": account_status, "onboarding_status": onboarding_status,
                            "role": role}, page, page_size)


@router.get("/visionaries")
async def visionaries(admin: Admin, svc: Svc, q: str | None = None,
                      account_status: Literal["active", "suspended", "deactivated"] | None = None,
                      profile: Literal["saved", "missing"] | None = None,
                      page: int = Query(1, ge=1), page_size: int = Query(25, ge=5, le=100)):
    """Visionary (demand-side) users: one row per user, with their saved profile and counts. Read-only."""
    return await svc.visionaries({"q": q, "account_status": account_status, "profile": profile}, page, page_size)


@router.get("/visionaries/{user_id}")
async def visionary(user_id: UUID, admin: Admin, svc: Svc):
    """A Visionary's saved profile, projects (requirements) and manufacturing requests. Read-only."""
    return await svc.visionary_detail(str(user_id))


@router.get("/machinery")
async def machinery(admin: Admin, svc: Svc, q: str | None = None,
                    status: Literal["Published", "Draft", "Unpublished", "Archived"] | None = None,
                    org: UUID | None = None,
                    page: int = Query(1, ge=1), page_size: int = Query(25, ge=5, le=100)):
    """Machinery records (company assets) across manufacturer companies. Read-only."""
    return await svc.machinery({"q": q, "status": status, "org": str(org) if org else None}, page, page_size)


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


@router.get("/support/emails")
async def recent_emails(admin: Admin, svc: Svc):
    """Latest outgoing emails and their delivery result (no email bodies are stored)."""
    return {"emails": [{**e, "id": str(e["id"])} for e in await svc.repo.recent_emails()],
            "smtpConfigured": svc.mailer.enabled}


@router.post("/support/test-email")
async def test_email(body: TestEmailIn, admin: Admin, svc: Svc):
    """Sends a test email (to the admin's own address by default)."""
    return await svc.send_test_email(admin, body.to)


@router.get("/analytics")
async def analytics(admin: Admin, svc: Svc, date_from: date | None = Query(None, alias="from"),
                    date_to: date | None = Query(None, alias="to"), include_test: bool = False):
    return await svc.analytics(date_from, date_to, include_test)
