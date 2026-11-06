@echo off
rem Task Scheduler entry point for the \Stamped\ tasks. Passes its arguments to tools\refresh.js.
rem Log: %LOCALAPPDATA%\Stamped\refresh.log
set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;%PATH%"
if not exist "%LOCALAPPDATA%\Stamped" mkdir "%LOCALAPPDATA%\Stamped"
cd /d "%~dp0.."
node tools\refresh.js %* >> "%LOCALAPPDATA%\Stamped\refresh.log" 2>&1
