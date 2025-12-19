# backend/app/schemas/property.py
from typing import Optional, List
from pydantic import BaseModel


class HostInfo(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None

    class Config:
        from_attributes = True


class PropertyBase(BaseModel):
    id: int
    title: str
    description: str
    price: float
    city: str
    locality: str
    type: str
    gender: str
    images: List[str]
    host_id: int
    # NEW: expose approval status to frontend
    approval_status: str

    class Config:
        from_attributes = True


class PropertyDetail(PropertyBase):
    host: HostInfo


class PropertyCreate(BaseModel):
    title: str
    description: str = ""
    price: float
    city: str
    locality: str
    type: str
    gender: str
    images: List[str] = []


class PropertyUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    city: Optional[str] = None
    locality: Optional[str] = None
    type: Optional[str] = None
    gender: Optional[str] = None
    images: Optional[List[str]] = None


class PropertiesPage(BaseModel):
    items: list[PropertyBase]
    total: int
    page: int
    per_page: int
