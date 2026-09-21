from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.identity.auth import CurrentActor
from app.identity.schemas import RoleUpdate
from app.identity.service import read_identity, update_roles

router = APIRouter(prefix="/identity", tags=["identity"])


@router.get("/me")
async def me(
    actor: CurrentActor,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await read_identity(session, actor)


@router.put("/me/roles")
async def save_roles(
    payload: RoleUpdate,
    actor: CurrentActor,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        roles = await update_roles(session, actor, payload)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"roles": roles}

