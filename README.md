# Temaj ERP

Sistemi i integruar ERP/kontabilitet për **Temaj Qeramike** (Prizren dhe Prishtinë), që do ta zëvendësojë plotësisht Albtrix.

> **Statusi: Faza 1 (themeli) dhe prototipi i librit kryesor — vetëm Development.** Nuk ka asnjë të dhënë reale dhe asnjë mjedis Production.
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
| Çelësat 2FA të enkriptuar (AES-256-GCM, rrotullim çelësash); DB refuzon tekst të lexueshëm | `src/common/secrets.ts`, migrimi 002 |
| Kufizimi i hyrjes sipas IP-së | `src/auth/auth.service.ts` |
| Transactional outbox me riprovim, backoff dhe dead-letter | `src/outbox` |
| Eskalimi i aprovimeve të vonuara (DEC-G52-09) | `src/approvals/escalation.service.ts` |
| Libri kryesor (prototip, llogari testuese): partia të dyfishta, pandryshueshmëri, storno, periudha, bilanc vërtetues | migrimi 003, `src/ledger` |
| Stoku fizik (prototip, produkte testuese): paketimi m²/kuti/copë, lote, pa stok negativ, transfere me dy palë | migrimi 004, `src/inventory` |
| Shitjet (prototip): oferta, porosi me rezervim stoku, dorëzime, përjashtime me aprovim; çmime neto, pa fatura | migrimi 005, `src/sales` |
| Blerjet (prototip): porosi me aprovim mbi prag, pranime malli, përputhje tripalëshe e faturave | migrimi 006, `src/purchasing` |
| Faturimi dhe arkëtimet (**PROVIZOR**: TVSH 18 %, llogari testuese; jo fiskale) | migrimi 007, `src/billing` |
| Formularë në ekran dhe test me Chrome | `apps/web`, `scripts/e2e-local.sh` |
| Arka ditore (**PROVIZOR**): hapje, mbyllje me numërim, diferenca me aprovim | migrimi 008, `src/cash` |
| Ngritja në server provë (Docker + HTTPS), ende e paprovuar | `deploy/README.md` |
| Kthimet me nota krediti, pagesat ndaj furnitorëve (me aprovim), raportet | migrimet 009–010, `src/billing`, `src/purchasing`, `src/reports` |
| Njoftimet: **SIMULIM vetëm në Development** (`dev_notification_sink`); ofruesi real pret OPEN-18/19 | `src/outbox/dev-notification.sink.ts` |

## Nisja lokale
```bash
npm install
cp .env.example .env            # vendosni DATABASE_URL
createdb temaj_erp_dev
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/temaj_erp_dev
npm run db:migrate
SEED_ADMIN_PASSWORD='...' SEED_APPROVER_PASSWORD='...' SEED_DEMO_PASSWORD='...' npm run db:seed   # vetëm të dhëna sintetike
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
- Rregullat tatimore dhe kontabël në këtë fazë janë PROVIZORE (të vendosura me kërkesë të pronarit, për t'u korrigjuar). Janë të shënuara në databazë dhe Production refuzon të niset derisa kontabilisti t'i miratojë.
- Asnjë e dhënë reale në Development. Seed-i refuzon të ekzekutohet kur `APP_ENV=production`.
- Asnjë funksion nuk quhet “i përfunduar” pa teste të ekzekutuara realisht.
