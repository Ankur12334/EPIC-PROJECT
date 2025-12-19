# app/db/crud_bookings.py

from datetime import date
from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Booking, Property


async def create_booking(
    db: AsyncSession,
    *,
    user_id: int,
    property_id: int,
    start_date: date,
    end_date: date,
) -> Booking:
    booking = Booking(
        user_id=user_id,
        property_id=property_id,
        start_date=start_date,
        end_date=end_date,
        status="pending",
    )
    db.add(booking)
    await db.commit()
    await db.refresh(booking)
    return booking


async def list_bookings_for_user(db: AsyncSession, user_id: int) -> List[Booking]:
    stmt = (
        select(Booking)
        .where(Booking.user_id == user_id)
        .order_by(Booking.id.desc())
    )
    res = await db.execute(stmt)
    return list(res.scalars().all())


async def list_bookings_for_host(db: AsyncSession, host_id: int) -> List[Booking]:
    """
    All bookings for properties owned by host_id
    """
    stmt = (
        select(Booking)
        .join(Property, Booking.property_id == Property.id)
        .where(Property.host_id == host_id)
        .order_by(Booking.id.desc())
    )
    res = await db.execute(stmt)
    return list(res.scalars().all())
