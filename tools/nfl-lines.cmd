@echo off
rem Every 3 hours: NFL games, odds, injuries and prop lines ("Stamped NFL refresh every 3h" task). Log: %LOCALAPPDATA%\Stamped\dff-nfl.log
set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;%PATH%"
if not exist "%LOCALAPPDATA%\Stamped" mkdir "%LOCALAPPDATA%\Stamped"
cd /d "%~dp0.."
node tools\nfl-props.js >> "%LOCALAPPDATA%\Stamped\dff-nfl.log" 2>&1
