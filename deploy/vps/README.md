# Instalimi në serverin ekzistues (pranë Porositë & Dërgesat)

Temaj ERP instalohet në të njëjtin server, me adresë të vetën (p.sh. `erp.transportitemaj.com`). Aplikacioni ekzistues nuk preket:
ERP-ja ka dosjen e vet (`/root/temaj-erp`), databazën e vet (PostgreSQL), portat e veta të brendshme (3100, 4100) dhe shërbimet e veta.

> Mjedis provë: të dhëna testuese dhe rregulla tatimore provizore. Mos fusni të dhëna reale.

## 1. Adresa (një herë) — te Cloudflare
DNS → **Add record**: Type `A`, Name `erp`, IPv4 `37.148.207.181`, Proxy **DNS only** (re gri) në fillim.
Pasi faqja të hapet me HTTPS, mund ta ktheni në **Proxied** (re portokalli), si te `porosi`.

## 2. Ngarkimi dhe instalimi — nga PowerShell
```
scp $env:USERPROFILE\Downloads\temaj-erp.zip porosiadmin@37.148.207.181:~/
ssh porosiadmin@37.148.207.181
sudo unzip -o ~/temaj-erp.zip -d /root && sudo bash /root/temaj-erp/install.sh erp.transportitemaj.com
```
Në fund shfaqen adresa dhe fjalëkalimet (të krijuara rastësisht në server). Ruhen edhe te `/root/temaj-erp/HYRJA.txt`.

## 3. Përditësimi me version të ri
E njëjta gjë: ngarkoni `temaj-erp.zip` e ri dhe ekzekutoni të njëjtën komandë. Të dhënat dhe fjalëkalimet nuk ndryshojnë.

## Çfarë bën instaluesi
- instalon PostgreSQL nëse mungon; krijon databazën `temaj_erp` me fjalëkalim të rastësishëm
- krijon shërbimet `temaj-erp-api` dhe `temaj-erp-web` (nisen vetë pas rindezjes së serverit)
- **shton** adresën te `/etc/caddy/Caddyfile` pa prekur rreshtat ekzistues; para ndryshimit ruan një kopje, dhe e kthen atë nëse konfigurimi i ri nuk pranohet
- kopje rezervë e databazës çdo natë te `/root/kopje/erp` (14 ditët e fundit)

## Komanda të dobishme
```
sudo systemctl status temaj-erp-api temaj-erp-web
sudo journalctl -u temaj-erp-api -n 40
sudo cat /root/temaj-erp/HYRJA.txt
```

## Heqja e plotë (nëse duhet)
```
sudo systemctl disable --now temaj-erp-api temaj-erp-web
sudo rm /etc/systemd/system/temaj-erp-*.service /etc/cron.daily/temaj-erp-kopje
```
Pastaj hiqni bllokun `erp...` nga `/etc/caddy/Caddyfile` dhe ekzekutoni `sudo systemctl reload caddy`.
