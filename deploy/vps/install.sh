#!/usr/bin/env bash
# Temaj ERP — instalim ose përditësim në një server Ubuntu ku mund të punojnë edhe aplikacione të tjera (p.sh. Porositë & Dërgesat).
# Përdorimi (si root):   bash /root/temaj-erp/install.sh erp.domeni.com
# I sigurt për t'u përsëritur: të dhënat, fjalëkalimet dhe konfigurimi nuk fshihen. Aplikacionet e tjera nuk preken.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
DOMAIN="${1:-}"
WEB_PORT=3100
API_PORT=4100
[ "$(id -u)" = 0 ] || { echo "Duhet ekzekutuar si root (me sudo)."; exit 1; }
echo "== Temaj ERP: instalim në $DIR =="

# --- Node.js 20+ ---
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "== Po instalohet Node.js =="
  apt-get update -y -qq && apt-get install -y -qq curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
NODE="$(command -v node)"

# --- PostgreSQL ---
if ! command -v psql >/dev/null 2>&1; then
  echo "== Po instalohet PostgreSQL =="
  apt-get update -y -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
fi
systemctl enable --now postgresql >/dev/null 2>&1 || service postgresql start
for i in $(seq 1 30); do runuser -u postgres -- pg_isready -q && break; sleep 1; done

# --- Konfigurimi (krijohet vetëm herën e parë; nuk mbishkruhet kurrë) ---
FIRST=0
if [ ! -f "$DIR/.env" ]; then
  FIRST=1
  rand() { "$NODE" -e "console.log(require('crypto').randomBytes($1).toString('base64url'))"; }
  DBPASS="$(rand 24)"
  umask 077
  cat > "$DIR/.env" <<ENV
