# backend/app/db/session.py
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings  # NOTE: instance import, NOT class


# Create engine using instance settings (NOT Settings.DATABASE_URL)
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
)

# Session factory
AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# FastAPI dependency
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
