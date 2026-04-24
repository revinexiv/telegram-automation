from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from backend.database import get_db, Account
from backend.services import account_manager

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class AccountCreate(BaseModel):
    phone: str
    notes: Optional[str] = None
    daily_limit: Optional[int] = 50


class AccountUpdate(BaseModel):
    notes: Optional[str] = None
    daily_limit: Optional[int] = None
    status: Optional[str] = None


class RequestCodeSchema(BaseModel):
    phone: str


class VerifyCodeSchema(BaseModel):
    phone: str
    code: str
    password: Optional[str] = None


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.get("/")
async def list_accounts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Account).order_by(Account.created_at.desc()))
    accounts = result.scalars().all()
    return [
        {
            "id": a.id,
            "phone": a.phone,
            "status": a.status,
            "is_online": account_manager.is_connected(a.id),
            "messages_sent_today": a.messages_sent_today,
            "daily_limit": a.daily_limit,
            "last_used": a.last_used.isoformat() if a.last_used else None,
            "notes": a.notes,
            "created_at": a.created_at.isoformat(),
            "has_session": bool(a.session_string),
        }
        for a in accounts
    ]


@router.post("/request-code")
async def request_code(body: RequestCodeSchema):
    """Step 1 login: kirim OTP ke nomor telepon."""
    result = await account_manager.request_code(body.phone)
    if not result["success"]:
        raise HTTPException(400, result["error"])
    return {"message": f"Kode OTP dikirim ke {body.phone}"}


@router.post("/verify-code")
async def verify_code(body: VerifyCodeSchema, db: AsyncSession = Depends(get_db)):
    """Step 2 login: verifikasi OTP dan simpan akun."""
    result = await account_manager.verify_code(body.phone, body.code, body.password)

    if not result["success"]:
        if result.get("need_password"):
            raise HTTPException(428, "2FA_REQUIRED: masukkan password 2FA")
        raise HTTPException(400, result["error"])

    # Cek apakah akun sudah ada
    existing = await db.execute(select(Account).where(Account.phone == body.phone))
    acc = existing.scalar_one_or_none()

    if acc:
        acc.session_string = result["session_string"]
        acc.status = "active"
    else:
        acc = Account(
            phone=body.phone,
            session_string=result["session_string"],
            status="active"
        )
        db.add(acc)

    await db.commit()
    await db.refresh(acc)
    return {"message": "Login berhasil", "account_id": acc.id}


@router.put("/{account_id}")
async def update_account(account_id: int, body: AccountUpdate, db: AsyncSession = Depends(get_db)):
    acc = await db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Akun tidak ditemukan")
    if body.notes is not None:
        acc.notes = body.notes
    if body.daily_limit is not None:
        acc.daily_limit = body.daily_limit
    if body.status is not None:
        acc.status = body.status
    await db.commit()
    return {"message": "Akun diperbarui"}


@router.delete("/{account_id}")
async def delete_account(account_id: int, db: AsyncSession = Depends(get_db)):
    await account_manager.disconnect_account(account_id)
    acc = await db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Akun tidak ditemukan")
    await db.delete(acc)
    await db.commit()
    return {"message": "Akun dihapus"}


@router.post("/{account_id}/connect")
async def connect_account(account_id: int, db: AsyncSession = Depends(get_db)):
    acc = await db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Akun tidak ditemukan")
    if not acc.session_string:
        raise HTTPException(400, "Akun belum punya session. Login terlebih dahulu.")
    success = await account_manager.connect_account(account_id, acc.session_string)
    if success:
        acc.status = "active"
        acc.is_online = True
        await db.commit()
        return {"message": "Terhubung"}
    else:
        acc.status = "error"
        await db.commit()
        raise HTTPException(500, "Gagal terhubung. Session mungkin tidak valid.")


@router.post("/{account_id}/disconnect")
async def disconnect_account(account_id: int, db: AsyncSession = Depends(get_db)):
    await account_manager.disconnect_account(account_id)
    acc = await db.get(Account, account_id)
    if acc:
        acc.is_online = False
        acc.status = "inactive"
        await db.commit()
    return {"message": "Berhasil disconnect"}


@router.post("/{account_id}/detect-groups")
async def detect_groups(account_id: int):
    """Auto-detect grup yang sudah di-join akun ini."""
    if not account_manager.is_connected(account_id):
        raise HTTPException(400, "Akun tidak terhubung. Connect terlebih dahulu.")
    groups = await account_manager.detect_joined_groups(account_id)
    return {"groups": groups, "total": len(groups)}


@router.post("/{account_id}/reset-daily")
async def reset_daily_counter(account_id: int, db: AsyncSession = Depends(get_db)):
    """Reset counter harian akun."""
    await db.execute(
        update(Account).where(Account.id == account_id)
        .values(messages_sent_today=0, last_reset=datetime.utcnow())
    )
    await db.commit()
    return {"message": "Counter harian direset"}
