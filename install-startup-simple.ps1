# install-startup-simple.ps1
# Install TG Auto System ke Windows Startup (tanpa perlu akun Cloudflare)
# Jalankan sebagai Administrator!

param([switch]$Remove)

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartAllBat = Join-Path $ProjectDir "start-all.bat"
$ShortcutPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\TGAutoSystem.bat"

if ($Remove) {
    if (Test-Path $ShortcutPath) {
        Remove-Item $ShortcutPath -Force
        Write-Host "✅ Autostart dihapus." -ForegroundColor Green
    } else {
        Write-Host "⚠️  Tidak ada autostart yang terpasang." -ForegroundColor Yellow
    }
    exit 0
}

Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  TG Auto System - Install Startup       ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Buat shortcut di folder Startup Windows
$content = "@echo off`r`ncd /d `"$ProjectDir`"`r`nstart-all.bat"
Set-Content -Path $ShortcutPath -Value $content -Encoding ASCII

if (Test-Path $ShortcutPath) {
    Write-Host "✅ Berhasil! Sistem akan auto-start saat Windows login." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Lokasi: $ShortcutPath" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Untuk uninstall:" -ForegroundColor Yellow
    Write-Host "  .\install-startup-simple.ps1 -Remove" -ForegroundColor Yellow
} else {
    Write-Host "❌ Gagal install. Coba jalankan sebagai Administrator." -ForegroundColor Red
}

Write-Host ""

# Langsung jalankan sekarang
$answer = Read-Host "Jalankan sekarang? (Y/N)"
if ($answer -eq 'Y' -or $answer -eq 'y') {
    Start-Process "cmd.exe" -ArgumentList "/c `"$StartAllBat`""
    Write-Host "🚀 Sistem dijalankan!" -ForegroundColor Green
}

Write-Host ""
Read-Host "Tekan Enter untuk selesai"
