@echo off
rem Startet das Depot-Dashboard mit den echten Daten aus data\ und oeffnet es im Browser.
rem Fenster offen lassen, solange das Dashboard laufen soll. Beenden mit Ctrl+C oder Fenster schliessen.
cd /d "%~dp0"
title Depot Liam
call npm run dev -- --open
pause
