from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user

router = APIRouter()


@router.get("")
async def list_notifications(current_user=Depends(get_current_user)):
    # simple stub; frontend can ignore for now
    return {"items": []}
