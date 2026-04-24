import json
import asyncio
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List

from backend.database import get_db, Campaign
from backend.services import campaign_engine

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])


class CampaignCreate(BaseModel):
    name: str
    template_id: int
    target_groups: List[int] = []
    variable_data: dict = {}
    delay_min: Optional[int] = 5
    delay_max: Optional[int] = 20
    prevent_duplicate: Optional[bool] = False
    parallel_mode: Optional[bool] = True
    schedule_start: Optional[datetime] = None
    loop_count: Optional[int] = 1


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    target_groups: Optional[List[int]] = None
    variable_data: Optional[dict] = None
    delay_min: Optional[int] = None
    delay_max: Optional[int] = None
    prevent_duplicate: Optional[bool] = None
    parallel_mode: Optional[bool] = None


@router.get("/")
async def list_campaigns(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Campaign).order_by(Campaign.created_at.desc()))
    campaigns = result.scalars().all()
    out = []
    for c in campaigns:
        rt_status = campaign_engine.get_campaign_status(c.id)
        out.append({
            "id": c.id,
            "name": c.name,
            "template_id": c.template_id,
            "status": c.status,
            "target_groups": json.loads(c.target_groups or "[]"),
            "variable_data": json.loads(c.variable_data or "{}"),
            "delay_min": c.delay_min,
            "delay_max": c.delay_max,
            "prevent_duplicate": c.prevent_duplicate,
            "parallel_mode": c.parallel_mode,
            "loop_count": c.loop_count,
            "created_at": c.created_at.isoformat(),
            "completed_at": c.completed_at.isoformat() if c.completed_at else None,
            "runtime": rt_status,
        })
    return out


@router.post("/")
async def create_campaign(body: CampaignCreate, db: AsyncSession = Depends(get_db)):
    camp = Campaign(
        name=body.name,
        template_id=body.template_id,
        target_groups=json.dumps(body.target_groups),
        variable_data=json.dumps(body.variable_data),
        delay_min=body.delay_min,
        delay_max=body.delay_max,
        prevent_duplicate=body.prevent_duplicate,
        parallel_mode=body.parallel_mode,
        loop_count=body.loop_count,
        schedule_start=body.schedule_start,
        status="draft"
    )
    db.add(camp)
    await db.commit()
    await db.refresh(camp)
    return {"message": "Campaign dibuat", "id": camp.id}


@router.put("/{campaign_id}")
async def update_campaign(campaign_id: int, body: CampaignUpdate, db: AsyncSession = Depends(get_db)):
    camp = await db.get(Campaign, campaign_id)
    if not camp:
        raise HTTPException(404, "Campaign tidak ditemukan")
    if camp.status == "running":
        raise HTTPException(400, "Tidak bisa edit campaign yang sedang berjalan")
    if body.name is not None:
        camp.name = body.name
    if body.target_groups is not None:
        camp.target_groups = json.dumps(body.target_groups)
    if body.variable_data is not None:
        camp.variable_data = json.dumps(body.variable_data)
    if body.delay_min is not None:
        camp.delay_min = body.delay_min
    if body.delay_max is not None:
        camp.delay_max = body.delay_max
    if body.prevent_duplicate is not None:
        camp.prevent_duplicate = body.prevent_duplicate
    if body.parallel_mode is not None:
        camp.parallel_mode = body.parallel_mode
    await db.commit()
    return {"message": "Campaign diperbarui"}


@router.delete("/{campaign_id}")
async def delete_campaign(campaign_id: int, db: AsyncSession = Depends(get_db)):
    camp = await db.get(Campaign, campaign_id)
    if not camp:
        raise HTTPException(404, "Campaign tidak ditemukan")
    if camp.status == "running":
        campaign_engine.stop_campaign(campaign_id)
    await db.delete(camp)
    await db.commit()
    return {"message": "Campaign dihapus"}


@router.post("/{campaign_id}/start")
async def start_campaign(campaign_id: int, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    camp = await db.get(Campaign, campaign_id)
    if not camp:
        raise HTTPException(404, "Campaign tidak ditemukan")
    if camp.status == "running":
        raise HTTPException(400, "Campaign sudah berjalan")

    # Jalankan di background
    background_tasks.add_task(campaign_engine.run_campaign, campaign_id)
    return {"message": "Campaign dimulai"}


@router.post("/{campaign_id}/stop")
async def stop_campaign(campaign_id: int, db: AsyncSession = Depends(get_db)):
    camp = await db.get(Campaign, campaign_id)
    if not camp:
        raise HTTPException(404, "Campaign tidak ditemukan")
    campaign_engine.stop_campaign(campaign_id)
    camp.status = "stopped"
    await db.commit()
    return {"message": "Campaign dihentikan"}


@router.post("/{campaign_id}/pause")
async def pause_campaign(campaign_id: int):
    campaign_engine.pause_campaign(campaign_id)
    return {"message": "Campaign dipause"}


@router.post("/{campaign_id}/resume")
async def resume_campaign(campaign_id: int):
    campaign_engine.resume_campaign(campaign_id)
    return {"message": "Campaign dilanjutkan"}


@router.get("/{campaign_id}/status")
async def campaign_status(campaign_id: int):
    return campaign_engine.get_campaign_status(campaign_id)
