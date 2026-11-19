#!/usr/bin/env bash
# Ekzekutohet në çdo nisje të mjedisit: nis API-n dhe web-in në sfond.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.prove ] || { echo "Mjedisi nuk është përgatitur ende (setup.sh)"; exit 0; }
set -a; . ./.env.prove; set +a
export WORKER_ENABLED=true

sudo service postgresql start >/dev/null
for i in $(seq 1 30); do sudo -u postgres pg_isready -q && break; sleep 1; done

pkill -f "apps/api/dist/main.js" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
nohup node apps/api/dist/main.js > /tmp/temaj-api.log 2>&1 &
(cd apps/web && nohup node ../../node_modules/next/dist/bin/next start -p 3000 > /tmp/temaj-web.log 2>&1 &)

for i in $(seq 1 40); do
  if curl -sf localhost:3000/api/health >/dev/null 2>&1; then echo "Temaj ERP po punon në portin 3000."; exit 0; fi
  sleep 1
done
echo "Sistemi nuk u nis; shihni /tmp/temaj-api.log dhe /tmp/temaj-web.log"; exit 1
