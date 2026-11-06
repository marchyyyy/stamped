@echo off
rem Scheduled by Windows Task Scheduler ("Stamped DFF NFL ..." tasks). Log: %LOCALAPPDATA%\Stamped\dff-nfl.log
set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;%PATH%"
if not exist "%LOCALAPPDATA%\Stamped" mkdir "%LOCALAPPDATA%\Stamped"
cd /d "%~dp0.."
node tools\dff-nfl.js >> "%LOCALAPPDATA%\Stamped\dff-nfl.log" 2>&1
node tools\nfl-props.js >> "%LOCALAPPDATA%\Stamped\dff-nfl.log" 2>&1
