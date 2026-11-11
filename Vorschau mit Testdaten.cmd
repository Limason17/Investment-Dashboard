@echo off
rem Startet die Vorschau mit erfundenen Testdaten aus data-demo\ (Port 5175) und oeffnet sie im Browser.
rem Die echten Daten in data\ bleiben unberuehrt. Die Testdaten werden bei jedem Start neu erzeugt.
cd /d "%~dp0"
title Depot Liam - Testdaten
call npm run demo -- --open
pause
