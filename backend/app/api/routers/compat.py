from fastapi import APIRouter

router = APIRouter()


@router.get("/ping")
async def compat_ping():
    return {"status": "ok"}
