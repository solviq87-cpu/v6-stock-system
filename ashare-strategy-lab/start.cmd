@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo Install Node.js 20 or later and make sure node is on PATH.
    pause
    exit /b 1
)
node server.mjs
if errorlevel 1 pause
