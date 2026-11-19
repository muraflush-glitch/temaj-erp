# ADR-001 — Qasja në PostgreSQL (ORM)

**Statusi:** PROPOZIM — pret miratimin e Temaj-it (DEC-G46-03)
**Data:** 2026-11-19

## Konteksti
DEC-G46-03 thotë që ORM-i zgjidhet vetëm pas vlerësimit të transaksioneve kontabël. Faza 1 duhej të fillonte pa e paragjykuar këtë vendim.

## Çfarë u bë në Fazën 1 (e kthyeshme)
- Migrime SQL të shkruara me dorë (`apps/api/migrations/NNN_*.sql`) me checksum; një migrim i aplikuar nuk mund të ndryshohet.
- Driver-i `pg` me SQL të parametrizuar; transaksione të shkurtra me `withTransaction`.
- Rregullat kritike (vetë-aprovimi, auditi vetëm-shtim, zinxhiri i hash-eve) janë në databazë, ndaj mbeten të vlefshme me çdo ORM.

## Opsionet për vendimin final
| Opsioni | Pro | Kundër |
| --- | --- | --- |
| A. SQL + `pg` (si tani) + query builder i tipizuar (Kysely) | Kontroll i plotë mbi kyçjet, `FOR UPDATE`, CTE; pa magji | Më shumë kod |
| B. Prisma | Produktivitet, migrime automatike | Kontroll më i dobët mbi kyçjet dhe trigger-at; SQL i papërpunuar për librin kryesor |
| C. Drizzle | Afër SQL-it, i tipizuar | Ekosistem më i ri |
| D. TypeORM / MikroORM | Unit-of-work, të njohura në NestJS | Rrezik i transaksioneve të gjata dhe i lazy-loading |

## Rekomandimi (jo i miratuar)
Opsioni A me Kysely për librin kryesor dhe stokun, ku kyçjet dhe kufizimet në DB janë thelbësore. Vendimi final pas prototipit të regjistrimit kontabël në Fazën 2.