APP_ENV=staging
DATABASE_URL=postgres://temaj_erp:${DBPASS}@127.0.0.1:5432/temaj_erp
API_PORT=${API_PORT}
API_HOST=127.0.0.1
API_INTERNAL_URL=http://127.0.0.1:${API_PORT}
SECRET_KEYS=k1:$("$NODE" -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
SECRET_ACTIVE_KEY_ID=k1
WORKER_ENABLED=true
SESSION_TTL_MINUTES=480
ENV
  runuser -u postgres -- psql -qc "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'temaj_erp') THEN CREATE ROLE temaj_erp LOGIN; END IF; END \$\$"
  runuser -u postgres -- psql -qc "ALTER ROLE temaj_erp PASSWORD '${DBPASS}'"
  runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'temaj_erp'" | grep -q 1 || runuser -u postgres -- createdb -O temaj_erp temaj_erp
  # Shtesat e databazës i krijon administratori, që aplikacioni të mos ketë nevojë për të drejta të larta.
  runuser -u postgres -- psql -qd temaj_erp -c "CREATE EXTENSION IF NOT EXISTS citext" -c "CREATE EXTENSION IF NOT EXISTS btree_gist"
fi
chmod 600 "$DIR/.env"
set -a; . "$DIR/.env"; set +a

# --- Varësitë dhe databaza ---
echo "== Po instalohen paketat =="
cd "$DIR" && npm ci --omit=dev --no-audit --no-fund >/dev/null
echo "== Po përditësohet databaza =="
"$NODE" apps/api/dist/database/migrate.cli.js

if [ "$FIRST" = 1 ]; then
  export SEED_ADMIN_PASSWORD="$(rand 15)" SEED_APPROVER_PASSWORD="$(rand 15)" SEED_DEMO_PASSWORD="$(rand 12)"
  "$NODE" apps/api/dist/database/seed.cli.js
  cat > "$DIR/HYRJA.txt" <<TXT
TEMAJ ERP — mjedis provë (të dhëna testuese)
Përdoruesi:   demo@temaj.test
Fjalëkalimi:  ${SEED_DEMO_PASSWORD}

Personi i dytë për aprovime (duhet të aktivizojë 2FA te "Siguria"):
  aprovues@temaj.test  /  ${SEED_APPROVER_PASSWORD}
Administratori:
  admin@temaj.test  /  ${SEED_ADMIN_PASSWORD}
TXT
  chmod 600 "$DIR/HYRJA.txt"
fi

# --- Shërbimet ---
cat > /etc/systemd/system/temaj-erp-api.service <<UNIT
[Unit]
Description=Temaj ERP API
After=network.target postgresql.service
[Service]
WorkingDirectory=$DIR
EnvironmentFile=$DIR/.env
ExecStart=$NODE $DIR/apps/api/dist/main.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/temaj-erp-web.service <<UNIT
[Unit]
Description=Temaj ERP Web
After=network.target temaj-erp-api.service
[Service]
WorkingDirectory=$DIR/apps/web
EnvironmentFile=$DIR/.env
ExecStart=$NODE $DIR/node_modules/next/dist/bin/next start -p $WEB_PORT -H 127.0.0.1
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable temaj-erp-api temaj-erp-web >/dev/null 2>&1
systemctl restart temaj-erp-api temaj-erp-web

# --- Kopje rezervë e databazës çdo natë (14 ditët e fundit) ---
mkdir -p /root/kopje/erp
cat > /etc/cron.daily/temaj-erp-kopje <<'CRON'
#!/bin/sh
F=/root/kopje/erp/temaj-erp-$(date +%F).sql.gz
runuser -u postgres -- pg_dump temaj_erp | gzip > "$F.tmp" && mv "$F.tmp" "$F"
find /root/kopje/erp -name 'temaj-erp-*.sql.gz' -mtime +14 -delete
CRON
chmod +x /etc/cron.daily/temaj-erp-kopje

# --- Adresa publike me HTTPS: shtohet te Caddy PA prekur faqet ekzistuese ---
if [ -n "$DOMAIN" ]; then
  if ! command -v caddy >/dev/null 2>&1; then
    echo "== Po instalohet Caddy =="
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y -qq && apt-get install -y -qq caddy
  fi
  CF=/etc/caddy/Caddyfile
  touch "$CF"
  if grep -qE "^[[:space:]]*${DOMAIN//./\\.}[[:space:]]*\{" "$CF"; then
    echo "== $DOMAIN ekziston tashmë te Caddy; nuk ndryshohet =="
  else
    cp "$CF" "$CF.para-erp-$(date +%F-%H%M%S)"
    printf '\n%s {\n\treverse_proxy localhost:%s\n}\n' "$DOMAIN" "$WEB_PORT" >> "$CF"
    if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
      systemctl reload caddy 2>/dev/null || systemctl restart caddy
      echo "== $DOMAIN u shtua te Caddy =="
    else
      # Nëse konfigurimi i ri nuk është i vlefshëm, kthehet ai i mëparshmi: faqet ekzistuese nuk ndërpriten.
      cp "$(ls -1t "$CF".para-erp-* | head -1)" "$CF"
      echo "❌ Konfigurimi i Caddy nuk u pranua; u kthye ai i mëparshmi. Aplikacionet e tjera nuk u prekën."
    fi
  fi
  if command -v ufw >/dev/null 2>&1; then ufw allow 80/tcp >/dev/null || true; ufw allow 443/tcp >/dev/null || true; fi
fi

OK=0
for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 1
done
echo
if [ "$OK" = 1 ]; then
  echo "✅ GATI! Temaj ERP po punon."
  [ -n "$DOMAIN" ] && echo "   Hape:  https://$DOMAIN"
  [ "$FIRST" = 1 ] && { echo "   Kredencialet (ruaji dhe mos ia dërgo askujt):"; sed 's/^/     /' "$DIR/HYRJA.txt"; }
  [ "$FIRST" = 1 ] || echo "   Kredencialet janë si më parë:  sudo cat $DIR/HYRJA.txt"
else
  echo "❌ Sistemi nuk u nis. Shiko:  journalctl -u temaj-erp-api -n 40   dhe   journalctl -u temaj-erp-web -n 40"
  exit 1
fi
