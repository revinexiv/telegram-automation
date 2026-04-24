import json
import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from backend.database import get_db, Template
from backend.config import MEDIA_DIR
from backend.services.template_engine import extract_variables, render_template

router = APIRouter(prefix="/api/templates", tags=["templates"])


class TemplateCreate(BaseModel):
    name: str
    content: str
    media_path: Optional[str] = None


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None
    media_path: Optional[str] = None
    is_active: Optional[bool] = None


class PreviewSchema(BaseModel):
    content: str
    variable_data: dict = {}


@router.get("/")
async def list_templates(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Template).order_by(Template.created_at.desc()))
    templates = result.scalars().all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "content": t.content,
            "media_path": t.media_path,
            "variables": json.loads(t.variables or "[]"),
            "is_active": t.is_active,
            "created_at": t.created_at.isoformat(),
        }
        for t in templates
    ]


@router.post("/")
async def create_template(body: TemplateCreate, db: AsyncSession = Depends(get_db)):
    variables = extract_variables(body.content)
    tmpl = Template(
        name=body.name,
        content=body.content,
        media_path=body.media_path,
        variables=json.dumps(variables),
    )
    db.add(tmpl)
    await db.commit()
    await db.refresh(tmpl)
    return {"message": "Template dibuat", "id": tmpl.id, "variables": variables}


@router.put("/{template_id}")
async def update_template(template_id: int, body: TemplateUpdate, db: AsyncSession = Depends(get_db)):
    tmpl = await db.get(Template, template_id)
    if not tmpl:
        raise HTTPException(404, "Template tidak ditemukan")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(tmpl, field, val)
    if body.content:
        tmpl.variables = json.dumps(extract_variables(body.content))
    await db.commit()
    return {"message": "Template diperbarui"}


@router.delete("/{template_id}")
async def delete_template(template_id: int, db: AsyncSession = Depends(get_db)):
    tmpl = await db.get(Template, template_id)
    if not tmpl:
        raise HTTPException(404, "Template tidak ditemukan")
    await db.delete(tmpl)
    await db.commit()
    return {"message": "Template dihapus"}


@router.post("/preview")
async def preview_template(body: PreviewSchema):
    """Preview template dengan data variabel."""
    rendered = render_template(body.content, body.variable_data)
    return {"rendered": rendered}


@router.post("/upload-media")
async def upload_media(file: UploadFile = File(...)):
    """Upload gambar untuk digunakan di template."""
    allowed = {".jpg", ".jpeg", ".png", ".gif", ".mp4", ".webp"}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed:
        raise HTTPException(400, f"Format tidak didukung. Gunakan: {', '.join(allowed)}")

    save_path = os.path.join(MEDIA_DIR, file.filename)
    # Handle duplicate filename
    if os.path.exists(save_path):
        base, extension = os.path.splitext(file.filename)
        import time
        save_path = os.path.join(MEDIA_DIR, f"{base}_{int(time.time())}{extension}")

    content = await file.read()
    with open(save_path, "wb") as f:
        f.write(content)

    return {"path": save_path, "filename": os.path.basename(save_path)}


@router.get("/media-library")
async def media_library():
    """Daftar semua media yang sudah diupload."""
    files = []
    if os.path.exists(MEDIA_DIR):
        for fname in os.listdir(MEDIA_DIR):
            fpath = os.path.join(MEDIA_DIR, fname)
            if os.path.isfile(fpath):
                files.append({
                    "filename": fname,
                    "path": fpath,
                    "size": os.path.getsize(fpath)
                })
    return {"files": files}
