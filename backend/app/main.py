import uvicorn
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import Settings
from app.db.base import Base
from app.db.session import engine
from app.api.routers import (
    auth as auth_router,
    users as users_router,
    properties as properties_router,
    bookings as bookings_router,
    host as host_router,
    admin as admin_router,
    upload as upload_router,
    compat as compat_router,
    notifications as notifications_router,
)

settings = Settings()

app = FastAPI(title=settings.PROJECT_NAME)

# ---------------------------
# CORS
# ---------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5501",
        "http://localhost:5500",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------
# Static files
# ---------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# ---------------------------
# Startup
# ---------------------------
@app.on_event("startup")
async def on_startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

# ---------------------------
# Routers
# ---------------------------
app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
app.include_router(users_router.router, prefix="/api/users", tags=["users"])

# 🔥 FIX HERE
app.include_router(properties_router.router, prefix="/api", tags=["properties"])

app.include_router(bookings_router.router, prefix="/api/bookings", tags=["bookings"])
app.include_router(host_router.router, prefix="/api/host", tags=["host"])
app.include_router(admin_router.router, prefix="/api/admin", tags=["admin"])
app.include_router(upload_router.router, prefix="/api/upload", tags=["upload"])
app.include_router(compat_router.router, prefix="/api/compat", tags=["compat"])
app.include_router(notifications_router.router, prefix="/api/notifications", tags=["notifications"])

# ---------------------------
# Health check
# ---------------------------
@app.get("/ping")
async def ping():
    return {"status": "ok"}

# ---------------------------
# Run
# ---------------------------
if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
