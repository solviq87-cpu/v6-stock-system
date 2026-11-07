@echo off
schtasks /delete /tn "QuantSelfCheck-AM" /f
schtasks /delete /tn "QuantSelfCheck-PM" /f
echo Removed.
pause
