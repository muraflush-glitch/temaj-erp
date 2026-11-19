# 2026-11-19 — Prova që punon brenda shfletuesit (Development)

**Qëllimi:** përdoruesi të mund ta përdorë sistemin brenda Claude, para se të vendoset në një server.

**Ndërtuar:** `apps/demo` — i njëjti kod i API-së dhe i ndërfaqes, i paketuar në një faqe që punon pa server, me PostgreSQL në WebAssembly (PGlite 0.5).
Të 10 migrimet ekzekutohen të pandryshuara (përfshirë `citext` dhe `btree_gist`).

**Ndryshime në kodin kryesor (të vogla):**
- `common/errors.ts`: hartimi i gabimeve u nxor në `toHttpError()`; filtri i NestJS e përdor atë (sjellje e pandryshuar).
- `web/lib/api.ts`: nëse ekziston `globalThis.__temajLocalApi` përdoret ai në vend të rrjetit. Në aplikacionin e vërtetë nuk ekziston.
- `shitjet`: lidhja e faturës përdor `Link`.

**Verifikuar:** typecheck, testet Jest, build, dhe `apps/demo/e2e.mjs` me Chrome (17 hapa: nisja, hyrje malli, shitje e plotë 40,36 €, libri kryesor,
notë krediti me aprovim nga personi i dytë, mbyllje arke, blerje, raporte, dalje/hyrje; zero kërkesa jashtë faqes). CI e ekzekuton në çdo PR.

**I paverifikuar:** hapja brenda kornizës së Claude (politika e sigurisë së faqes atje nuk mund të provohet nga mjedisi i zhvillimit).

**Kufizime të ditura:** të dhënat fshihen në rifreskim; printimi nuk lejohet brenda Claude; nuk ka punë në sfond (outbox, eskalime); `apps/demo` nuk kalon në typecheck të rreptë (paketohet me esbuild).
