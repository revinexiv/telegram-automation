@echo off
title TG Auto System - Cloudflare Tunnel Setup
color 0B

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║  Cloudflare Tunnel Setup - TG Auto Sys  ║
echo  ╚══════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: ── Step 1: Download cloudflared ────────────────────────────────────────────
echo [1/4] Mengecek cloudflared...

if exist "cloudflared.exe" (
    echo [OK] cloudflared sudah ada.
    goto :login
)

echo [DOWNLOAD] Mengunduh cloudflared untuk Windows...
powershell -Command "& {Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'}"

if not exist "cloudflared.exe" (
    echo [ERROR] Download gagal. Coba download manual:
    echo https://github.com/cloudflare/cloudflared/releases/latest
    echo Download: cloudflared-windows-amd64.exe
    echo Simpan di folder ini sebagai cloudflared.exe
    pause
    exit /b 1
)
echo [OK] cloudflared berhasil diunduh.

:: ── Step 2: Login ke Cloudflare ─────────────────────────────────────────────
:login
echo.
echo [2/4] Login ke Cloudflare...
echo.
echo  Akan membuka browser untuk login ke akun Cloudflare kamu.
echo  Kalau belum punya akun, daftar gratis di: https://dash.cloudflare.com/sign-up
echo.
pause

cloudflared.exe tunnel login

:: ── Step 3: Buat Tunnel ─────────────────────────────────────────────────────
echo.
echo [3/4] Membuat tunnel "tg-auto-system"...

cloudflared.exe tunnel create tg-auto-system

:: Buat config file
echo.
echo [3/4] Membuat config file tunnel...

:: Cari tunnel ID dari output (simpan ke file sementara)
cloudflared.exe tunnel list > tunnel_list.tmp
echo.
echo  Daftar tunnel kamu:
type tunnel_list.tmp
del tunnel_list.tmp

echo.
echo  ────────────────────────────────────────────────────────
echo  PENTING: Catat Tunnel ID dari daftar di atas!
echo  Tunnel ID berformat: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
echo  ────────────────────────────────────────────────────────
echo.
set /p TUNNEL_ID="Masukkan Tunnel ID: "

:: Tulis config.yml
(
echo tunnel: %TUNNEL_ID%
echo credentials-file: %USERPROFILE%\.cloudflared\%TUNNEL_ID%.json
echo.
echo ingress:
echo   - service: http://localhost:8000
) > cloudflared-config.yml

:: ── Step 4: Dapatkan URL ─────────────────────────────────────────────────────
echo.
echo [4/4] Setup selesai!
echo.
echo  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo  URL akses dashboard dari mana saja:
cloudflared.exe tunnel route dns tg-auto-system tg-auto
echo.
echo  Atau gunakan URL otomatis yang muncul saat tunnel dijalankan
echo  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo  Sekarang jalankan: start-tunnel.bat
echo  (Jalankan SETELAH start-app.bat)
echo.
pause
