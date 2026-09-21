from sqlalchemy.ext.asyncio import AsyncSession

from app.identity import repository
from app.identity.context import ActorContext
from app.identity.schemas import RoleUpdate


async def read_identity(session: AsyncSession, actor: ActorContext) -> dict:
    user = await repository.get_user_by_clerk_id(session, actor.clerk_user_id)
    roles = await repository.get_roles(session, actor.user_id)
    return {"user": dict(user) if user else None, "roles": roles}


async def update_roles(
    session: AsyncSession, actor: ActorContext, payload: RoleUpdate
) -> list[str]:
    roles = payload.normalized()
    await repository.replace_roles(session, actor.user_id, roles)
    await session.commit()
    return roles

