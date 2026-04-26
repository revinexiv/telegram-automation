import logging
import os
import shutil
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from backend.database import init_db
from backend.config import ADMIN_USERNAME, ADMIN_PASSWORD
from backend.routers import accounts, groups, templates, campaigns, logs, ws
from backend.services import account_manager, campaign_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Inisialisasi database...")
    await init_db()

    # Hubungkan broadcast ke account_manager dan campaign_engine
    from backend.routers.ws import broadcast
    account_manager.set_broadcast(broadcast)
    campaign_engine.set_broadcast(broadcast)

    logger.info("System siap! Dashboard: http://localhost:8000")
    yield

    # Shutdown
    logger.info("Menutup semua koneksi Telegram...")
    await account_manager.disconnect_all()


app = FastAPI(
    title="Telegram Auto System",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Auth Middleware ──────────────────────────────────────────────────────────

# Simple basic auth untuk semua /api/* kecuali docs
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Skip auth untuk static files dan WebSocket
    path = request.url.path
    if (path.startswith("/api/docs") or
        path.startswith("/openapi") or
        path == "/api/auth/login" or
        path.startswith("/ws/") or
        not path.startswith("/api/")):
        return await call_next(request)

    # Cek Authorization header
    auth = request.headers.get("X-Admin-Token", "")
    expected = f"{ADMIN_USERNAME}:{ADMIN_PASSWORD}"
    if auth != expected:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    return await call_next(request)


# ─── Auth Route ───────────────────────────────────────────────────────────────

@app.post("/api/auth/login")
async def login(body: dict):
    username = body.get("username", "")
    password = body.get("password", "")
    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        return {"token": f"{ADMIN_USERNAME}:{ADMIN_PASSWORD}", "message": "Login berhasil"}
    raise HTTPException(401, "Username atau password salah")

# ─── Upload Route ─────────────────────────────────────────────────────────────
import uuid # Tambahkan ini untuk generate nama acak
import os

# Pastikan folder uploads ada saat aplikasi berjalan
os.makedirs("./uploads", exist_ok=True)

@app.post("/api/upload")
async def upload_media(file: UploadFile = File(...)):
    try:
        # Ambil ekstensi asli filenya (misal: .jpg, .png, .mp4)
        ext = os.path.splitext(file.filename)[1]
        
        # Bikin nama file baru yang 100% unik dan tanpa spasi
        safe_filename = f"{uuid.uuid4().hex}{ext}"
        
        # Tentukan lokasi penyimpanan file
        file_location = f"./uploads/{safe_filename}"
        
        # Simpan file ke server Railway
        with open(file_location, "wb+") as file_object:
            shutil.copyfileobj(file.file, file_object)
            
        # Kembalikan link path agar bisa dibaca sama Frontend
        return {"media_path": f"/uploads/{safe_filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal upload file: {str(e)}")


# ─── Routers ─────────────────────────────────────────────────────────────────

app.include_router(accounts.router)
app.include_router(groups.router)
app.include_router(templates.router)
app.include_router(campaigns.router)
app.include_router(logs.router)
app.include_router(ws.router)

# ─── Static Files & SPA ──────────────────────────────────────────────────────

import os
app.mount("/uploads", StaticFiles(directory="./uploads"), name="uploads")

if os.path.exists("./frontend"):
    app.mount("/assets", StaticFiles(directory="./frontend"), name="static")
    
    @app.get("/")
    async def serve_landing():
        return FileResponse("./frontend/index.html")
    
    @app.get("/aksesadmin")
    async def serve_admin_dashboard():
        return FileResponse("./frontend/aksesadmin/index.html")


if __name__ == "__main__":
    import uvicorn
    from backend.config import HOST, PORT
    uvicorn.run("backend.main:app", host=HOST, port=PORT, reload=True)
