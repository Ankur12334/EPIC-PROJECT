from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select

from app.api.dependencies import require_role
from app.db.session import get_db
from app.db.models import User, Property, Booking
from app.db import crud_users, crud_properties
from app.schemas.user import UserBase, UserRoleUpdate


router = APIRouter()


@router.get("/stats")
async def admin_stats(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    users_count = (await db.execute(select(func.count(User.id)))).scalar_one()
    props_count = (await db.execute(select(func.count(Property.id)))).scalar_one()
    bookings_count = (await db.execute(select(func.count(Booking.id)))).scalar_one()
    return {
        "total_users": users_count,
        "total_properties": props_count,
        "total_bookings": bookings_count,
    }


@router.get("/users")
async def admin_users(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    users = await crud_users.list_users(db)
    return {"data": [UserBase.model_validate(u) for u in users]}


@router.put("/users/{user_id}/role")
async def set_role(
    user_id: int,
    body: UserRoleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    if body.role not in ["user", "host", "admin"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    user = await crud_users.update_user_role(db, user_id, body.role)
    return UserBase.model_validate(user)


@router.get("/properties")
async def admin_properties(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    """
    Full property list for admin (any approval_status).
    """
    items = await crud_properties.list_all_properties_with_uploader(db)
    return {"data": {"items": items}}


@router.get("/properties/pending")
async def admin_pending_properties(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    """
    Only pending listings, for review.
    """
    items = await crud_properties.list_pending_properties_with_uploader(db)
    return {"data": {"items": items}}


@router.post("/properties/{prop_id}/approve")
async def admin_approve_property(
    prop_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    """
    Approve listing so it becomes visible on public pages.
    """
    prop = await crud_properties.approve_property(db, prop_id, current_user.id)
    if not prop:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "approved", "data": prop}


@router.post("/properties/{prop_id}/reject")
async def admin_reject_property(
    prop_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    """
    Reject listing; it will not appear on public pages.
    """
    prop = await crud_properties.reject_property(db, prop_id, current_user.id)
    if not prop:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "rejected", "data": prop}


@router.delete("/properties/{prop_id}")
async def admin_delete_property(
    prop_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("admin")),
    body: dict | None = None,
):
    # optional "reason" in body
    prop = await crud_properties.get_property(db, prop_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Not found")
    await crud_properties.delete_property(db, prop)
    return {"message": "deleted"}
