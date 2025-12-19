# app/db/models.py

from datetime import datetime, date

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Date,
    Text,
    ForeignKey,
    Numeric,
    Boolean,
    JSON,
)
from sqlalchemy.orm import relationship

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)

    # DB is VARCHAR(10) NOT NULL
    phone = Column(String(10), nullable=False)

    # DB column name: password_hash
    # Python attribute: hashed_password
    hashed_password = Column("password_hash", String(255), nullable=False)

    role = Column(String(20), nullable=False, default="user")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Host's own properties (via properties.host_id)
    properties = relationship(
        "Property",
        back_populates="host",
        foreign_keys="Property.host_id",
    )

    # Properties this user approved as admin (via properties.approved_by_admin_id)
    approved_properties = relationship(
        "Property",
        foreign_keys="Property.approved_by_admin_id",
        back_populates="approved_by_admin",
    )

    bookings = relationship(
        "Booking",
        back_populates="user",
        cascade="all,delete-orphan",
        passive_deletes=True,
    )

    refresh_tokens = relationship(
        "UserRefreshToken",
        back_populates="user",
        cascade="all,delete-orphan",
        passive_deletes=True,
    )


class Property(Base):
    __tablename__ = "properties"

    id = Column(Integer, primary_key=True, index=True)

    host_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    price = Column(Numeric(10, 2), nullable=False)

    city = Column(String(100), nullable=False, index=True)
    locality = Column(String(255), nullable=True)

    type = Column(String(50), nullable=False, default="Room")
    gender = Column(String(20), nullable=False, default="Any")

    # list[str] as JSON in DB
    images = Column(JSON, nullable=False, default=list)

    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Approval fields
    # "pending" | "approved" | "rejected"
    approval_status = Column(
        String(20),
        nullable=False,
        default="pending",
        index=True,
    )
    approved_at = Column(DateTime, nullable=True)
    approved_by_admin_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    host = relationship(
        "User",
        back_populates="properties",
        foreign_keys=[host_id],
    )

    approved_by_admin = relationship(
        "User",
        back_populates="approved_properties",
        foreign_keys=[approved_by_admin_id],
    )

    bookings = relationship(
        "Booking",
        back_populates="property",
        cascade="all,delete-orphan",
        passive_deletes=True,
    )


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    property_id = Column(
        Integer,
        ForeignKey("properties.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)

    status = Column(String(20), nullable=False, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="bookings")
    property = relationship("Property", back_populates="bookings")


class UserRefreshToken(Base):
    __tablename__ = "user_refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    revoked = Column(Boolean, nullable=False, default=False)

    user = relationship("User", back_populates="refresh_tokens")
