@echo off
cd /d "%~dp0"
if not exist ".env" echo AVISO: crie o arquivo .env com CLIENT_ID e CLIENT_SECRET.
set "PATH=C:\Program Files\nodejs;%PATH%"
npm.cmd start
pause
