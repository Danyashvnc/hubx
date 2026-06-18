#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "HubX setup"

if [ ! -f .env ]; then
  cat > .env <<'ENV'
DOMAIN=hubx-mesh-app.duckdns.org
ADMIN_PASS=change-me-strong-admin-pass
ADMIN_API_SECRET=
BOT_PASS=change-me-strong-bot-pass
ENV
  echo "Created .env. Set DOMAIN, ADMIN_PASS and BOT_PASS, then run this script again."
  echo "  nano .env"
  exit 1
fi
set -a; . ./.env; set +a
: "${DOMAIN:?Set DOMAIN in .env}"; : "${ADMIN_PASS:?Set ADMIN_PASS in .env}"; : "${BOT_PASS:?Set BOT_PASS in .env}"

if ! grep -q '^ADMIN_API_SECRET=.\+' .env; then
  SECRET=$(openssl rand -hex 48)
  sed -i "s|^ADMIN_API_SECRET=.*|ADMIN_API_SECRET=${SECRET}|" .env
  set -a; . ./.env; set +a
fi

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f certs/fed.pem ]; then
  mkdir -p certs
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=localhost" \
    -keyout certs/_k.pem -out certs/_c.pem >/dev/null 2>&1
  cat certs/_k.pem certs/_c.pem > certs/fed.pem && rm -f certs/_k.pem certs/_c.pem
fi

sed -e "s|http://@HOST@:5280/upload|https://${DOMAIN}/upload|g" -e "/hubx.local/d" -e "s|^  - localhost\$|  - ${DOMAIN}|" -e "s|admin@localhost|admin@${DOMAIN}|g" ejabberd/conf/ejabberd.yml > deploy/ejabberd.runtime.yml

docker compose -f docker-compose.prod.yml up -d --build

echo -n "Waiting for ejabberd"
for i in $(seq 1 40); do
  if docker compose -f docker-compose.prod.yml exec -T ejabberd ejabberdctl status >/dev/null 2>&1; then break; fi
  echo -n "."; sleep 3
done; echo " ready."

reg() { docker compose -f docker-compose.prod.yml exec -T ejabberd ejabberdctl register "$1" "${DOMAIN}" "$2" >/dev/null 2>&1 || true; }
reg admin "$ADMIN_PASS"
docker compose -f docker-compose.prod.yml exec -T ejabberd ejabberdctl change_password admin "${DOMAIN}" "$ADMIN_PASS" >/dev/null 2>&1 || true
reg hubx-bot "$BOT_PASS"
reg alice alice123
reg bob bob123
docker compose -f docker-compose.prod.yml restart bot >/dev/null 2>&1 || true

echo ""
echo "HubX is running at https://${DOMAIN} (TLS issues on first request, about 30s)"
echo "Admin account: admin / ${ADMIN_PASS}"
echo "Logs: docker compose -f docker-compose.prod.yml logs -f"
