# app/core/security.py

from datetime import datetime, timedelta
from typing import Any, Dict

from jose import jwt, JWTError
from passlib.context import CryptContext

from app.core.config import settings

# --------------------------------------
# Password hashing config
# --------------------------------------
# bcrypt ki jagah pbkdf2_sha256 use kar rahe hain:
# - koi 72-byte limit nahi
# - bcrypt library version issues se bhi bach jaoge
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


# --------------------------------------
# Token creation helpers
# --------------------------------------

def _create_token(
    data: Dict[str, Any],
    expires_delta: timedelta,
    *,
    secret_key: str,
    token_type: str,
) -> str:
    to_encode = data.copy()
    now = datetime.utcnow()
    to_encode.update(
        {
            "iat": now,
            "exp": now + expires_delta,
            "type": token_type,
        }
    )
    return jwt.encode(to_encode, secret_key, algorithm=settings.JWT_ALGORITHM)


def create_access_token(data: Dict[str, Any]) -> str:
    expire = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return _create_token(
        data=data,
        expires_delta=expire,
        secret_key=settings.JWT_SECRET_KEY,
        token_type="access",
    )


def create_refresh_token(data: Dict[str, Any]) -> str:
    expire = timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return _create_token(
        data=data,
        expires_delta=expire,
        secret_key=settings.JWT_REFRESH_SECRET_KEY,
        token_type="refresh",
    )


# --------------------------------------
# Token verification helpers
# --------------------------------------

def decode_token(token: str) -> Dict[str, Any]:
    """
    Decode token with either access or refresh secret.
    Used mainly by /refresh; caller is responsible for checking payload["type"].
    """
    last_error: Exception | None = None

    # Try access secret
    try:
        return jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError as e:
        last_error = e

    # Try refresh secret
    try:
        return jwt.decode(
            token,
            settings.JWT_REFRESH_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError as e:
        last_error = e

    # Re-raise last error
    raise last_error  # type: ignore[misc]


def verify_access_token(token: str) -> Dict[str, Any]:
    """
    Decode and validate an *access* token.
    Used by get_current_user.
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError as e:
        raise e

    if payload.get("type") != "access":
        raise JWTError("Invalid token type")

    if "user_id" not in payload:
        raise JWTError("Missing user_id in token")

    return payload
