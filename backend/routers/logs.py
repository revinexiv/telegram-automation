from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from typing import Optional

from backend.database import get_db, SendLog, Account, Group, Campaign

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("/")
async def list_logs(
    db: AsyncSession = Depends(get_db),
    campaign_id: Optional[int] = None,
    account_id: Optional[int] = None,
    status: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
):
    query = select(SendLog).order_by(desc(SendLog.sent_at))

    if campaign_id:
        query = query.where(SendLog.campaign_id == campaign_id)
    if account_id:
        query = query.where(SendLog.account_id == account_id)
    if status:
        query = query.where(SendLog.status == status)

    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    logs = result.scalars().all()

    return [
        {
            "id": l.id,
            "campaign_id": l.campaign_id,
            "account_id": l.account_id,
            "group_id": l.group_id,
            "status": l.status,
            "error_message": l.error_message,
            "message_id": l.message_id,
            "sent_at": l.sent_at.isoformat(),
        }
        for l in logs
    ]


@router.get("/stats")
async def log_stats(db: AsyncSession = Depends(get_db), campaign_id: Optional[int] = None):
    """Statistik pengiriman."""
    base_filter = []
    if campaign_id:
        base_filter.append(SendLog.campaign_id == campaign_id)

    total = await db.execute(select(func.count(SendLog.id)).where(*base_filter))
    success = await db.execute(select(func.count(SendLog.id)).where(SendLog.status == "success", *base_filter))
    failed = await db.execute(select(func.count(SendLog.id)).where(SendLog.status == "failed", *base_filter))
    rate_limited = await db.execute(select(func.count(SendLog.id)).where(SendLog.status == "rate_limited", *base_filter))
    skipped = await db.execute(select(func.count(SendLog.id)).where(SendLog.status == "skipped", *base_filter))

    return {
        "total": total.scalar(),
        "success": success.scalar(),
        "failed": failed.scalar(),
        "rate_limited": rate_limited.scalar(),
        "skipped": skipped.scalar(),
    }
