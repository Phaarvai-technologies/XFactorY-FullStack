from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class ActorContext:
    user_id: UUID
    clerk_user_id: str
    clerk_organization_id: str | None
    claims: dict

