@echo off
title TG Auto System - Starting...
color 0A

echo.
echo  ╔══════════════════════════════════════╗
echo  ║    TG Auto System - Starting App     ║
echo  ╚══════════════════════════════════════╝
echo.

:: Pindah ke folder project
cd /d "%~dp0"

:: Cek venv ada
if not exist "venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment tidak ditemukan!
    echo Jalankan dulu: python -m venv venv
    echo Lalu: venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

:: Cek .env ada
if not exist ".env" (
    echo [ERROR] File .env tidak ditemukan!
    echo Copy dulu: copy .env.example .env
    echo Lalu isi TELEGRAM_API_ID dan TELEGRAM_API_HASH
    pause
    exit /b 1
)

echo [OK] Memulai server di http://localhost:8000
echo [OK] Tekan Ctrl+C untuk stop
echo.

venv\Scripts\python.exe run.py
