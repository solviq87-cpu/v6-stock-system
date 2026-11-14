@echo off
rem ============================================================
rem  Quant Dashboard - pull holdings/config/learn data back from
rem  the ONLINE instance (use after data loss or on a new PC).
rem  Old files are kept as *.bak before overwrite.
rem ============================================================
set "DIR=C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard"
cd /d "%DIR%" || (echo ERROR: folder not found & pause & exit /b 1)

set "PY="
for /f "delims=" %%i in ('where python 2^>nul') do if not defined PY set "PY=%%i"
if not defined PY set "PY=C:\Users\28957\.workbuddy\binaries\python\versions\3.13.12\python.exe"

echo.
echo  This pulls holdings / config / learn data from the ONLINE server.
echo  Current files will be kept as *.bak before overwrite.
echo.
set /p PWD=Developer password:

"%PY%" _fetch_online_data.py --password "%PWD%" --replica
if errorlevel 1 (echo. & echo Failed. Read the message above.)

echo.
pause
