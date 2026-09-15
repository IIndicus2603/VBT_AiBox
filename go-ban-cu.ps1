<#
  go-ban-cu.ps1 — Tim va go ban app CU (ban con kem backend aibox.exe).

  Chay tren TUNG may:  chuot phai file nay -> Run with PowerShell
  Chi XEM, khong xoa gi:   powershell -ExecutionPolicy Bypass -File go-ban-cu.ps1
  Xoa that:                powershell -ExecutionPolicy Bypass -File go-ban-cu.ps1 -Fix

  Ban cu la ban co thu muc "aibox" nam canh app. Ban moi (0.1.2 tro len) KHONG co.
#>
param([switch]$Fix)
$ErrorActionPreference = 'SilentlyContinue'
function H($t) { Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }

H "1. Backend cu dang chay (nguyen nhan gay 409 Conflict Telegram)"
$procs = Get-Process | Where-Object { $_.ProcessName -match '^(aibox|go2rtc)$' }
if ($procs) {
  $procs | ForEach-Object { Write-Host ("  PID {0,-7} {1,-10} {2}" -f $_.Id, $_.ProcessName, $_.Path) -ForegroundColor Yellow }
  if ($Fix) { $procs | Stop-Process -Force; Write-Host "  -> DA TAT" -ForegroundColor Green }
  else { Write-Host "  -> chay lai voi -Fix de tat" }
} else { Write-Host "  khong co" -ForegroundColor Green }

H "2. Ban cai dat app"
$dirs = @("$env:LOCALAPPDATA\Programs", $env:ProgramFiles, ${env:ProgramFiles(x86)}) |
        Where-Object { $_ -and (Test-Path $_) } |
        ForEach-Object { Get-ChildItem $_ -Directory } |
        Where-Object { $_.Name -match 'Vibotics|Smart ?Box|AiBox' }
if ($dirs) {
  foreach ($d in $dirs) {
    $old = Test-Path (Join-Path $d.FullName 'resources\aibox')
    $tag = if ($old) { '  <-- BAN CU (co backend)' } else { '  (ban moi, khong co backend)' }
    $col = if ($old) { 'Yellow' } else { 'Gray' }
    Write-Host ("  {0}{1}" -f $d.FullName, $tag) -ForegroundColor $col
    if ($old) { Write-Host "      -> Go bang: Settings > Apps > 'Vibotics AI Smart Box' > Uninstall" -ForegroundColor Yellow }
  }
} else { Write-Host "  khong tim thay" -ForegroundColor Green }

H "3. Du lieu backend (chua token Telegram + mat khau)"
$data = "$env:APPDATA\unv-smartbox-desktop"
if (Test-Path $data) {
  Get-ChildItem $data | ForEach-Object { Write-Host ("  {0}" -f $_.Name) }
  if (Test-Path "$data\aibox.conf.json") {
    Write-Host "  <-- co aibox.conf.json = backend da tung chay o day" -ForegroundColor Yellow
  }
} else { Write-Host "  khong co" -ForegroundColor Green }

H "4. File aibox.exe con nam tren dia"
$hits = Get-ChildItem "$env:LOCALAPPDATA","$env:APPDATA","$env:USERPROFILE\Desktop","$env:USERPROFILE\Downloads" -Recurse -Filter 'aibox.exe' -Depth 5
if ($hits) { $hits | ForEach-Object { Write-Host ("  {0}" -f $_.FullName) -ForegroundColor Yellow } }
else { Write-Host "  khong co" -ForegroundColor Green }

H "5. KET LUAN"
if (-not $procs -and -not ($dirs | Where-Object { Test-Path (Join-Path $_.FullName 'resources\aibox') })) {
  Write-Host "  MAY NAY SACH — khong phai thu pham." -ForegroundColor Green
} else {
  Write-Host "  MAY NAY CO BAN CU — go di roi chay lai kiem tra." -ForegroundColor Red
}
