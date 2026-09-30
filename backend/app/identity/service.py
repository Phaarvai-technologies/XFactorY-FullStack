from sqlalchemy.ext.asyncio import AsyncSession

from app.identity import repository
from app.identity.context import ActorContext
from app.identity.schemas import RoleUpdate


async def _summary(session: AsyncSession, actor: ActorContext) -> dict:
    return {
        "roles": await repository.get_roles(session, actor.user_id),
        "manufacturerAccountExists": await repository.manufacturer_account_exists(session, actor.user_id),
    }


async def read_identity(session: AsyncSession, actor: ActorContext) -> dict:
    user = await repository.get_user_by_clerk_id(session, actor.clerk_user_id)
    return {"user": dict(user) if user else None, **await _summary(session, actor)}


async def update_roles(session: AsyncSession, actor: ActorContext, payload: RoleUpdate) -> dict:
    await repository.replace_roles(session, actor.user_id, payload.normalized())
    await session.commit()
    return await _summary(session, actor)
