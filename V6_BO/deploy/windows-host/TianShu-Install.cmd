@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0TianShu-Install.ps1" -Mode Install
if errorlevel 1 (
  echo Installation was not completed. Existing V6 data was not overwritten.
  pause
)
