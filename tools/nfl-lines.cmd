@echo off
rem Hourly NFL lines and injuries refresh on game days ("Stamped NFL lines ..." tasks). Log: %LOCALAPPDATA%\Stamped\dff-nfl.log
set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;%PATH%"
if not exist "%LOCALAPPDATA%\Stamped" mkdir "%LOCALAPPDATA%\Stamped"
cd /d "%~dp0.."
node tools\nfl-props.js >> "%LOCALAPPDATA%\Stamped\dff-nfl.log" 2>&1
