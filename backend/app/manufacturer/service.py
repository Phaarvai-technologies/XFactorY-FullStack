from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.identity.context import ActorContext
from app.manufacturer.repository import get_manufacturer_account, save_manufacturer_account
from app.manufacturer.schemas import ManufacturerAccountCreate


async def create_account(
    session: AsyncSession,
    actor: ActorContext,
    payload: ManufacturerAccountCreate,
) -> dict:
    if not actor.clerk_organization_id:
        raise HTTPException(409, "Create and activate a Clerk organization first")
    organization_id = await save_manufacturer_account(
        session,
        user_id=actor.user_id,
        clerk_org_id=actor.clerk_organization_id,
        payload=payload,
    )
    await session.commit()
    return {
        "organization_id": organization_id,
        "status": "in_progress",
        "completion_percentage": 35,
    }


async def read_account(session: AsyncSession, actor: ActorContext) -> dict:
    account = await get_manufacturer_account(
        session,
        user_id=actor.user_id,
        clerk_org_id=actor.clerk_organization_id,
    )
    if account is None:
        return {"account_exists": False, "account": None}
    return {"account_exists": True, "account": dict(account)}
