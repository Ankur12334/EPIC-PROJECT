from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings  # Pydantic v2 compatible


class Settings(BaseSettings):
    PROJECT_NAME: str = "FlatMate Backend"

    # Frontend origins
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ]

    # DB URL (SQLite for now; change to MySQL later if you want)
    # Example MySQL:
    DATABASE_URL: str = "mysql+aiomysql://appuser:apppassword@127.0.0.1:3306/flatmate_db"
    # DATABASE_URL: str = "sqlite+aiosqlite:///./flatmate.db"

    JWT_SECRET_KEY: str = "change-me-access-secret"
    JWT_REFRESH_SECRET_KEY: str = "change-me-refresh-secret"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    STATIC_UPLOAD_DIR: str = "app/static/uploads"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    """
    Preferred way: call get_settings() anywhere.
    """
    return Settings()


# For modules that do: from app.core.config import settings
settings: Settings = get_settings()
