# app/api/routers/auth.py
from typing import Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status, Body
from sqlalchemy.ext.asyncio import AsyncSession
from jose import JWTError

from app.db.session import get_db
from app.db import crud_users
from app.schemas.auth import Token
from app.schemas.user import UserCreate, UserOut
from app.core.security import (
    create_access_token,
    create_refresh_token,
    verify_password,
    decode_token,
)

router = APIRouter()


def _token_response(user, access: str, refresh: str) -> Dict[str, Any]:
    """
    Return a simple dict matching the Token pydantic model:
    { access_token, refresh_token, token_type, user }
    """
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": UserOut.model_validate(user),
    }


@router.post("/register", response_model=Token)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await crud_users.get_user_by_email(db, payload.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email exists")

    user = await crud_users.create_user(
        db=db,
        name=payload.name,
        email=payload.email,
        password=payload.password,
        phone=payload.phone,
    )

    data = {"user_id": user.id, "role": user.role}
    access = create_access_token(data)
    refresh = create_refresh_token(data)
    # persist refresh if function exists; don't fail if it errors
    try:
        if hasattr(crud_users, "save_refresh_token"):
            await crud_users.save_refresh_token(db, user.id, refresh)
    except Exception:
        pass

    return _token_response(user, access, refresh)


@router.post("/login", response_model=Token)
async def login(
    form_data: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    email = form_data.get("email")
    password = form_data.get("password")

    if not email or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing email or password")

    user = await crud_users.get_user_by_email(db, email)
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    data = {"user_id": user.id, "role": user.role}
    access = create_access_token(data)
    refresh = create_refresh_token(data)
    try:
        if hasattr(crud_users, "save_refresh_token"):
            await crud_users.save_refresh_token(db, user.id, refresh)
    except Exception:
        pass

    return _token_response(user, access, refresh)


@router.post("/refresh", response_model=Token)
async def refresh(
    body: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    # Accept both "refresh" (frontend) and "refresh_token" (fallback)
    token = body.get("refresh") or body.get("refresh_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing token")

    try:
        payload = decode_token(token)
        if payload.get("type") != "refresh":
            raise ValueError("Not a refresh token")
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token (jwt error)",
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    # Accept both 'sub' and 'user_id' claims
    user_id = payload.get("sub") or payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    try:
        uid = int(user_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user id in token")

    user = await crud_users.get_user(db, uid)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    data = {"user_id": user.id, "role": user.role}
    new_access = create_access_token(data)
    new_refresh = create_refresh_token(data)

    try:
        if hasattr(crud_users, "save_refresh_token"):
            await crud_users.save_refresh_token(db, user.id, new_refresh)
    except Exception:
        # don't block on refresh token persistence
        pass

    return _token_response(user, new_access, new_refresh)


@router.post("/logout")
async def logout(
    body: Dict[str, Any] | None = Body(None),
    db: AsyncSession = Depends(get_db),
):
    # Frontend currently doesn't send body, so make this optional.
    token = (body or {}).get("refresh") or (body or {}).get("refresh_token")
    if token and hasattr(crud_users, "revoke_refresh_token"):
        try:
            await crud_users.revoke_refresh_token(db, token)
        except Exception:
            pass
    return {"ok": True}
