@echo off
rem ============================================================
rem  Quant Dashboard - one-click backup source to Gitee (private)
rem  Safe: config.json / access.json / holdings.json are excluded
rem  by .gitignore, so NO secrets ever leave this computer.
rem ============================================================
set "DIR=C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard"
cd /d "%DIR%" || (echo ERROR: folder not found & pause & exit /b 1)

echo.
echo === 1/3  stage all files ===
git add -A
if errorlevel 1 (echo ERROR: git add failed & pause & exit /b 1)

echo.
echo === 2/3  commit ===
git commit -m "snapshot %DATE% %TIME%"
echo        (if it says "nothing to commit", that is fine)

echo.
echo === 3/3  push to Gitee ===
git push gitee master
if errorlevel 1 (echo. & echo ERROR: push failed. Check network / Gitee login. & pause & exit /b 1)

echo.
echo === done. Repo: https://gitee.com/nine-heavens-qi/lianghuakanpandaima ===
echo.
pause
