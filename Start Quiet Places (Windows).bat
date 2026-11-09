@echo off
REM Double-click to start Quiet Places.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 server.py & goto :end)
where python >nul 2>nul && (python server.py & goto :end)
echo Python 3 is needed. Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH") and double-click this file again.
:end
pause
