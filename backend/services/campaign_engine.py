"""
Campaign Engine — Menjalankan campaign pengiriman pesan secara async.
"""
import asyncio
import json
import logging
from datetime import datetime
from typing import Dict, Set

from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from backend.database import AsyncSessionLocal, Campaign, Account, Group, SendLog, Template
from backend.services import account_manager
from backend.services.anti_detection import human_delay, rotate_accounts
from backend.services.distribution import distribute_groups, get_optimal_groups_per_account
from backend.services.template_engine import render_template

logger = logging.getLogger(__name__)

# Running tasks: campaign_id -> set of asyncio.Task
_running_tasks: Dict[int, Set[asyncio.Task]] = {}
# Paused flag: campaign_id -> bool
_paused: Dict[int, bool] = {}
# Stopped flag: campaign_id -> bool
_stopped: Dict[int, bool] = {}

# WebSocket broadcast
_broadcast_fn = None


def set_broadcast(fn):
    global _broadcast_fn
    _broadcast_fn = fn


async def _broadcast(msg: dict):
    if _broadcast_fn:
        try:
            await _broadcast_fn(msg)
        except Exception:
            pass


async def _log_send(
    campaign_id: int,
    account_id: int,
    group_id: int,
    status: str,
    error_message: str = None,
    message_id: int = None
):
    """Simpan log pengiriman ke database dan broadcast ke dashboard."""
    async with AsyncSessionLocal() as db:
        log = SendLog(
            campaign_id=campaign_id,
            account_id=account_id,
            group_id=group_id,
            status=status,
            error_message=error_message,
            message_id=message_id,
            sent_at=datetime.utcnow()
        )
        db.add(log)

        # Update last_sent di tabel Group
        await db.execute(
            update(Group).where(Group.id == group_id).values(last_sent=datetime.utcnow())
        )

        # Update last_used & counter di Account
        if status == "success":
            await db.execute(
                update(Account)
                .where(Account.id == account_id)
                .values(
                    last_used=datetime.utcnow(),
                    messages_sent_today=Account.messages_sent_today + 1
                )
            )
        await db.commit()

    # Broadcast ke dashboard
    await _broadcast({
        "type": "log",
        "campaign_id": campaign_id,
        "account_id": account_id,
        "group_id": group_id,
        "status": status,
        "error": error_message,
        "timestamp": datetime.utcnow().isoformat()
    })


async def _account_worker(
    campaign_id: int,
    account_id: int,
    group_db_ids: list,
    group_tg_ids: list,
    text: str,
    media_path: str,
    delay_min: int,
    delay_max: int,
    typing_sim: bool = True
):
    """Worker asyncio per akun: kirim pesan ke semua grup yang diassign."""
    logger.info(f"Campaign {campaign_id} | Account {account_id} | {len(group_db_ids)} grup")
    await _broadcast({"type": "worker_start", "campaign_id": campaign_id, "account_id": account_id})

    for db_id, tg_id in zip(group_db_ids, group_tg_ids):
        # Cek stop / pause
        if _stopped.get(campaign_id):
            break
        while _paused.get(campaign_id):
            await asyncio.sleep(2)
            if _stopped.get(campaign_id):
                break

        # Cek daily limit akun
        async with AsyncSessionLocal() as db:
            acc = await db.get(Account, account_id)
            if acc and acc.messages_sent_today >= acc.daily_limit:
                await _log_send(campaign_id, account_id, db_id, "skipped",
                                 "Daily limit tercapai")
                await _broadcast({"type": "log", "campaign_id": campaign_id,
                                   "account_id": account_id, "group_id": db_id,
                                   "status": "skipped", "error": "Daily limit",
                                   "timestamp": datetime.utcnow().isoformat()})
                break

        # Kirim pesan
        result = await account_manager.send_message_to_group(
            account_id=account_id,
            group_id=tg_id,
            text=text,
            media_path=media_path,
            typing_simulation=typing_sim
        )

        if result["success"]:
            await _log_send(campaign_id, account_id, db_id, "success",
                             message_id=result.get("message_id"))
        else:
            error = result.get("error", "Unknown")
            status = "rate_limited" if "FloodWait" in error else "failed"
            await _log_send(campaign_id, account_id, db_id, status, error)

            # Auto-pause akun jika FloodWait
            if "FloodWait" in error:
                flood_secs = result.get("flood_seconds", 60)
                logger.warning(f"Account {account_id} FloodWait {flood_secs}s — menunggu...")
                await _broadcast({"type": "account_status", "account_id": account_id,
                                   "status": "rate_limited", "flood_seconds": flood_secs})
                await asyncio.sleep(min(flood_secs, 300))  # max 5 menit tunggu
                # Update status akun
                async with AsyncSessionLocal() as db:
                    await db.execute(
                        update(Account).where(Account.id == account_id)
                        .values(status="rate_limited")
                    )
                    await db.commit()
                # Coba lagi sekali
                result2 = await account_manager.send_message_to_group(
                    account_id, tg_id, text, media_path, False
                )
                if result2["success"]:
                    await _log_send(campaign_id, account_id, db_id, "success",
                                     message_id=result2.get("message_id"))

        # Delay antar grup
        if not _stopped.get(campaign_id):
            await human_delay(delay_min, delay_max)

    await _broadcast({"type": "worker_done", "campaign_id": campaign_id, "account_id": account_id})


