"""
Account Manager — Mengelola pool Telethon client untuk semua akun.
Setiap akun punya satu TelegramClient instance yang share 1 API ID/HASH.
"""
import asyncio
import logging
from typing import Dict, Optional, Tuple
from datetime import datetime

from telethon import TelegramClient, errors
from telethon.sessions import StringSession

from backend.config import TELEGRAM_API_ID, TELEGRAM_API_HASH
from backend.utils.encryption import encrypt_session, decrypt_session

logger = logging.getLogger(__name__)

# Pool: account_id -> TelegramClient
_clients: Dict[int, TelegramClient] = {}

# Temporary storage untuk login flow: phone -> (client, phone_code_hash)
_pending_logins: Dict[str, Tuple[TelegramClient, str]] = {}

# WebSocket broadcast callback (diset oleh ws router)
_broadcast_fn = None


def set_broadcast(fn):
    global _broadcast_fn
    _broadcast_fn = fn


async def _broadcast(msg: dict):
    if _broadcast_fn:
        await _broadcast_fn(msg)


# ─── Connection Pool ──────────────────────────────────────────────────────────

async def connect_account(account_id: int, session_string_encrypted: str) -> bool:
    """Sambungkan akun menggunakan session string terenkripsi."""
    try:
        session_str = decrypt_session(session_string_encrypted)
        client = TelegramClient(
            StringSession(session_str),
            TELEGRAM_API_ID,
            TELEGRAM_API_HASH
        )
        await client.connect()
        if not await client.is_user_authorized():
            logger.warning(f"Account {account_id}: session tidak valid")
            return False
        _clients[account_id] = client
        logger.info(f"Account {account_id} terhubung")
        await _broadcast({"type": "account_status", "account_id": account_id, "status": "active", "online": True})
        return True
    except Exception as e:
        logger.error(f"Account {account_id} connect error: {e}")
        await _broadcast({"type": "account_status", "account_id": account_id, "status": "error", "error": str(e)})
        return False


async def disconnect_account(account_id: int):
    """Putus koneksi akun."""
    client = _clients.pop(account_id, None)
    if client:
        try:
            await client.disconnect()
        except Exception:
            pass
    await _broadcast({"type": "account_status", "account_id": account_id, "status": "inactive", "online": False})


async def disconnect_all():
    """Putus semua koneksi saat shutdown."""
    for acc_id in list(_clients.keys()):
        await disconnect_account(acc_id)


def get_client(account_id: int) -> Optional[TelegramClient]:
    return _clients.get(account_id)


def is_connected(account_id: int) -> bool:
    client = _clients.get(account_id)
    return client is not None and client.is_connected()


def get_all_connected() -> Dict[int, TelegramClient]:
    return {k: v for k, v in _clients.items() if v.is_connected()}


# ─── Login Flow (Phone + OTP) ─────────────────────────────────────────────────

async def request_code(phone: str) -> dict:
    """
    Kirim kode OTP ke nomor telefon.
    Returns: {"success": bool, "phone_code_hash": str, "error": str}
    """
    try:
        # Buat client sementara tanpa session
        client = TelegramClient(
            StringSession(),
            TELEGRAM_API_ID,
            TELEGRAM_API_HASH
        )
        await client.connect()
        result = await client.send_code_request(phone)
        _pending_logins[phone] = (client, result.phone_code_hash)
        logger.info(f"OTP dikirim ke {phone}")
        return {"success": True, "phone_code_hash": result.phone_code_hash}
    except errors.PhoneNumberInvalidError:
        return {"success": False, "error": "Nomor telepon tidak valid"}
    except errors.FloodWaitError as e:
        return {"success": False, "error": f"FloodWait: coba lagi dalam {e.seconds} detik"}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def verify_code(phone: str, code: str, password: str = None) -> dict:
    """
    Verifikasi OTP dan simpan session string.
    Returns: {"success": bool, "session_string": str, "error": str}
    """
    pending = _pending_logins.get(phone)
    if not pending:
        return {"success": False, "error": "Tidak ada permintaan OTP aktif untuk nomor ini. Request kode terlebih dahulu."}

    client, phone_code_hash = pending

    try:
        await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
        session_string = client.session.save()
        encrypted = encrypt_session(session_string)
        _pending_logins.pop(phone, None)
        # Simpan client ke pool (akan diassign account_id nanti)
        logger.info(f"Login berhasil untuk {phone}")
        await client.disconnect()
        return {"success": True, "session_string": encrypted}
    except errors.SessionPasswordNeededError:
        # 2FA required
        if not password:
            return {"success": False, "error": "2FA_REQUIRED", "need_password": True}
        try:
            await client.sign_in(password=password)
            session_string = client.session.save()
            encrypted = encrypt_session(session_string)
            _pending_logins.pop(phone, None)
            await client.disconnect()
            return {"success": True, "session_string": encrypted}
        except Exception as e:
            return {"success": False, "error": f"2FA gagal: {str(e)}"}
    except errors.PhoneCodeInvalidError:
        return {"success": False, "error": "Kode OTP tidak valid"}
    except errors.PhoneCodeExpiredError:
        return {"success": False, "error": "Kode OTP sudah kadaluarsa"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─── Group Detection ──────────────────────────────────────────────────────────

async def detect_joined_groups(account_id: int) -> list:
    """Ambil daftar grup/channel yang sudah di-join akun ini."""
    client = get_client(account_id)
    if not client:
        return []

    groups = []
    try:
        async for dialog in client.iter_dialogs():
            if dialog.is_group or dialog.is_channel:
                entity = dialog.entity
                groups.append({
                    "group_id": str(entity.id),
                    "username": getattr(entity, "username", None),
                    "title": dialog.name,
                    "member_count": getattr(entity, "participants_count", 0) or 0,
                })
    except Exception as e:
        logger.error(f"detect_joined_groups account {account_id}: {e}")

    return groups


# ─── Send Message ─────────────────────────────────────────────────────────────

async def send_message_to_group(
    account_id: int,
    group_id: str,
    text: str,
    media_path: str = None,
    typing_simulation: bool = True
) -> dict:
    """
    Kirim pesan ke grup.
    Returns: {"success": bool, "message_id": int, "error": str}
    """
    client = get_client(account_id)
    if not client:
        return {"success": False, "error": "Akun tidak terhubung"}

    try:
        # Resolve entity
        try:
            entity = await client.get_entity(int(group_id))
        except ValueError:
            entity = await client.get_entity(group_id)

        # Typing simulation
        if typing_simulation:
            from backend.services.anti_detection import typing_simulation as type_sim
            await type_sim(client, entity)

        # Kirim pesan
        if media_path and media_path.strip():
            import os
            if os.path.exists(media_path):
                msg = await client.send_file(entity, media_path, caption=text)
            else:
                msg = await client.send_message(entity, text)
        else:
            msg = await client.send_message(entity, text)

        return {"success": True, "message_id": msg.id}

    except errors.FloodWaitError as e:
        return {"success": False, "error": f"FloodWait:{e.seconds}", "flood_seconds": e.seconds}
    except errors.ChatWriteForbiddenError:
        return {"success": False, "error": "Tidak punya izin menulis di grup ini"}
    except errors.UserBannedInChannelError:
        return {"success": False, "error": "Akun diblokir dari channel ini"}
    except errors.PeerFloodError:
        return {"success": False, "error": "PeerFlood: terlalu banyak pesan ke pengguna baru"}
    except Exception as e:
        return {"success": False, "error": str(e)}
