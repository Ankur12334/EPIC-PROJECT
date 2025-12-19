from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date

from app.api.dependencies import get_current_user
from app.db.session import get_db
from app.db.models import Property
from app.db import crud_bookings
from app.schemas.booking import BookingCreate, BookingOut
from sqlalchemy import select

router = APIRouter()


@router.post("/bookings")
async def create_booking(
    body: BookingCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if body.start_date > body.end_date or body.start_date < date.today():
        raise HTTPException(status_code=400, detail="Invalid dates")
    prop_res = await db.execute(select(Property).where(Property.id == body.property_id))
    prop = prop_res.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    booking = await crud_bookings.create_booking(
        db,
        user_id=current_user.id,
        property_id=body.property_id,
        start_date=body.start_date,
        end_date=body.end_date,
    )
    return {"success": True, "data": BookingOut.model_validate(booking)}


@router.get("/bookings")
async def list_bookings(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    bookings = await crud_bookings.list_bookings_for_user(db, current_user.id)
    return {"items": [BookingOut.model_validate(b) for b in bookings]}
