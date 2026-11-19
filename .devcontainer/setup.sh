#!/usr/bin/env bash
# Ekzekutohet një herë kur krijohet mjedisi: instalon, ndërton, krijon databazën dhe të dhënat testuese.
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci
npm run build

# Fjalëkalime dhe çelësa të rastësishëm, vetëm për këtë mjedis. Nuk ruhen në Git.
if [ ! -f .env.prove ]; then
  rand() { node -e "console.log(require('crypto').randomBytes($1).toString('base64url'))"; }
  {
    echo "SECRET_KEYS=k1:$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
    echo "SECRET_ACTIVE_KEY_ID=k1"
    echo "SEED_ADMIN_PASSWORD=$(rand 15)"
    echo "SEED_APPROVER_PASSWORD=$(rand 15)"
    echo "SEED_DEMO_PASSWORD=$(rand 12)"
  } > .env.prove
fi
set -a; . ./.env.prove; set +a

# Databaza mund të dojë disa sekonda për t'u nisur.
for i in $(seq 1 30); do
  node apps/api/dist/database/migrate.cli.js && break
  [ "$i" = 30 ] && { echo "Databaza nuk u përgjigj"; exit 1; }
  sleep 2
done
node apps/api/dist/database/seed.cli.js

cat > HYRJA.txt <<TXT
=====================================================
 TEMAJ ERP — mjedis provë (të dhëna testuese)
=====================================================
 Hapni skedën "PORTS" poshtë dhe klikoni adresën e portit 3000
 (ose prisni: shfletuesi hapet vetë).

 Përdoruesi:   demo@temaj.test
 Fjalëkalimi:  ${SEED_DEMO_PASSWORD}

 Për të provuar aprovimet (personi i dytë, kërkon 2FA):
   aprovues@temaj.test  /  ${SEED_APPROVER_PASSWORD}
=====================================================
TXT
echo "Gati. Kredencialet janë te skedari HYRJA.txt"
