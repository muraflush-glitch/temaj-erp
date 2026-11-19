#!/usr/bin/env bash
# Ngre një databazë të pastër, API-n dhe web-in, dhe ekzekuton testin e ndërfaqes me Chrome.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${E2E_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/temaj_erp_e2e}
ADMIN_URL=${DB%/*}/postgres
psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS temaj_erp_e2e" -c "CREATE DATABASE temaj_erp_e2e"
export DATABASE_URL=$DB SEED_ADMIN_PASSWORD=Admin-E2E-Fjalekalim-1 SEED_APPROVER_PASSWORD=Aprovues-E2E-Fjalekalim-1 SEED_DEMO_PASSWORD=Demo-E2E-Fjalekalim-1
export SECRET_KEYS="k1:$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" SECRET_ACTIVE_KEY_ID=k1
npm run -s build >/tmp/e2e-build.log 2>&1
npm run -s db:migrate && npm run -s db:seed
node apps/api/dist/main.js >/tmp/e2e-api.log 2>&1 & API=$!
(cd apps/web && npx next start -p 3000 >/tmp/e2e-web.log 2>&1) & WEB=$!
trap 'kill $API $WEB 2>/dev/null || true; pkill -f next-server 2>/dev/null || true' EXIT
for i in $(seq 1 40); do curl -sf localhost:4000/api/health >/dev/null && curl -sf localhost:3000/hyrja >/dev/null && break; sleep 1; done
DEMO_PASSWORD=$SEED_DEMO_PASSWORD node apps/web/e2e/smoke.mjs
