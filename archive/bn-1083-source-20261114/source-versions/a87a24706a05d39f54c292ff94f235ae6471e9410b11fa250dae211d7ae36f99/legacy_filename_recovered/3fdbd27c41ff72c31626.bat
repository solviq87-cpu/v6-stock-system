@echo off
rem ============================================================
rem  Quant Dashboard - one-click restore
rem  Unpacks the newest FULL source zip (config + holdings + all)
rem  into  _restored\<version>_<time>\  then tells you what to do.
rem ============================================================
set "DIR=C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard"
cd /d "%DIR%" || (echo ERROR: folder not found & pause & exit /b 1)

set "PY="
for /f "delims=" %%i in ('where python 2^>nul') do if not defined PY set "PY=%%i"
if not defined PY set "PY=C:\Users\28957\.workbuddy\binaries\python\versions\3.13.12\python.exe"

echo.
echo Using python: %PY%
echo.

"%PY%" _restore_full.py
if errorlevel 1 (echo. & echo Restore did not finish. Read the message above.)

echo.
pause
