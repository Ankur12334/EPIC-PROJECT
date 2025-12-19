# app/db/crud_users.py

from typing import Optional, List

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User, UserRefreshToken
from app.core.security import get_password_hash


async def get_user(db: AsyncSession, user_id: int) -> Optional[User]:
    res = await db.execute(select(User).where(User.id == user_id))
    return res.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    res = await db.execute(select(User).where(User.email == email))
    return res.scalar_one_or_none()


async def list_users(db: AsyncSession) -> List[User]:
    res = await db.execute(select(User).order_by(User.id.desc()))
    return list(res.scalars().all())


async def create_user(
    db: AsyncSession,
    name: str,
    email: str,
    password: str,
    phone: Optional[str] = None,
) -> User:
    """
    Create a user with hashed password.

    Works with both:
      await create_user(db, payload.name, payload.email, payload.password, payload.phone)
    and:
      await create_user(db, name=..., email=..., password=..., phone=...)
    """
    hashed = get_password_hash(password)
    user = User(
        name=name,
        email=email,
        phone=phone,
        hashed_password=hashed,
        role="user",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def update_user_role(db: AsyncSession, user_id: int, role: str) -> User:
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise ValueError("User not found")

    user.role = role
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def save_refresh_token(db: AsyncSession, user_id: int, token: str) -> None:
    """
    Store a new refresh token for the user.
    Simple strategy: revoke existing, then insert new.
    """
    # Revoke all active tokens for that user
    await db.execute(
        update(UserRefreshToken)
        .where(UserRefreshToken.user_id == user_id, UserRefreshToken.revoked == False)  # noqa: E712
        .values(revoked=True)
    )

    db.add(UserRefreshToken(user_id=user_id, token=token))
    await db.commit()


async def revoke_refresh_token(db: AsyncSession, token: str) -> None:
    """
    Mark a single refresh token as revoked.
    """
    await db.execute(
        update(UserRefreshToken)
        .where(UserRefreshToken.token == token, UserRefreshToken.revoked == False)  # noqa: E712
        .values(revoked=True)
    )
    await db.commit()
