# Temaj ERP

Sistemi i integruar ERP/kontabilitet për **Temaj Qeramike** (Prizren dhe Prishtinë), që do ta zëvendësojë plotësisht Albtrix.

> **Statusi: Faza 1 (themeli) në zhvillim — vetëm Development.** Nuk ka asnjë të dhënë reale dhe asnjë mjedis Production.
> Kalimi në përdorim bëhet vetëm kur të jenë gati të gjitha modulet, njëkohësisht në të dyja degët.

Specifikimi i plotë (880 kërkesa, 172 vendime, 24 çështje të hapura) është te `docs/specification/`.

## Teknologjia
- Backend: NestJS 11 + TypeScript strict (`apps/api`)
- Frontend: Next.js 15 + React 19 + TypeScript strict, ndërfaqe në shqip, PWA (`apps/web`)
- Databaza: PostgreSQL 16, migrime SQL me checksum (`apps/api/migrations`)
- ORM: **ende i pazgjedhur** — shih `docs/adr/ADR-001-qasja-ne-databaze.md`

## Çfarë përmban Faza 1 deri tani
| Funksioni | Ku zbatohet |
| --- | --- |
| Subjekti ligjor, degët PZ/PR, magazinat (struktura juridike e konfigurueshme deri në OPEN-01) | `migrations/001_foundation.sql` |
| Hyrja me fjalëkalim (scrypt), bllokim pas 5 tentativave, sesione të revokueshme (ruhet vetëm hash-i i token-it) | `src/auth` |
| 2FA me TOTP (Google/Microsoft Authenticator), step-up për aprovime | `src/auth/crypto.ts` |
| Role dhe leje sipas degës, me afat skadimi | `src/auth/permission.service.ts` |
| Motori i aprovimeve: katër sy, pa vetë-aprovim (edhe në DB), idempotencë, bllokim kur mungon politika | `src/approvals` |
| Dhënia e roleve vetëm përmes aprovimit; heqja e menjëhershme | `src/access` |
| Audit trail vetëm-shtim me zinxhir hash-esh që zbulon ndërhyrjet | `audit_log` + `src/audit` |

## Nisja lokale
```bash
npm install
cp .env.example .env            # vendosni DATABASE_URL
createdb temaj_erp_dev
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/temaj_erp_dev
npm run db:migrate
SEED_ADMIN_PASSWORD='...' SEED_APPROVER_PASSWORD='...' npm run db:seed   # vetëm të dhëna sintetike
npm run build -w apps/api && node apps/api/dist/main.js                   # API në :4000
npm run dev -w apps/web                                                   # Web në :3000
```

## Testet
```bash
createdb temaj_erp_test
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/temaj_erp_test npm test
```
Testet ekzekutohen kundrejt një PostgreSQL të vërtetë; skema rikrijohet nga e para në çdo ekzekutim.

## Rregulla që nuk ndryshojnë
- Asnjë rregull tatimor, kontabël apo pagash i Kosovës nuk supozohet. Pjesët që varen prej tyre presin miratimin e kontabilistit.
- Asnjë e dhënë reale në Development. Seed-i refuzon të ekzekutohet kur `APP_ENV=production`.
- Asnjë funksion nuk quhet “i përfunduar” pa teste të ekzekutuara realisht.
