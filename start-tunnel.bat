@echo off
title TG Auto System - Cloudflare Tunnel
color 0B

echo.
echo  [TUNNEL] Memulai Cloudflare Tunnel...
echo  Dashboard akan bisa diakses dari internet!
echo.

cd /d "%~dp0"

if not exist "cloudflared.exe" (
    echo [ERROR] cloudflared.exe tidak ditemukan!
    echo Jalankan dulu: setup-tunnel.bat
    pause
    exit /b 1
)

if not exist "cloudflared-config.yml" (
    echo [ERROR] Config tunnel tidak ditemukan!
    echo Jalankan dulu: setup-tunnel.bat
    pause
    exit /b 1
)

echo [OK] URL akses publik akan muncul di bawah ini...
echo [OK] Cari baris: "https://tg-auto...trycloudflare.com" atau domain kamu
echo.

cloudflared.exe tunnel --config cloudflared-config.yml run
