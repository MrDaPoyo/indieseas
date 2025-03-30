@echo off
title KeepOn - Bun Process Monitor
echo KeepOn - Press 'C' to stop the process
echo Starting bun...

:loop
start /b /wait cmd /c bun run .
echo Bun process stopped or crashed, restarting...

:: Check if user wants to exit
choice /c CN /t 3 /d N /m "Press C to stop, or N to continue (auto-continues in 3s)" 
if errorlevel 2 goto loop
if errorlevel 1 goto end

:end
echo Process monitoring stopped.
exit