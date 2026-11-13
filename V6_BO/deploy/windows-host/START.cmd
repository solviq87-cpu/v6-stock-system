@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0windows-host.ps1"
set "v6_exit=%ERRORLEVEL%"
pause
exit /b %v6_exit%
