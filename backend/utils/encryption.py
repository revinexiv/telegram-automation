from cryptography.fernet import Fernet
from backend.config import SECRET_KEY
import base64
import hashlib


def _get_fernet() -> Fernet:
    """Buat Fernet cipher dari SECRET_KEY."""
    if not SECRET_KEY:
        raise ValueError("SECRET_KEY tidak ditemukan di .env")
    # Pastikan key 32 bytes untuk Fernet (base64-url-encoded 32 bytes)
    key_bytes = hashlib.sha256(SECRET_KEY.encode()).digest()
    fernet_key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(fernet_key)


def encrypt_session(session_string: str) -> str:
    """Enkripsi session string Telethon."""
    f = _get_fernet()
    return f.encrypt(session_string.encode()).decode()


def decrypt_session(encrypted: str) -> str:
    """Dekripsi session string Telethon."""
    f = _get_fernet()
    return f.decrypt(encrypted.encode()).decode()
