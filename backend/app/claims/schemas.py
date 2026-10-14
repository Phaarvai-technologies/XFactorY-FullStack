"""Request schemas for manufacturer company claims."""
from uuid import UUID

from pydantic import BaseModel


class ClaimCreate(BaseModel):
    organizationId: UUID
    note: str | None = None
