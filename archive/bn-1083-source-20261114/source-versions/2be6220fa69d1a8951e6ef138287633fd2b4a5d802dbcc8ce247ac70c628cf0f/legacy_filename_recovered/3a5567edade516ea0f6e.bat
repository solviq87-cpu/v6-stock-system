@echo off
setlocal
rem Local Quant Dashboard launcher: make sure port 8787 is up, then open the panel.
set "DIR=C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard"
set "NODE=C:\Users\28957\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"

netstat -ano | findstr ":8787" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo Starting local dashboard service on port 8787 ...
  pushd "%DIR%"
  start "" /B "%NODE%" server.js
  popd
  rem wait a few seconds for the service to come up
  ping -n 5 127.0.0.1 >nul
)

start "" http://127.0.0.1:8787
endlocal
