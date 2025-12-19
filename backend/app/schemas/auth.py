# app/schemas/auth.py
from typing import Optional
from pydantic import BaseModel

from app.schemas.user import UserOut


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: Optional[UserOut] = None

    model_config = {"from_attributes": True}
