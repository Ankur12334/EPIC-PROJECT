from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.dependencies import get_current_user
from app.db.session import get_db
from app.db.models import Booking, Property, User
from app.schemas.user import UserBase

router = APIRouter()


# -----------------------------
# EXISTING ENDPOINT (UNCHANGED)
# -----------------------------
@router.get("/me")
async def me(current_user: User = Depends(get_current_user)):
    return UserBase.model_validate(current_user)


# -----------------------------------
# NEW FEATURE: USER BOOKED ROOMS
# -----------------------------------
@router.get("/booked-rooms")
async def get_my_booked_rooms(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = (
        select(
            Property.title,
            Property.city,
            Booking.start_date,
            Booking.end_date,
            Booking.status,
        )
        .join(Property, Property.id == Booking.property_id)
        .where(Booking.user_id == current_user.id)
        .order_by(Booking.start_date.desc())
    )

    result = await db.execute(stmt)
    rows = result.all()

    data = [
        {
            "title": row.title,
            "city": row.city,
            "start_date": row.start_date,
            "end_date": row.end_date,
            "status": row.status,
        }
        for row in rows
    ]

    return {
        "success": True,
        "data": data,
    }
