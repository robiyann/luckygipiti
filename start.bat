@echo off
chcp 65001 >nul 2>&1
title ZYVENOX GPT
cd /d "%~dp0"

:: ─────────────────────────────────────────
::   ZYVENOX GPT - Smart Launcher
:: ─────────────────────────────────────────

echo.
echo  ╔════════════════════════════════════╗
echo  ║         ZYVENOX GPT Launcher        ║
echo  ╚════════════════════════════════════╝
echo.

:: [1] Cek Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [✕] Node.js tidak ditemukan!
    echo      Download di: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [✓] Node.js terdeteksi: %NODE_VER%

:: [2] Cek npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  [✕] npm tidak ditemukan!
    echo.
    pause
    exit /b 1
)

:: [3] Auto-install jika node_modules belum ada
if not exist "node_modules\" (
    echo  [◆] Instalasi dependencies pertama kali...
    echo.
    call npm install --production
    if %errorlevel% neq 0 (
        echo.
        echo  [✕] Instalasi gagal! Cek koneksi internet dan coba lagi.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo  [✓] Instalasi selesai!
    echo.
) else (
    echo  [✓] Dependencies sudah tersedia
)

:: [4] Cek file .env
if not exist ".env" (
    echo.
    echo  [△] File .env tidak ditemukan!
    echo      Salin .env.example ke .env dan isi konfigurasi terlebih dahulu.
    echo.
    pause
    exit /b 1
)

echo  [✓] Konfigurasi .env ditemukan
echo.
echo  ────────────────────────────────────
echo  [◆] Menjalankan GPT Station...
echo  ────────────────────────────────────
echo.

:: [5] Jalankan bot — jika crash, tampilkan error dan tanya restart
:run
node src/index.js
set EXIT_CODE=%errorlevel%

echo.
if %EXIT_CODE% equ 0 (
    echo  [✓] Bot melakukan restart sistem...
    timeout /t 2 /nobreak >nul
    goto run
)

if %EXIT_CODE% neq 0 (
    echo  [✕] Program berhenti dengan error (kode: %EXIT_CODE%)
    echo.
    set /p RESTART="  Coba jalankan ulang? (y/n): "
    if /i "%RESTART%"=="y" (
        echo.
        echo  [◆] Merestart...
        echo.
        goto run
    )
)

echo.
echo  Sampai jumpa!
echo.
pause

