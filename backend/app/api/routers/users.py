from fastapi import APIRouter, Depends
from app.api.dependencies import get_current_user
from app.schemas.user import UserBase

router = APIRouter()


@router.get("/me")
async def me(current_user=Depends(get_current_user)):
    return UserBase.model_validate(current_user)
