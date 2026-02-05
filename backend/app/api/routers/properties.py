# app/api/routers/properties.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional

from app.db.session import get_db
from app.db import crud_properties, models
from app.schemas.property import PropertyDetail, PropertyBase

# 🔥 ADD THESE IMPORTS
from app.core.deps import get_current_user_optional
from app.db.models import User

router = APIRouter()


@router.get("/cities")
async def get_cities(db: AsyncSession = Depends(get_db)):
    cities = await crud_properties.list_cities(db)
    return cities


@router.get("/properties")
async def list_properties(
    db: AsyncSession = Depends(get_db),
    city: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    type: Optional[str] = None,
    gender: Optional[str] = None,
    sort: Optional[str] = None,
):
    filters = {
        "city": city,
        "min_price": min_price,
        "max_price": max_price,
        "type": type,
        "gender": gender,
        "sort": sort,
    }
    items, total = await crud_properties.list_properties(
        db,
        filters=filters,
        page=page,
        per_page=per_page,
    )
    page_obj = {
        "items": [PropertyBase.model_validate(p).model_dump() for p in items],
        "total": total,
        "page": page,
        "per_page": per_page,
    }
    return {"success": True, "data": page_obj}


@router.get("/properties/{prop_id}")
async def get_property_detail(
    prop_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),  # 👈 LOGIN CHECK
):
    """
    Fetch a single property with conditional access:
    - NOT logged in → hide owner phone, chat, booking
    - Logged in → allow all
    """
    stmt = (
        select(models.Property)
        .options(selectinload(models.Property.host))
        .where(models.Property.id == prop_id)
    )
    result = await db.execute(stmt)
    prop = result.scalars().first()

    if not prop:
        raise HTTPException(status_code=404, detail="Not found")

    # existing pydantic validation (UNCHANGED)
    detail = PropertyDetail.model_validate(prop).model_dump()

    # 🔥 CORE FEATURE LOGIC (THIS IS WHAT YOU ASKED)
    if current_user:
        detail["owner_phone"] = prop.host.phone
        detail["can_chat"] = True
        detail["can_book"] = True
    else:
        detail["owner_phone"] = None
        detail["can_chat"] = False
        detail["can_book"] = False

    return {"success": True, "data": detail}
