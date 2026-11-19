# Temaj ERP — Claude AI Implementation Specification Package
**Version:** 0.9 (approved to draft; not approved for Production)  
**Prepared:** 18 November 2026  
**Organisation:** Temaj Qeramike (Kosovo)  
**Purpose:** Build one cloud-hosted, multi-branch ERP/accounting web application to replace Albtrix completely, using an auditable phased development process.

## START HERE — critical provenance notice
This package is a **working specification, NOT a claim that the 880 original requirement statements were independently audited one by one**. Confirmed cumulative counts: **880 scope selections from 45 topics**, **172 subsequent registered decisions across 12 decision groups**, and **24 currently identified unresolved issues across two review groups**. The total 880 can contain overlapping requests and is not an assertion of 880 distinct features.

The generated matrix has **880 stable row IDs** (`REQ-Txx-yy`) and 45 topic-level source mappings. Source evidence differs:

- Topics **T01–T31 (576 entries):** labels are **normalized reconstructions from an available conversation summary**, not verbatim. A source-transcript check is required before declaring exact wording verified.
- Topics **T32–T45 (304 entries):** labels are **normalized from detailed user confirmations present in the current conversation**. They still require signed-off traceability to tests and implementation artifacts.
- **172 decisions** are reproduced in `02_DECISIONS/DECISION_REGISTER.csv`; several recorded decisions expressly **defer** selecting a concrete technical/accounting policy.
- **24 identified issues** remain `OPEN_UNVERIFIED` in `02_DECISIONS/OPEN_ISSUES.csv`; do **not** convert them into implied choices.

This is therefore **index-level completeness** (880/880 slots mapped to topic/category), not **source-verbatim or implementation/test traceability completion**. The requirements matrix deliberately leaves dependency links, test IDs and acceptance criteria as audit tasks instead of fabricating evidence.

## Non-negotiable business decisions
1. **One ERP application**, cloud-hosted, shared backend and database, for Temaj Qeramike.
2. **Replace Albtrix in full**. Development can proceed by phases; no partial Production go-live.
3. **Prizren and Prishtina launch together**, after all modules are implemented, verified, reconciled, and directors approve.
4. Code and cloud accounts belong to Temaj; **company-controlled Git repository + functional cloud deployment**.
5. **Safety and availability take precedence over minimizing monthly infrastructure cost**.
6. Frontend **Next.js + React + strict TypeScript**, backend **NestJS + strict TypeScript**, initial **modular monolith**, **PostgreSQL**; responsive mobile **PWA**.
7. Offline is limited to safe drafts; final financial posting requires an online server.
8. No unapproved accounting rules or Kosovo tax assumptions. Professional approval is required for unresolved policies.
9. No mock business function or fake integration may be presented as a Production-complete feature; mock services permitted only in Development/Staging, clearly marked.
10. All material actions are permission controlled, auditable, and tested; no false cash receipts or unbalanced ledgers.

## Folder guide
| Path | Purpose |
|---|---|
| `MASTER_PROMPT_CLAUDE.md` | Main operational instructions for Claude AI, in English |
| `01_REQUIREMENTS/REQUIREMENTS_MATRIX.csv` | 880 stable requirements IDs, module, source grade, outstanding test/acceptance traceability |
| `01_REQUIREMENTS/TOPIC_INDEX.md` | Topic-level counts and provenance |
| `01_REQUIREMENTS/MODULE_SPECIFICATIONS/` | 45 module-specific inventories |
| `02_DECISIONS/DECISION_REGISTER.csv` | 172 confirmed or explicitly deferred policy decisions |
| `02_DECISIONS/OPEN_ISSUES.csv` | 24 deliberately unresolved implementation/business facts |
| `03_ARCHITECTURE/` | System, database and integration architecture baselines |
| `04_BUSINESS_WORKFLOWS/` | Cross-module, high-risk end-to-end flows |
| `05_MIGRATION/` | Albtrix migration and simultaneous cutover strategy |
| `06_SECURITY_AND_COMPLIANCE/` | Security, privacy, continuity and disaster recovery |
| `07_TESTING_AND_ACCEPTANCE/` | Test protocol and acceptance gates |
| `08_IMPLEMENTATION_ROADMAP/` | Dependency-ordered phased delivery |
| `09_PROJECT_PROGRESS/` | Initial project state and acceptance checklist |
| `10_TRACEABILITY/` | Audit findings, gaps and verification instructions |
| `TEMAJ_ERP_TRACEABILITY.xlsx` | Workbook for reviewing requirements, decisions and issues |

## How to use
1. Upload/extract the **complete archive** into a **private company Git repository**. Do not copy confidential Albtrix data into public issue trackers.
2. Supply Claude AI with `MASTER_PROMPT_CLAUDE.md` **and make all companion files available**. The main prompt cannot replace missing appendices.
3. Instruct Claude to **audit first**: verify all 880 row labels against original confirmations, deduplicate without deleting source IDs, map 172 decisions, classify 24 open issues, create dependency graph and testable acceptance cases.
4. Obtain approvals for design-blocking/accounting matters prior to implementing affected business logic. Proceed on independently scoped modules in the meantime.
5. Require code, actual test evidence, demos and signoff for each module; never mistake a simulated UI for a real implementation.

**Authorization boundary:** This package authorizes preparation of the specification and development instructions, **not** deployment, external service payments, migrating production data, or switching off Albtrix.
