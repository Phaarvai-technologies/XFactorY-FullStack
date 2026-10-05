from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ReviewStatus = Literal["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "NEEDS_CORRECTION", "REVIEWED"]
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


class NoteIn(_Model):
    note: str = Field(min_length=1, max_length=4000)
    share: bool = False  # True: the manufacturer sees it and gets a notification


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


class AdminRoleIn(_Model):
    role: AdminRole


class AdminRestoreIn(_Model):
    role: AdminRole | None = None
