# PROJECT STATE — version 0.9 / initial Claude handoff

## Current truth
**Authorization:** User has authorized **preparation of the Claude Master Prompt package**, not code implementation, paid cloud provisioning, production data extraction or go-live. The package is generated now; no live application is built.

**Counts:** 45 confirmed topic inventories and 880 indexed requirements; 172 registered decision rows across 12 choice groups; 24 known issues remain `OPEN_UNVERIFIED`. The exact per-source 880-line audit and design/code/test traceability are NOT complete.

**Go-live decision:** ALL modules complete, signed migrations and reconciliations, QA and pilot, formal management approval; Prizren and Prishtina activate together in a coordinated cutover. No partial/departmental Production migration.

## Snapshot of approved engineering choices
NestJS + TypeScript strict backend; Next.js + React + TypeScript strict frontend; PostgreSQL; modular monolith; three separate environments; PWA with draft-only offline; secure REST/OpenAPI/webhooks/outbox; company-owned cloud and Git; maximum security and availability priority; RPO target 5 minutes, RTO 1 hour (tests mandatory).

## Known undecided items
ORM, cloud provider/region, identity vendor, legal-entity structure, tax/payroll/depreciation policy, inventory valuation, COGS timing, CoA, late landed cost method, fiscal provider/API and other vendors, domains, real Albtrix files/warehouse mappings. See `02_DECISIONS/OPEN_ISSUES.csv` and decision deferrals.

## NEXT actions (not done)
- [ ] Source-by-source word-for-word review of the 880 original questionnaire selections against available transcripts, including missing source originals for T01–T31.
- [ ] Canonical deduplication/cross-reference and feature-gap analysis (no source ID dropped).
- [ ] Populate requirement→design→test→code→evidence→acceptance links, including criteria per row.
- [ ] Appoint project accountable owners and qualified accountant/tax reviewers.
- [ ] Acquire representative Albtrix export samples and actual invoice/stock/bank templates.
- [ ] Confirm selected software/hosting and security architecture ADRs.
- [ ] Produce precise scope-based effort/cost estimates and obtain approvals before billable services.
- [ ] Begin safe Phase 1 only after project owner gives implementation authorization.

## Session carryover rules
After each Claude development session, append a dated entry including source hash/commit, branch, environment, changed requirement IDs, decisions approved, open issue changes, exact test commands executed/results and next tasks. Never mark unchecked actions as DONE.

## 2026-11-19 — Faza 1, pjesa 1 (Development)
- Ndërtuar: monorepo, skema e themelit, hyrja/2FA/sesionet, rolet sipas degës, aprovime me katër sy, audit trail me zinxhir hash-esh, UI në shqip.
- Teste: 30/30 kaluan kundrejt PostgreSQL 16.15. Detajet: `docs/progress/2026-11-19-faza1-pjesa1.md`.
- Vendime të miratuara: asnjë i ri. Çështjet e hapura: të pandryshuara (24 OPEN_UNVERIFIED).
- Production: nuk ekziston. Albtrix: i paprekur.
