# backend/app/schemas/user.py
from typing import Optional
from pydantic import BaseModel, EmailStr


class UserBase(BaseModel):
    id: int
    name: str
    email: EmailStr
    phone: Optional[str] = None
    role: str

    # Pydantic v2 style (replaces orm_mode = True)
    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    phone: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserRoleUpdate(BaseModel):
    """
    Admin ke through role change ke liye:
      body: { "role": "user" | "host" | "admin" }
    """
    role: str


class UserOut(UserBase):
    """
    Public-facing user data (e.g. auth token payload).
    Abhi ke liye UserOut == UserBase, but we can customize later.
    """
    pass
