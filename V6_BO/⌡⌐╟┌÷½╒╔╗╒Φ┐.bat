@echo off
rem Quant dashboard one-click launcher: start daemon (no window) + open panel
start "" "C:\Users\28957\.workbuddy\binaries\python\versions\3.13.12\pythonw.exe" "C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\start_daemon.py"
ping -n 4 127.0.0.1 >nul
start "" "http://127.0.0.1:8787"
