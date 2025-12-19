from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from pathlib import Path
import shutil

from app.api.dependencies import get_current_user   # <- use current user, not require_role
from app.core.config import get_settings
from app.db.session import get_db
from app.db import crud_properties, crud_bookings
from app.schemas.property import PropertyBase
from app.schemas.booking import BookingOut

router = APIRouter()


@router.get("/properties")
async def host_properties(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    List all properties for the currently authenticated user.
    Includes approval_status so host can see pending/approved/rejected.
    """
    items = await crud_properties.list_properties_for_host(
        db,
        host_id=current_user.id,
    )
    data = {"items": [PropertyBase.model_validate(p) for p in items]}
    return {"data": data}


@router.post("/properties")
async def create_property(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    title: str = Form(...),
    description: str = Form(""),
    price: float = Form(...),
    city: str = Form(...),
    locality: str = Form(""),
    type: str = Form("Room"),
    gender: str = Form("Any"),
    images: Optional[list[UploadFile]] = File(None),
):
    """
    Create a new property for the current user.
    Saves uploaded images into STATIC_UPLOAD_DIR and stores their URLs.
    New properties ALWAYS start as approval_status='pending'.
    """
    settings = get_settings()
    upload_dir = Path(settings.STATIC_UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)

    urls: list[str] = []
    if images:
        for img in images:
            if not img.filename:
                continue
            filename = f"{current_user.id}_{img.filename}"
            dest = upload_dir / filename
            with dest.open("wb") as f:
                shutil.copyfileobj(img.file, f)
            urls.append(f"/static/uploads/{filename}")

    prop = await crud_properties.create_property(
        db,
        host_id=current_user.id,
        title=title,
        description=description,
        price=price,
        city=city,
        locality=locality,
        type=type,
        gender=gender,
        images=urls,
        # explicit for clarity; create_property also enforces default
        approval_status="pending",
    )
    return {
        "message": "Listing created and pending admin approval.",
        "data": PropertyBase.model_validate(prop),
    }


@router.put("/properties/{prop_id}")
async def update_property(
    prop_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    title: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    price: Optional[float] = Form(None),
    city: Optional[str] = Form(None),
    locality: Optional[str] = Form(None),
    type: Optional[str] = Form(None),
    gender: Optional[str] = Form(None),
    images: Optional[list[UploadFile]] = File(None),
):
    """
    Update an existing property.
    Only owner (or admin, if your auth allows) can update.
    """
    prop = await crud_properties.get_property(db, prop_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Not found")

    if prop.host_id != current_user.id and getattr(current_user, "role", None) != "admin":
        raise HTTPException(status_code=403, detail="Not allowed")

    settings = get_settings()
    upload_dir = Path(settings.STATIC_UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)

    urls: list[str] = list(prop.images or [])
    if images:
        for img in images:
            if not img.filename:
                continue
            filename = f"{current_user.id}_{img.filename}"
            dest = upload_dir / filename
            with dest.open("wb") as f:
                shutil.copyfileobj(img.file, f)
            urls.append(f"/static/uploads/{filename}")

    data = {
        "title": title,
        "description": description,
        "price": price,
        "city": city,
        "locality": locality,
        "type": type,
        "gender": gender,
        "images": urls,
    }

    prop = await crud_properties.update_property(db, prop, data)
    return {"message": "updated", "data": PropertyBase.model_validate(prop)}


@router.delete("/properties/{prop_id}")
async def delete_property_host(
    prop_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Delete a property belonging to the current user (or admin).
    """
    prop = await crud_properties.get_property(db, prop_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Not found")

    if prop.host_id != current_user.id and getattr(current_user, "role", None) != "admin":
        raise HTTPException(status_code=403, detail="Not allowed")

    await crud_properties.delete_property(db, prop)
    return {"message": "deleted"}


@router.get("/bookings")
async def host_bookings(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    List all bookings for properties owned by the current user.
    """
    bookings = await crud_bookings.list_bookings_for_host(
        db,
        host_id=current_user.id,
    )
    return {"items": [BookingOut.model_validate(b) for b in bookings]}
