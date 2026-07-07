# start-all.ps1 — chạy lần lượt toàn bộ stack dev.
# Chạy trong PowerShell tại thư mục Iot-control:  ./start-all.ps1
#   1) docker compose up -d --build box-counter backend  (kéo theo db, minio)
#   2) frontend: npm run dev  (Vite HTTPS tại :5173) — mở cửa sổ riêng
#   3) cloudflared tunnel trỏ vào https://localhost:5173

$ErrorActionPreference = 'Stop'
# Về đúng thư mục chứa script (nơi có docker-compose.yml + cloudflared.exe).
Set-Location -Path $PSScriptRoot

Write-Host "==> [1/3] Build + chạy docker (box-counter, backend, kèm db + minio)..." -ForegroundColor Cyan
docker compose up -d --build box-counter backend
if ($LASTEXITCODE -ne 0) { throw "docker compose that bai (exit $LASTEXITCODE)" }

Write-Host "==> [2/3] Khoi dong frontend (npm run dev) o cua so moi..." -ForegroundColor Cyan
$frontend = Join-Path $PSScriptRoot 'frontend'
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$frontend'; npm run dev"

# Chờ Vite lắng nghe cổng 5173 trước khi bật tunnel (tối đa ~60s).
Write-Host "    Cho Vite san sang tren cong 5173..." -ForegroundColor DarkGray
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    if ((Test-NetConnection -ComputerName localhost -Port 5173 -WarningAction SilentlyContinue).TcpTestSucceeded) {
        $ready = $true; break
    }
    Start-Sleep -Seconds 1
}
if (-not $ready) { Write-Host "    (Canh bao) Chua thay cong 5173, van tiep tuc bat tunnel." -ForegroundColor Yellow }

Write-Host "==> [3/3] Mo Cloudflare Tunnel -> https://localhost:5173" -ForegroundColor Cyan
& "$PSScriptRoot\cloudflared.exe" tunnel --url https://localhost:5173 --no-tls-verify
