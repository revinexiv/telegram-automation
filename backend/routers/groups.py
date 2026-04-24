from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List

from backend.database import get_db, Group

router = APIRouter(prefix="/api/groups", tags=["groups"])


class GroupCreate(BaseModel):
    group_id: str
    username: Optional[str] = None
    title: str
    member_count: Optional[int] = 0
    category: Optional[str] = None


class GroupUpdate(BaseModel):
    username: Optional[str] = None
    title: Optional[str] = None
    member_count: Optional[int] = None
    category: Optional[str] = None
    is_active: Optional[bool] = None


class GroupBulkImport(BaseModel):
    groups: List[GroupCreate]


@router.get("/")
async def list_groups(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Group).order_by(Group.created_at.desc()))
    groups = result.scalars().all()
    return [
        {
            "id": g.id,
            "group_id": g.group_id,
            "username": g.username,
            "title": g.title,
            "member_count": g.member_count,
            "is_active": g.is_active,
            "category": g.category,
            "last_sent": g.last_sent.isoformat() if g.last_sent else None,
            "created_at": g.created_at.isoformat(),
        }
        for g in groups
    ]


@router.post("/")
async def create_group(body: GroupCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(Group).where(Group.group_id == body.group_id))
    if existing.scalar_one_or_none():
        raise HTTPException(400, f"Grup dengan ID {body.group_id} sudah ada")
    grp = Group(**body.model_dump())
    db.add(grp)
    await db.commit()
    await db.refresh(grp)
    return {"message": "Grup ditambahkan", "id": grp.id}


@router.post("/bulk-import")
async def bulk_import(body: GroupBulkImport, db: AsyncSession = Depends(get_db)):
    """Import banyak grup sekaligus (dari hasil detect-groups)."""
    added = 0
    skipped = 0
    for g_data in body.groups:
        existing = await db.execute(select(Group).where(Group.group_id == g_data.group_id))
        if existing.scalar_one_or_none():
            skipped += 1
            continue
        grp = Group(**g_data.model_dump())
        db.add(grp)
        added += 1
    await db.commit()
    return {"added": added, "skipped": skipped}


@router.put("/{group_id}")
async def update_group(group_id: int, body: GroupUpdate, db: AsyncSession = Depends(get_db)):
    grp = await db.get(Group, group_id)
    if not grp:
        raise HTTPException(404, "Grup tidak ditemukan")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(grp, field, val)
    await db.commit()
    return {"message": "Grup diperbarui"}


@router.delete("/{group_id}")
async def delete_group(group_id: int, db: AsyncSession = Depends(get_db)):
    grp = await db.get(Group, group_id)
    if not grp:
        raise HTTPException(404, "Grup tidak ditemukan")
    await db.delete(grp)
    await db.commit()
    return {"message": "Grup dihapus"}
