# install-autostart.ps1
# Jalankan sebagai Administrator!
# Tambahkan TG Auto System ke Windows Startup (Task Scheduler)
# sehingga otomatis jalan saat PC nyala

param(
    [switch]$Remove   # Gunakan -Remove untuk uninstall
)

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonExe  = Join-Path $ProjectDir "venv\Scripts\pythonw.exe"   # pythonw = tanpa console window
$RunScript  = Join-Path $ProjectDir "run.py"
$CloudflaredExe = Join-Path $ProjectDir "cloudflared.exe"
$TunnelConfig   = Join-Path $ProjectDir "cloudflared-config.yml"
$TaskNameApp    = "TGAutoSystem-App"
$TaskNameTunnel = "TGAutoSystem-Tunnel"

# ── REMOVE mode ──────────────────────────────────────────────────────────────
if ($Remove) {
    Write-Host "`n🗑  Menghapus autostart tasks..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskNameApp    -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskNameTunnel -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "✅ Autostart dihapus." -ForegroundColor Green
    exit 0
}

# ── Cek Admin ─────────────────────────────────────────────────────────────────
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "`n❌ Harus dijalankan sebagai Administrator!" -ForegroundColor Red
    Write-Host "   Klik kanan PowerShell → 'Run as administrator'" -ForegroundColor Yellow
    Read-Host "Tekan Enter untuk keluar"
    exit 1
}

Write-Host "`n╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  TG Auto System - Install Autostart      ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝`n" -ForegroundColor Cyan

# ── Cek file ada ─────────────────────────────────────────────────────────────
if (-not (Test-Path $PythonExe)) {
    Write-Host "❌ pythonw.exe tidak ditemukan. Pastikan venv sudah dibuat." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $RunScript)) {
    Write-Host "❌ run.py tidak ditemukan." -ForegroundColor Red
    exit 1
}

# ── Task 1: Python App ────────────────────────────────────────────────────────
Write-Host "📌 Mendaftarkan TG Auto App ke Task Scheduler..." -ForegroundColor Cyan

$AppAction = New-ScheduledTaskAction `
    -Execute $PythonExe `
    -Argument $RunScript `
    -WorkingDirectory $ProjectDir

$AppTrigger = New-ScheduledTaskTrigger -AtLogOn   # Jalan saat login Windows

$AppSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)    # Tidak ada batas waktu

$AppPrincipal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskNameApp `
    -Action $AppAction `
    -Trigger $AppTrigger `
    -Settings $AppSettings `
    -Principal $AppPrincipal `
    -Description "TG Auto System - Python FastAPI Server" `
    -Force | Out-Null

Write-Host "   ✅ App task registered: $TaskNameApp" -ForegroundColor Green

# ── Task 2: Cloudflare Tunnel (jika ada) ─────────────────────────────────────
if ((Test-Path $CloudflaredExe) -and (Test-Path $TunnelConfig)) {
    Write-Host "`n📌 Mendaftarkan Cloudflare Tunnel ke Task Scheduler..." -ForegroundColor Cyan

    $TunnelAction = New-ScheduledTaskAction `
        -Execute $CloudflaredExe `
        -Argument "--config `"$TunnelConfig`" tunnel run" `
        -WorkingDirectory $ProjectDir

    # Delay 10 detik setelah login supaya app sudah start
    $TunnelTrigger = New-ScheduledTaskTrigger -AtLogOn
    $TunnelTrigger.Delay = "PT10S"

    $TunnelSettings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -RestartCount 10 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero)

    Register-ScheduledTask `
        -TaskName $TaskNameTunnel `
        -Action $TunnelAction `
        -Trigger $TunnelTrigger `
        -Settings $TunnelSettings `
        -Principal $AppPrincipal `
        -Description "TG Auto System - Cloudflare Tunnel" `
        -Force | Out-Null

    Write-Host "   ✅ Tunnel task registered: $TaskNameTunnel" -ForegroundColor Green
} else {
    Write-Host "`n⚠️  Cloudflare tunnel tidak ditemukan — hanya app yang di-autostart." -ForegroundColor Yellow
    Write-Host "   Jalankan setup-tunnel.bat terlebih dahulu untuk setup tunnel." -ForegroundColor Yellow
}

# ── Mulai sekarang tanpa harus restart ───────────────────────────────────────
Write-Host "`n🚀 Menjalankan task sekarang..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskNameApp
Start-Sleep -Seconds 3

if ((Test-Path $CloudflaredExe) -and (Test-Path $TunnelConfig)) {
    Start-ScheduledTask -TaskName $TaskNameTunnel
}

Write-Host "`n╔══════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  ✅ Autostart berhasil dipasang!                 ║" -ForegroundColor Green
Write-Host "║                                                  ║" -ForegroundColor Green
Write-Host "║  Sistem akan otomatis jalan setiap PC nyala.    ║" -ForegroundColor Green
Write-Host "║  Dashboard: http://localhost:8000               ║" -ForegroundColor Green
Write-Host "║                                                  ║" -ForegroundColor Green
Write-Host "║  Untuk uninstall: .\install-autostart.ps1 -Remove ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════╝`n" -ForegroundColor Green

Read-Host "Tekan Enter untuk selesai"
