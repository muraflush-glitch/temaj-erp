#!/usr/bin/env bash
# Ekzekutohet një herë kur krijohet mjedisi: instalon, ndërton, krijon databazën dhe të dhënat testuese.
set -euo pipefail
cd "$(dirname "$0")/.."

# Databaza PostgreSQL brenda të njëjtit mjedis (vetëm për provë).
if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib >/dev/null
fi
sudo service postgresql start
for i in $(seq 1 30); do sudo -u postgres pg_isready -q && break; sleep 1; done
sudo -u postgres psql -qc "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'temaj') THEN CREATE ROLE temaj LOGIN SUPERUSER PASSWORD 'temaj-prove'; END IF; END \$\$"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'temaj_erp'" | grep -q 1 || sudo -u postgres createdb -O temaj temaj_erp

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

node apps/api/dist/database/migrate.cli.js
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
