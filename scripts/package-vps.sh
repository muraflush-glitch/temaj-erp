#!/usr/bin/env bash
# Përgatit temaj-erp.zip për instalim në server (si porosite.zip): kod i ndërtuar, pa të dhëna dhe pa fjalëkalime.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-$PWD/temaj-erp.zip}"
# Adresa e brendshme e API-së në server (duhet të përputhet me install.sh).
API_INTERNAL_URL=http://127.0.0.1:4100 npm run -s build
STAGE="$(mktemp -d)"; P="$STAGE/temaj-erp"
mkdir -p "$P/apps/api" "$P/apps/web"
cp package.json package-lock.json "$P/"
cp deploy/vps/install.sh "$P/install.sh"
cp apps/api/package.json "$P/apps/api/"
cp -r apps/api/dist apps/api/migrations "$P/apps/api/"
cp apps/web/package.json apps/web/next.config.mjs "$P/apps/web/"
cp -r apps/web/public "$P/apps/web/"
cp -r apps/web/.next "$P/apps/web/.next"
rm -rf "$P/apps/web/.next/cache" "$P/apps/web/.next/dev"
rm -f "$OUT"
(cd "$STAGE" && zip -qr "$OUT" temaj-erp)
rm -rf "$STAGE"
echo "U krijua $OUT ($(du -h "$OUT" | cut -f1))"
