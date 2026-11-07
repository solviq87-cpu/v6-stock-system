@echo off
setlocal enabledelayedexpansion
set BASE=C:\Users\28957\.workbuddy\binaries\node\versions
set VER=
if exist "%BASE%\current" (set /p VER=<"%BASE%\current")
if not defined VER set VER=22.22.2-6
set NODE=%BASE%\!VER!\node.exe
if not exist "%NODE%" set NODE=%BASE%\22.22.2-6\node.exe
set PROJ=C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard
cd /d "%PROJ%"
"%NODE%" _selfcheck.js
endlocal
