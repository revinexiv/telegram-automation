@echo off
title TG Auto System - Smart Start
color 0A

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║   TG Auto System - Smart Quick Start   ║
echo  ╚══════════════════════════════════════════╝
echo.
echo  Mode ini menggunakan Quick Tunnel Cloudflare.
echo  URL public akan ditampilkan dan bisa dibuka dari HP.
echo.

cd /d "%~dp0"

:: ── Start app di background ──────────────────────────────────────────────────
echo [1/2] Memulai server...
start "TG-Auto-App" /min venv\Scripts\pythonw.exe run.py
timeout /t 3 /nobreak >nul
echo [OK] Server berjalan di http://localhost:8000

echo.
echo [2/2] Memulai Cloudflare Tunnel...
echo.
echo  ══════════════════════════════════════════════════
echo  Tunggu beberapa detik... URL publik akan muncul:
echo  (Cari baris: https://xxxx.trycloudflare.com)
echo  ══════════════════════════════════════════════════
echo.

cloudflared.exe tunnel --url http://localhost:8000 2>&1

pause
