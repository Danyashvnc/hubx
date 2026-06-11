$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not (Test-Path "$root/certs/fed.pem")) {
  Write-Host "[0/4] Генерация общего s2s-сертификата (certs/fed.pem)..." -ForegroundColor Cyan
  New-Item -ItemType Directory -Force "$root/certs" | Out-Null
  docker run --rm --entrypoint sh -v "${root}\certs:/out" ejabberd/ecs:24.12 -c "openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout /tmp/k.pem -out /tmp/c.pem -subj '/CN=HubX Federation' -addext 'subjectAltName=DNS:hubx.local,DNS:hubx2.local,DNS:localhost' && cat /tmp/k.pem /tmp/c.pem > /out/fed.pem"
}

Write-Host "[1/4] Запуск ejabberd x2 (Docker)..." -ForegroundColor Cyan
docker compose up -d

Write-Host "[2/4] Ожидание готовности серверов (A + B)..." -ForegroundColor Cyan
do { Start-Sleep -Seconds 2 } until ((docker exec hubx-xmpp  ejabberdctl status 2>$null) -match "is running")
do { Start-Sleep -Seconds 2 } until ((docker exec hubx-xmpp2 ejabberdctl status 2>$null) -match "is running")

Write-Host "[3/4] Регистрация admin + демо-аккаунтов (idempotent)..." -ForegroundColor Cyan
docker exec hubx-xmpp ejabberdctl register admin     localhost "AdminHubX2025!" 2>$null | Out-Null
docker exec hubx-xmpp ejabberdctl register alice     localhost "alice123"        2>$null | Out-Null
docker exec hubx-xmpp ejabberdctl register bob       localhost "bob123"          2>$null | Out-Null
docker exec hubx-xmpp ejabberdctl register hubx-bot  localhost "BotHubX2025!"   2>$null | Out-Null
docker exec hubx-xmpp  ejabberdctl register anna  hubx.local  "anna123"  2>$null | Out-Null
docker exec hubx-xmpp2 ejabberdctl register boris hubx2.local "boris123" 2>$null | Out-Null

Write-Host "[4/4] Установка зависимостей и запуск backend + web..." -ForegroundColor Cyan
if (-not (Test-Path "$root/server/node_modules")) { Push-Location "$root/server"; npm install; Pop-Location }
if (-not (Test-Path "$root/web/node_modules"))    { Push-Location "$root/web";    npm install; Pop-Location }

if (-not $env:ADMIN_API_SECRET) {
  $env:ADMIN_API_SECRET = -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
}

if (-not (Test-Path "$root/examples/hubx-bot/node_modules")) { Push-Location "$root/examples/hubx-bot"; npm install; Pop-Location }

Start-Process powershell -ArgumentList "-NoExit","-Command","`$env:ADMIN_API_SECRET='$($env:ADMIN_API_SECRET)'; cd '$root/server'; npm start"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/web'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/examples/hubx-bot'; npm start"

Write-Host ""
Write-Host "Готово!" -ForegroundColor Green
Write-Host "  Веб-клиент : http://localhost:5173" -ForegroundColor Green
Write-Host "  Admin API  : http://localhost:4000/api/users" -ForegroundColor Green
Write-Host "  ejabberd   : http://localhost:5280/admin (admin@localhost / AdminHubX2025!)" -ForegroundColor Green
Write-Host ""
Write-Host "Демо: откройте две вкладки и войдите как alice/alice123 и bob/bob123." -ForegroundColor Yellow
Write-Host "s2s-федерация: вкладка 1 = anna/anna123 (Сервер A), вкладка 2 = boris/boris123 (Сервер B)," -ForegroundColor Yellow
Write-Host "               напишите anna -> boris@hubx2.local — сообщение пойдёт между серверами." -ForegroundColor Yellow
