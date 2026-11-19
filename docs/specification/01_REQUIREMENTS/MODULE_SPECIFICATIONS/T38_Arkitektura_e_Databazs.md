# T38 — Arkitektura e Databazës

**Count:** 22 | **Source evidence:** USER_CONFIRMATION_NORMALIZED | **Verification:** wording/provenance to be confirmed

## Indexed requirements

- **REQ-T38-01** — PostgreSQL si databazë kryesore
- **REQ-T38-02** — Skemë relacionale e normalizuar
- **REQ-T38-03** — Kufizime integriteti në databazë
- **REQ-T38-04** — Transaksione ACID
- **REQ-T38-05** — Ledger kontabël me integritet të garantuar
- **REQ-T38-06** — Regjistrime financiare të konfirmuara të pandryshueshme
- **REQ-T38-07** — Llogaritje monetare me saktësi fikse
- **REQ-T38-08** — Kontrolli i transaksioneve të njëkohshme
- **REQ-T38-09** — Idempotency për veprimet kritike
- **REQ-T38-10** — Identifikues unikë për regjistrimet
- **REQ-T38-11** — Audit Log i pandryshueshëm dhe i mbrojtur
- **REQ-T38-12** — Arkivim dhe fshirje e kontrolluar
- **REQ-T38-13** — Indekse dhe optimizim i kërkimeve
- **REQ-T38-14** — Versionimi i skemës së databazës
- **REQ-T38-15** — Teste automatike të databazës
- **REQ-T38-16** — Backup dhe Point-in-Time Recovery
- **REQ-T38-17** — Siguria e qasjes në databazë
- **REQ-T38-18** — Izolimi i të dhënave sipas autorizimeve
- **REQ-T38-19** — Ngjarje të besueshme për integrime (Outbox Pattern)
- **REQ-T38-20** — Punë asinkrone dhe radhë përpunimi
- **REQ-T38-21** — Logs, metrics dhe tracing
- **REQ-T38-22** — Dokumentimi i arkitekturës dhe databazës

## Implementation / acceptance rule
Every requirement must be elaborated into actors, permissions, state changes, domain invariants, API/UI, edge cases, audit events, test case IDs and measurable acceptance criteria. This file is an inventory, not an approved final design. Cross-check `02_DECISIONS/DECISION_REGISTER.csv`, `02_DECISIONS/OPEN_ISSUES.csv`, and the applicable workflows before implementing.
