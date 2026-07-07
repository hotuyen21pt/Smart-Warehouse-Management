@echo off
REM start-all.bat - chay lan luot toan bo stack dev.
REM Double-click hoac chay trong cmd tai thu muc Iot-control.
REM   1) docker compose up -d --build box-counter backend  (keo theo db, minio)
REM   2) frontend: npm run dev  (Vite HTTPS tai :5173) - mo cua so rieng
REM   3) cloudflared tunnel tro vao https://localhost:5173
REM   4) Ctrl+C o cloudflared -> docker compose down

cd /d "%~dp0"

echo ==> [1/3] Build + chay docker (box-counter, backend, kem db + minio)...
docker compose up -d --build box-counter backend
if errorlevel 1 (
    echo docker compose that bai.
    pause
    exit /b 1
)

echo ==> [2/3] Khoi dong frontend (npm run dev) o cua so moi...
start "frontend" /d "%~dp0frontend" cmd /k npm run dev

echo     Cho Vite san sang tren cong 5173...
setlocal enabledelayedexpansion
set READY=0
for /L %%i in (1,1,60) do (
    if !READY!==0 (
        powershell -NoProfile -Command "if((Test-NetConnection -ComputerName localhost -Port 5173 -WarningAction SilentlyContinue).TcpTestSucceeded){exit 0}else{exit 1}" >nul 2>&1
        if !errorlevel!==0 (
            set READY=1
        ) else (
            timeout /t 1 /nobreak >nul
        )
    )
)
if !READY!==0 echo     (Canh bao) Chua thay cong 5173, van tiep tuc bat tunnel.
endlocal

echo ==> [3/3] Mo Cloudflare Tunnel -^> https://localhost:5173
cloudflared.exe tunnel --url https://localhost:5173 --no-tls-verify

echo ==> Dung tunnel, tat docker...
docker compose down
