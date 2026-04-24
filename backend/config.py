import os
from dotenv import load_dotenv

load_dotenv()

TELEGRAM_API_ID = int(os.getenv("TELEGRAM_API_ID", "0"))
TELEGRAM_API_HASH = os.getenv("TELEGRAM_API_HASH", "")

SECRET_KEY = os.getenv("SECRET_KEY", "")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./data/telegram_auto.db")

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

SESSIONS_DIR = "./sessions"
MEDIA_DIR = "./media"
os.makedirs(SESSIONS_DIR, exist_ok=True)
os.makedirs(MEDIA_DIR, exist_ok=True)
os.makedirs("./data", exist_ok=True)
