# dev.ps1 — bat aibox backend (:8090), serve ui/ same-origin. KHONG dung vite.
#   ui/ la source-of-truth (aibox.py serve tai :8090, cung origin voi API -> khong
#   CORS, khong dual-tree). Vite/electron-app chi dung de build dong goi (npm run build).
# Dung:  .\dev.ps1     (hoac:  powershell -ExecutionPolicy Bypass -File dev.ps1)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-Port($port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $c.Close() }
}

# 1. Don tien trinh cu tren 2 port
foreach ($p in 8090, 1984) {
  Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

# 2. aibox backend (cua so rieng de xem log)
Start-Process powershell -ArgumentList '-NoExit','-Command',
  "Set-Location '$root'; py aibox.py" -WindowStyle Normal | Out-Null

# 3. Cho port san roi mo browser
Write-Host 'Dang khoi dong aibox (:8090)...' -ForegroundColor DarkGray
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  if (Test-Port 8090) { break }
  Start-Sleep -Milliseconds 400
}

if (Test-Port 8090) {
  Start-Process 'http://localhost:8090'
  Write-Host "OK  http://localhost:8090  (aibox serve ui/, go2rtc :1984)" -ForegroundColor Green
  Write-Host 'Dong cua so PowerShell de dung dev server.' -ForegroundColor DarkGray
} else {
  Write-Host 'LOI: aibox khong khoi dong duoc — xem cua so PowerShell aibox.' -ForegroundColor Red
}
