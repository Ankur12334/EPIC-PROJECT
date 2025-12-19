# app/db/crud_properties.py
from datetime import datetime
from typing import Tuple, List, Dict, Any

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Property


async def list_cities(db: AsyncSession) -> List[Dict[str, Any]]:
    """
    Return list of {city, count} objects expected by frontend.
    Only counts APPROVED & ACTIVE properties.
    """
    stmt = (
        select(Property.city, func.count(Property.id).label("count"))
        .where(Property.city.isnot(None))
        .where(Property.city != "")
        .where(Property.is_active.is_(True))
        .where(Property.approval_status == "approved")
        .group_by(Property.city)
        .order_by(func.count(Property.id).desc())
    )
    res = await db.execute(stmt)
    rows = res.all()
    # rows are tuples (city, count)
    return [{"city": r.city, "count": int(r.count)} for r in rows]


async def list_properties(
    db: AsyncSession,
    filters: dict = None,
    page: int = 1,
    per_page: int = 20,
) -> Tuple[List[Property], int]:
    """
    Public listing: ALWAYS only approved & active properties.
    """
    filters = filters or {}
    stmt = select(Property)

    where_clauses = [
        Property.is_active.is_(True),
        Property.approval_status == "approved",
    ]

    if filters.get("city"):
        where_clauses.append(Property.city == filters["city"])
    if filters.get("min_price") is not None:
        where_clauses.append(Property.price >= float(filters["min_price"]))
    if filters.get("max_price") is not None:
        where_clauses.append(Property.price <= float(filters["max_price"]))
    if filters.get("type"):
        where_clauses.append(Property.type == filters["type"])
    if filters.get("gender"):
        where_clauses.append(Property.gender == filters["gender"])

    if where_clauses:
        stmt = stmt.where(and_(*where_clauses))

    # sorting
    sort = filters.get("sort")
    if sort == "price_asc":
        stmt = stmt.order_by(Property.price.asc())
    elif sort == "price_desc":
        stmt = stmt.order_by(Property.price.desc())
    else:
        # default: recent first
        stmt = stmt.order_by(Property.id.desc())

    # count total
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_res = await db.execute(count_stmt)
    total = total_res.scalar_one()

    offset = (page - 1) * per_page
    stmt = stmt.offset(offset).limit(per_page)
    res = await db.execute(stmt)
    items = list(res.scalars().all())
    return items, int(total)


async def get_property(db: AsyncSession, prop_id: int) -> Property | None:
    res = await db.execute(select(Property).where(Property.id == prop_id))
    return res.scalars().first()


async def list_properties_for_host(db: AsyncSession, host_id: int) -> List[Property]:
    """
    Host dashboard: show ALL their properties, regardless of approval_status.
    """
    res = await db.execute(
        select(Property)
        .where(Property.host_id == host_id)
        .order_by(Property.id.desc())
    )
    return list(res.scalars().all())


async def create_property(db: AsyncSession, **kwargs) -> Property:
    """
    Generic create. Enforce approval_status default if not supplied.
    """
    if not kwargs.get("approval_status"):
        kwargs["approval_status"] = "pending"
    prop = Property(**kwargs)
    db.add(prop)
    await db.commit()
    await db.refresh(prop)
    return prop


async def update_property(db: AsyncSession, prop: Property, data: dict) -> Property:
    for k, v in data.items():
        if v is not None:
            setattr(prop, k, v)
    db.add(prop)
    await db.commit()
    await db.refresh(prop)
    return prop


async def delete_property(db: AsyncSession, prop: Property):
    await db.delete(prop)
    await db.commit()
    return True


# --- ADMIN: get all properties with uploader (host) ---

async def list_all_properties_with_uploader(db: AsyncSession) -> List[Property]:
    """
    Admin full list: ALL properties (any status), with host loaded.
    """
    stmt = (
        select(Property)
        .options(selectinload(Property.host))   # load uploader/host
        .order_by(Property.id.desc())
    )
    res = await db.execute(stmt)
    return list(res.scalars().all())


async def list_pending_properties_with_uploader(db: AsyncSession) -> List[Property]:
    """
    Admin view: only PENDING properties + host relationship.
    """
    stmt = (
        select(Property)
        .options(selectinload(Property.host))
        .where(Property.approval_status == "pending")
        .order_by(Property.id.desc())
    )
    res = await db.execute(stmt)
    return list(res.scalars().all())


async def approve_property(
    db: AsyncSession,
    property_id: int,
    admin_id: int | None = None,
) -> Property | None:
    """
    Set approval_status='approved' and stamp approver + timestamp.
    """
    prop = await get_property(db, property_id)
    if not prop:
        return None
    prop.approval_status = "approved"
    prop.approved_at = datetime.utcnow()
    prop.approved_by_admin_id = admin_id
    db.add(prop)
    await db.commit()
    await db.refresh(prop)
    return prop


async def reject_property(
    db: AsyncSession,
    property_id: int,
    admin_id: int | None = None,
) -> Property | None:
    """
    Set approval_status='rejected'. approved_at cleared; approver stored for history.
    """
    prop = await get_property(db, property_id)
    if not prop:
        return None
    prop.approval_status = "rejected"
    prop.approved_at = None
    prop.approved_by_admin_id = admin_id
    db.add(prop)
    await db.commit()
    await db.refresh(prop)
    return prop
