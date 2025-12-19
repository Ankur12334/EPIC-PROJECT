# backend/app/schemas/booking.py
from datetime import date, datetime
from pydantic import BaseModel


class BookingCreate(BaseModel):
    property_id: int
    start_date: date
    end_date: date


class BookingOut(BaseModel):
    id: int
    property_id: int
    user_id: int
    start_date: date
    end_date: date
    created_at: datetime

    # Pydantic v2 style – replaces orm_mode=True
    model_config = {"from_attributes": True}
