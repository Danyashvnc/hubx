@echo off
cd /d "%~dp0..\server"
set ALLOW_INSECURE=1
set ADMIN_PASS=Adm-HubX-9F4c2A
if "%ADMIN_API_SECRET%"=="" set ADMIN_API_SECRET=hubx-local-defense-secret-keep-stable
echo Starting HubX backend on http://localhost:4000 ...
node index.js
pause
