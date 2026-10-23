from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ReviewStatus = Literal["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "NEEDS_CORRECTION", "REVIEWED", "REJECTED"]
RecordType = Literal["REAL", "DEMO", "TEST"]
EntrySource = Literal["MANUFACTURER", "ADMIN_ASSISTED", "IMPORTED"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class FieldEdit(_Model):
    """XY-ADMIN-06: one field (or list section) at a time, with a required reason."""
    field: str = Field(min_length=3, max_length=120)
    value: Any = None
    reason: str = Field(min_length=3, max_length=500)


class AdminFields(_Model):
    """XY-ADMIN-07/08: admin-owned fields. Only the keys sent are changed."""
    record_type: RecordType | None = None
    entry_source: EntrySource | None = None
    referral_source: str | None = Field(default=None, max_length=200)
    assigned_admin_id: UUID | None = None
    unassign: bool = False
    review_status: ReviewStatus | None = None
    reason: str | None = Field(default=None, max_length=500)
    # NEEDS_CORRECTION: the fields the applicant must correct (app/manufacturer_access.CORRECTABLE)
    correction_fields: list[str] | None = Field(default=None, max_length=12)


class NoteIn(_Model):
    note: str = Field(min_length=1, max_length=4000)
    share: bool = False  # True: the manufacturer sees it and gets a notification


class UpdateRequestEdit(_Model):
    """Admin review of an update request: edit proposed values and / or verification notes."""
    values: dict[str, str | None] | None = None
    notes: str | None = Field(default=None, max_length=4000)


class UpdateRequestDecision(_Model):
    decision: Literal["approve", "request_changes", "decline"]
    # approve: the fields to merge (default: every proposed change)
    fields: list[str] | None = Field(default=None, max_length=10)
    feedback: str | None = Field(default=None, max_length=2000)
    # request_changes: the fields the applicant must correct (app/manufacturer_access.CORRECTABLE)
    correction_fields: list[str] | None = Field(default=None, max_length=12)
    # what the admin reviewed (returned with the request); a mismatch means it changed meanwhile
    fingerprint: str = Field(min_length=8, max_length=64)


class ArchiveIn(_Model):
    reason: str | None = Field(default=None, max_length=500)


class BatchArchiveIn(_Model):
    ids: list[UUID] = Field(min_length=1, max_length=500)
    reason: str | None = Field(default=None, max_length=500)


class AccountStatusIn(_Model):
    reason: str = Field(min_length=3, max_length=500)


class LoginIn(BaseModel):
    # No whitespace stripping: passwords are used exactly as typed.
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class TestEmailIn(_Model):
    to: str | None = Field(default=None, max_length=320)


AdminRole = Literal["platform_administrator", "platform_operator", "support_specialist", "verification_analyst"]


class AdminAddIn(_Model):
    """Admins tab -> Add admin."""
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    name: str = Field(default="", max_length=120)
    role: AdminRole = "platform_administrator"


class AdminDetailsIn(_Model):
    """Admins tab -> Edit details. Only the fields sent are changed. `email` is accepted only for
    admin-only accounts (no XfactorY sign-in) and never for the built-in administrator."""
    firstName: str | None = Field(default=None, min_length=1, max_length=80)
    lastName: str | None = Field(default=None, max_length=80)
    phone: str | None = Field(default=None, max_length=24, pattern=r"^$|^\+?[0-9][0-9 ()\-]{5,22}$")
    email: str | None = Field(default=None, min_length=3, max_length=320, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class AdminRoleIn(_Model):
    role: AdminRole


class RecordTypeIn(_Model):
    """Mark a person (Visionary) as real / demo / test data."""
    record_type: RecordType
    reason: str | None = Field(default=None, max_length=500)


class AdminRestoreIn(_Model):
    role: AdminRole | None = None


class CompanyCreate(_Model):
    """Admin dashboard "Add company" (Admin Entry). The onboarding source is not a field: the
    backend sets admin_entry; unknown keys (a 'source', for example) are rejected (extra=forbid)."""
    name: str = Field(min_length=1, max_length=200)
    country: str = Field(default="", max_length=100)
    state: str = Field(default="", max_length=100)
    city: str = Field(default="", max_length=100)
    address: str = Field(default="", max_length=300)
    category: str = Field(default="", max_length=150)
    website: str = Field(default="", max_length=200)
    registration_id: str = Field(default="", max_length=100)
    email: str = Field(default="", max_length=320)
    phone: str = Field(default="", max_length=30)
    capacity: str = Field(default="", max_length=100)
    reason: str = Field(default="", max_length=500)
