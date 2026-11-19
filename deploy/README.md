# Ngritja e mjedisit provë (Staging)

> Ky mjedis është vetëm për provë: të dhëna testuese dhe rregulla tatimore/kontabël provizore. Mos fusni të dhëna reale.
> **Statusi i këtyre skedarëve:** të shkruar, por ende të paprovuar në një server të vërtetë (në mjedisin e zhvillimit nuk kishte Docker aktiv).

## Çfarë duhet
1. Një server Linux me Docker (2 vCPU, 4 GB RAM mjaftojnë për provë).
2. Një emër domeni ose nëndomen që tregon te IP-ja e serverit (regjistrim A), p.sh. `erp-prove.temaj.eu`.
3. Portat 80 dhe 443 të hapura.

## Hapat
```bash
git clone https://github.com/muraflush-glitch/temaj-erp.git && cd temaj-erp/deploy
cp .env.example .env          # plotësoni SITE_ADDRESS, DB_PASSWORD, SECRET_KEYS
docker compose up -d --build  # ndërton dhe nis databazën, API-n, web-in dhe HTTPS-in
```

Ngarkimi i të dhënave testuese (një herë):
```bash
docker compose exec -e SEED_ADMIN_PASSWORD='...' -e SEED_APPROVER_PASSWORD='...' -e SEED_DEMO_PASSWORD='...' \
  api node apps/api/dist/database/seed.cli.js
```
Fjalëkalimet duhet të kenë së paku 12 karaktere. Pastaj hapni `https://<SITE_ADDRESS>` dhe hyni me `demo@temaj.test`.

## Përditësimi
```bash
git pull && docker compose up -d --build
```

## Kufizime të njohura të këtij mjedisi
- Një server i vetëm, pa kopje rezervë automatike dhe pa replikë: nuk i plotëson objektivat RPO/RTO të specifikimit.
- Kufizimi i tentativave të hyrjes sipas IP-së sheh adresën e proxy-t, pra limiti ndahet mes të gjithë përdoruesve.
- Çelësi `SECRET_KEYS` ruhet në skedarin `.env`; në Production duhet të vijë nga KMS.
- Përdoruesi `demo` ka të gjitha rolet operative; në punë reale rolet ndahen mes personave.
