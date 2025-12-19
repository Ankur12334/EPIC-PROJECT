from pathlib import Path
import shutil

from fastapi import APIRouter, File, UploadFile, Depends
from app.core.config import get_settings
from app.api.dependencies import get_current_user

router = APIRouter()

settings = get_settings()


@router.post("/image")
async def upload_image(
    image: UploadFile = File(...),
    user=Depends(get_current_user),
):
    upload_dir = Path(settings.STATIC_UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{user.id}_{image.filename}"
    dest = upload_dir / filename
    with dest.open("wb") as f:
        shutil.copyfileobj(image.file, f)
    url = f"/static/uploads/{filename}"
    return {"url": url}
