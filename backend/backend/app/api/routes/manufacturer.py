from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.identity.auth import CurrentActor
from app.manufacturer.schemas import ManufacturerAccountCreate
from app.manufacturer.service import create_account, read_account

router = APIRouter(prefix="/manufacturer", tags=["manufacturer"])


@router.get("/account")
async def get_manufacturer_account(
    actor: CurrentActor,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await read_account(session, actor)


@router.post("/account", status_code=201)
async def manufacturer_account(
    payload: ManufacturerAccountCreate,
    actor: CurrentActor,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await create_account(session, actor, payload)
