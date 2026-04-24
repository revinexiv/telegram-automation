@echo off
title TG Auto System - Quick Tunnel (Tanpa Setup)
color 0E

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║  QUICK TUNNEL - Tanpa Login/Setup           ║
echo  ║  URL akan berubah setiap restart tunnel     ║
echo  ╚══════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

if not exist "cloudflared.exe" (
    echo [DOWNLOAD] Mengunduh cloudflared...
    powershell -Command "& {Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'}"
)

echo [OK] Memulai quick tunnel ke localhost:8000
echo [OK] SALIN URL yang muncul (format: https://xxxxx.trycloudflare.com)
echo [OK] Gunakan URL itu untuk akses dari HP/PC lain
echo.
echo  !! PASTIKAN start-app.bat sudah dijalankan dulu !!
echo.

cloudflared.exe tunnel --url http://localhost:8000