async def run_campaign(campaign_id: int):
    """Main function untuk menjalankan campaign."""
    _stopped[campaign_id] = False
    _paused[campaign_id] = False

    async with AsyncSessionLocal() as db:
        campaign = await db.get(Campaign, campaign_id, options=[selectinload(Campaign.template)])
        if not campaign:
            logger.error(f"Campaign {campaign_id} tidak ditemukan")
            return

        # Update status jadi running
        campaign.status = "running"
        await db.commit()

        template = campaign.template
        target_group_ids = json.loads(campaign.target_groups or "[]")
        variable_data = json.loads(campaign.variable_data or "{}")
        delay_min = campaign.delay_min
        delay_max = campaign.delay_max
        prevent_duplicate = campaign.prevent_duplicate
        parallel_mode = campaign.parallel_mode

        # Render text
        text = render_template(template.content, variable_data)
        media_path = template.media_path

        # Load group data
        group_records = []
        if target_group_ids:
            # Pastikan formatnya string karena Telegram ID sering ada tanda minus (-)
            str_gids = [str(gid) for gid in target_group_ids]
            
            # Cari grup spesifik berdasarkan kolom Telegram group_id
            stmt = select(Group).where(Group.group_id.in_(str_gids))
            res = await db.execute(stmt)
            found_groups = res.scalars().all()
            
            for grp in found_groups:
                if grp.is_active:
                    group_records.append(grp)
                    
        # Pengaman: Kalau ternyata grupnya gak ketemu / kosong
        if not group_records:
            logger.error(f"Campaign {campaign_id}: Tidak ada grup valid yang ditemukan.")
            campaign.status = "stopped"
            await db.commit()
            await _broadcast({
                "type": "campaign_error", 
                "campaign_id": campaign_id, 
                "error": "Gagal mulai: Grup target kosong, tidak valid, atau nonaktif"
            })
            return

        # Load akun aktif yang terhubung
        connected = account_manager.get_all_connected()
        if not connected:
            campaign.status = "stopped"
            await db.commit()
            await _broadcast({"type": "campaign_error", "campaign_id": campaign_id,
                               "error": "Tidak ada akun terhubung"})
            return

        active_account_ids = rotate_accounts(list(connected.keys()))

        # Load akun dari DB untuk cek daily limit
        active_accounts = []
        for acc_id in active_account_ids:
            acc = await db.get(Account, acc_id)
            if acc and acc.status == "active" and acc.messages_sent_today < acc.daily_limit:
                active_accounts.append(acc_id)

        if not active_accounts:
            campaign.status = "stopped"
            await db.commit()
            await _broadcast({"type": "campaign_error", "campaign_id": campaign_id,
                               "error": "Semua akun sudah mencapai daily limit"})
            return

        # Ambil DB IDs dan TG IDs untuk distribusi
        group_db_ids = [g.id for g in group_records]
        group_tg_ids = [g.group_id for g in group_records]

    # Distribusi grup ke akun
    optimal = get_optimal_groups_per_account(len(group_db_ids), len(active_accounts))
    # Buat mapping DB_id -> TG_id
    db_to_tg = {g.id: g.group_id for g in group_records}

    assignment_db = distribute_groups(
        active_accounts, group_db_ids, optimal, prevent_duplicate
    )

    await _broadcast({
        "type": "campaign_start",
        "campaign_id": campaign_id,
        "total_groups": len(group_db_ids),
        "total_accounts": len(active_accounts),
        "assignment": {str(k): v for k, v in assignment_db.items()}
    })

    # Spawn workers
    tasks = set()
    _running_tasks[campaign_id] = tasks

    async def run_worker(acc_id, db_ids):
        tg_ids = [db_to_tg[d] for d in db_ids if d in db_to_tg]
        await _account_worker(
            campaign_id, acc_id, db_ids, tg_ids,
            text, media_path, delay_min, delay_max
        )

    if parallel_mode:
        # Semua akun jalan bersamaan
        coros = [run_worker(acc_id, db_ids) for acc_id, db_ids in assignment_db.items() if db_ids]
        worker_tasks = [asyncio.create_task(c) for c in coros]
        for t in worker_tasks:
            tasks.add(t)
        await asyncio.gather(*worker_tasks, return_exceptions=True)
    else:
        # Sequential per akun
        for acc_id, db_ids in assignment_db.items():
            if _stopped.get(campaign_id):
                break
            if db_ids:
                t = asyncio.create_task(run_worker(acc_id, db_ids))
                tasks.add(t)
                await t

    # Campaign selesai
    async with AsyncSessionLocal() as db:
        campaign = await db.get(Campaign, campaign_id)
        if campaign and not _stopped.get(campaign_id):
            campaign.status = "completed"
            campaign.completed_at = datetime.utcnow()
        elif campaign and _stopped.get(campaign_id):
            campaign.status = "stopped"
        await db.commit()

    _running_tasks.pop(campaign_id, None)
    _stopped.pop(campaign_id, None)
    _paused.pop(campaign_id, None)

    await _broadcast({"type": "campaign_done", "campaign_id": campaign_id})


def stop_campaign(campaign_id: int):
    """Hentikan campaign."""
    _stopped[campaign_id] = True
    tasks = _running_tasks.get(campaign_id, set())
    for t in tasks:
        t.cancel()


def pause_campaign(campaign_id: int):
    """Pause campaign."""
    _paused[campaign_id] = True


def resume_campaign(campaign_id: int):
    """Resume campaign yang sedang pause."""
    _paused[campaign_id] = False


def get_campaign_status(campaign_id: int) -> dict:
    return {
        "running": campaign_id in _running_tasks,
        "paused": _paused.get(campaign_id, False),
        "stopped": _stopped.get(campaign_id, False),
        "worker_count": len(_running_tasks.get(campaign_id, set()))
    }
