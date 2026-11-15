@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL.ps1"
set "v6_exit=%ERRORLEVEL%"
if not "%v6_exit%"=="0" (
  echo Installation is not complete. Existing data was not reset.
  pause
)
exit /b %v6_exit%
