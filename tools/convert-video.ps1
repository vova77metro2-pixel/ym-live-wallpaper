# Конвертация видео для живых обоев.
#
# Chromium (Electron) не декодирует 4K/60fps в реальном времени через
# протокол мода — видео не грузится с ошибкой PIPELINE_ERROR_READ.
# Этот скрипт пережимает выбранный файл в 1080p H.264 без звука.
#
# Использование:
#   powershell -File convert-video.ps1 -Input "D:\video.mp4" -Output "$env:APPDATA\ym-live-wallpaper\wallpapers\my.mp4"
#
# Требует ffmpeg в PATH или в папке установщика.

param(
    [Parameter(Mandatory=$true)][string]$Input,
    [Parameter(Mandatory=$true)][string]$Output
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# ---------- Поиск ffmpeg ----------
$ffmpeg = $null
$candidates = @(
    (Join-Path $root 'ffmpeg.exe'),
    (Join-Path $root 'ffmpeg\ffmpeg.exe')
)
foreach ($c in $candidates) {
    if (Test-Path $c) { $ffmpeg = $c; break }
}
if (-not $ffmpeg) {
    $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($cmd) { $ffmpeg = $cmd.Source }
}
if (-not $ffmpeg) {
    Write-Host ""
    Write-Host "!! ffmpeg не найден." -ForegroundColor Yellow
    Write-Host "   Видео не будет пережато. Если оно 4K или весит больше 50 МБ," -ForegroundColor Yellow
    Write-Host "   мод может не суметь его воспроизвести." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   Простое решение: положите видео 1080p H.264 (до 50 МБ)." -ForegroundColor Yellow
    exit 2
}

if (-not (Test-Path -LiteralPath $Input)) {
    Write-Host "!! Файл не найден: $Input" -ForegroundColor Red
    exit 1
}

# ---------- Проверяем, надо ли пережимать ----------
Write-Host "  Анализирую видео..."
$probe = & $ffmpeg -i "$Input" 2>&1 | Out-String

$needConvert = $false
$reason = ''

# Разрешение 4K и выше
if ($probe -match 'Video:.*?(\d{3,4})x(\d{3,4})') {
    $w = [int]$Matches[1]; $h = [int]$Matches[2]
    if ($w -ge 2560 -or $h -ge 1440) {
        $needConvert = $true
        $reason = "разрешение ${w}x${h}"
    }
}
# Высокий битрейт
if ($probe -match 'Video:.*?(\d{4,}) kb/s') {
    $br = [int]$Matches[1]
    if ($br -gt 8000) {
        $needConvert = $true
        $reason = "битрейт $br kb/s"
    }
}
# HEVC/H.265 — Electron его не декодирует
if ($probe -match 'Video: hevc|Video: h265') {
    $needConvert = $true
    $reason = 'кодек HEVC/H.265'
}
# Большой размер файла
$sizeMb = (Get-Item -LiteralPath $Input).Length / 1MB
if ($sizeMb -gt 60) {
    $needConvert = $true
    $reason = if ($reason) { "$reason, ${sizeMb} МБ" } else { "${sizeMb} МБ" }
}

if ($needConvert) {
    Write-Host "  Пережимаю в 1080p ($reason)..." -ForegroundColor Cyan
    $dir = Split-Path -Parent $Output
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

    & $ffmpeg -y -i "$Input" `
        -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" `
        -c:v libx264 -preset medium -crf 23 -an -movflags +faststart `
        "$Output" 2>&1 | Out-Null

    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Output)) {
        Write-Host "!! Не удалось пережать видео." -ForegroundColor Red
        exit 1
    }
    $newMb = (Get-Item -LiteralPath $Output).Length / 1MB
    Write-Host "  Готово: $([math]::Round($sizeMb,1)) МБ -> $([math]::Round($newMb,1)) МБ" -ForegroundColor Green
} else {
    Write-Host "  Пережимать не нужно (1080p H.264, ${sizeMb} МБ) — копирую как есть" -ForegroundColor Green
    $dir = Split-Path -Parent $Output
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Copy-Item -LiteralPath $Input -Destination $Output -Force
}

exit 0
