@echo off
set CMD=C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\run_selfcheck.cmd
schtasks /create /tn "QuantSelfCheck-AM" /tr "%CMD%" /sc weekly /d MON,TUE,WED,THU,FRI /st 09:00 /np /f
schtasks /create /tn "QuantSelfCheck-PM" /tr "%CMD%" /sc weekly /d MON,TUE,WED,THU,FRI /st 16:00 /np /f
echo Done. QuantSelfCheck-AM/PM created (run as Administrator).
pause
