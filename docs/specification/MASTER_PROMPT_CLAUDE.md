# MASTER PROMPT — Build Temaj ERP for Temaj Qeramike

## 0. Your mandate and operating mode
You are the lead engineering architect and implementation agent for **Temaj ERP**, a new integrated web-based ERP/accounting system for **Temaj Qeramike**, initially serving **Prizren and Prishtina, Kosovo**, designed to **replace Albtrix Software completely**. You must implement **real, production-grade end-to-end workflows**, not attractive but inert screens or fabricated integrations.

Your instructions are governed by **this entire repository**, not by the contents of this file alone. **Read `README_FIRST.md` first**, then read the 880-row requirements matrix, 45 module inventories, 172-decision register, 24-open-issue register, architecture, workflow, migration, security, testing, roadmap and state documents. Treat each file as a versioned input. Summarize your understanding and ambiguities before editing the repository.

**This prompt does not grant permission to change Production, spend funds, send external messages, provision paid accounts, post real financial entries or shut down Albtrix.** Such acts require explicit human authorization under the company's approval rules.

## 1. Integrity of source data — a strict gate
- `01_REQUIREMENTS/REQUIREMENTS_MATRIX.csv` contains **880 indexed scope entries** sourced from **45 confirmed topics**, but **not all original statements have been verbatim verified**. T01–T31 are normalized from conversation summaries; T32–T45 are normalized from direct user confirmations. These rows must **never** be described as 880 source-verbatim requirements fully audited against transcripts.
- Preserve every stable `REQ-Txx-yy` ID, original wording when supplied, original topic and source grade. Where an original confirmation is unavailable, mark `SOURCE_VERIFICATION_PENDING` and request the original transcript if necessary for acceptance.
- Audit duplicates and overlapping concepts; introduce one canonical implementation rule when appropriate but maintain **many-to-one trace links** from original IDs. Do not delete or silently merge requirements.
- `02_DECISIONS/DECISION_REGISTER.csv` holds **172 registered decisions**. An instruction such as 'accountant will decide' is a **confirmed deferral**, not a confirmed accounting method.
- `02_DECISIONS/OPEN_ISSUES.csv` holds **24 known unresolved items**. Inspect all inputs for additional unresolved details; 24 is **not** a guarantee that the list is exhaustive.
- Create and maintain a traceability matrix linking each requirement to user source, module(s), design, API/domain model, migration implications, security rules, code commit, tests, test execution results and acceptance signoff. Initially these links are **not complete**.

## 2. Business-critical principles and non-negotiable scope
1. **One shared ERP:** branches, finance, operations, sales, procurement, stock, HR, reporting and AI within a coherent application. Shared identity, permissions, database, navigation and standardized service contracts; not multiple uncoordinated products.
2. **Complete Albtrix replacement:** historical data and active balances migrated as available from verified exports; reconcile source to target. All modules and critical processes must be ready **before** Production go-live. Never propose a partial/live MVP in conflict with this decision.
3. **Single coordinated go-live:** Prizren and Prishtina activate **simultaneously** with one explicit cutoff and consistent official system of record. Test each branch separately and company-wide first.
4. **Financial truth:** ledger entries must balance; cash increases only upon a real cash receipt; financial and payroll postings are immutable after confirmation/period closure, corrected through controlled reversing/corrective entries. No silent deletes or period rewriting.
5. **Inventory truth:** physical stock is reduced at the actual dispatch event with a document; **negative physical stock is forbidden**. Orders can show an outstanding shortage but not create negative movements. Transfers are `DISPATCHED → IN_TRANSIT → RECEIVED`, with both branch parties confirming and differences investigated.
6. **Tile specifics:** base UOM determined **per item**; conversions m²/box/piece based on real packaging. Allow partial boxes only for products whose pack/physical controls support it. Track shade, caliber and lot where applicable. Default block incompatible shade/caliber mixing; documented exception approval.
7. **Approvals & segregation:** independent approval of risky actions, bank-account changes, refunds, price/discount exceptions, period closes, transfers, payroll and access permissions. Authorization may be scoped to branch/role/action and thresholds. No self-approval when four-eyes required.
8. **Confidentiality:** salaries, private employee data, client information and ledger/cost data are restricted by least privilege. AI assistance must obey identical restrictions.
9. **Human-approved rules:** unknown legal structure, VAT schedules, payroll tax parameters, inventory valuation, COGS timing, fiscal provider and accounting framework are **not** to be invented. Design configurable structures but block final policy-dependent posting until professionally approved.
10. **Owner control:** Temaj Qeramike retains source code, design artifacts, Git history, deployment accounts, data, keys (with secure custody), documentation and exit options; third-party license obligations must be respected.

## 3. Technology baseline — approved and undecided items
**Approved:**
- Backend: **NestJS + strict TypeScript**.
- Frontend: **Next.js + React + strict TypeScript**, Albanian-language UI, accessible and fully responsive.
- **PWA** for mobile; offline only controlled drafts. Server connection mandatory to confirm financial events.
- **PostgreSQL** as central relational transactional database.
- Initial **modular monolith** with bounded contexts, shared infrastructure and explicit domain contracts; extract services only after demonstrated need.
- **Development, Staging, Production** are separate environments.
- Secure REST API + event webhooks, idempotency for financial and external actions, transactional outbox, asynchronous jobs with retry/dead-letter handling.

**Not yet chosen:** ORM/data-access tool; cloud provider and region; identity provider; existing DNS manager/subdomain; payment, fiscal, email, SMS and WhatsApp integration providers. Produce an explicit selection ADR and approval request; never present a default as an approved choice.

Architect domain modules, for example: Identity/Organization; Customers/CRM; Sales/Pricing; Inventory/Warehouse; Procurement/Imports; Delivery/Transport; Cash/Bank/POS; Accounting/Tax; HR/Payroll; Projects; Expenses/Budget/Financing; Assets; Documents/Claims/Tasks; Reporting/KPIs; Integration Hub; Notifications/Automation; AI Assistant; Administration; Support and Audit. Boundaries may be refined with rationale, but **do not drop source scope**.

## 4. Database and ledger rules
- Use normalized tables with documented FK/unique/check constraints and safe migrations. Monetary amounts must use **fixed precision decimal**; do not use binary floating-point for money. Define precision/rounding in approved policy.
- Journal entries must include debit and credit lines, immutable posting identity and branch/legal-entity analytical dimensions as appropriate. Reject unbalanced or partially posted transactions.
- A sales event can create multiple related financial and inventory entries at different legally/operationally meaningful stages. Use short ACID transactions for atomic sets; do **not** hold one database transaction open through shipping, external gateway calls or background jobs.
- Concurrency control must prevent double stock allocation, duplicate invoices, duplicate payment capture and lost updates. Use database constraints, idempotency keys and appropriate optimistic/pessimistic locks.
- Every fiscal document and posting needs source reference, timestamps, initiator, approver, reversal/correction reference where relevant and branch scope.
- Preserve approved report snapshots and original period data; corrections after close need a controlled workflow and link to the closed period while respecting approved accounting policy.
- VAT, fiscalization, balance-sheet presentation, depreciation and payroll calculations are subject to **Kosovo-specific independent validation** and professional signoff. Tax report preparation is **not** automatic official filing unless a documented authorized interface supports it.

## 5. Key operational behavior
- Sales: quotes, customer orders, reservations, pricing/discount/credit rules, mixed or partial payments, dispatch, returns/refunds, fiscal documents, accounting. Debt-aging, credit limits and manager approval required for exceptions. Do not mix external sales with intra-entity branch transfers.
- Purchases: requisitions, RFQs, approvals, supplier POs, partial goods receipts, **three-way matching** PO/receipt/invoice, tolerance and discrepancy case handling, suppliers' payments and returns.
- Imports/landed cost: per-shipment documents and typed charges; allocate by approved rule (value/weight/volume/quantity etc), separate recoverable taxes from capitalizable costs, provisionally value incomplete receipts with later reconciliation. Late costs after sales await accountant approval.
- Warehouses: location hierarchy, barcode/QR, lot/shade/caliber, cycle counts, damaged quarantine and approvals, in-transit branch transfer, no negative physical stock.
- Finance: daily cash close, bank matching, independent transfer acknowledgments, suspense/unallocated receipts, salary and employee advance settlement, loan schedules, monthly close and consolidated/branch reports under legal-entity constraints.
- HR: role-scoped private personnel records, contracts, schedule/leave, payroll, benefits/bonuses, employee advances and offsets. **Critical example**: employee receives EUR 200 cash advance and later earns four EUR 50 bonuses used as offsets. Net advance becomes zero; **there is NO EUR 200 new cash receipt** during those four offsets.
- The temaj.eu e-commerce website is a **separate website to integrate** with the ERP through tested APIs. Its integrated modules (Shop, Architects Pro, Studio, Business, Projects, samples, visualizer) must not be confused with duplicating the e-commerce website inside the ERP.
- AI: queries must use authorized data and reproducible source-backed calculations. AI can draft/report/suggest but cannot autonomously post, approve, bypass accounting gates, modify final tax rules or reveal restricted data. Mark forecasts as estimates with assumptions.

## 6. Existing-source data migration
Albtrix currently uses an online database and supports **Excel/CSV exports**, but the actual schemas and complete export availability remain unverified. Do not invent API or database access. Analyze genuine sample exports first. Create versioned mapping, source ID crosswalk, data-quality/quarantine reports, import idempotency, and documented reconciliation per branch, bank, till, customer, supplier, employee, UOM, stock lot, document and GL.

Migrate **all available history**, including attachments if exportable; otherwise document gaps and preserve an original-source read-only search archive. Run repeatable rehearsal migrations and compare multiple periods. Define cutoff; freeze Albtrix in a controlled manner; import final deltas or conduct controlled re-import depending on verified capabilities; reconcile; obtain accountant/management signoffs. Maintain rollback/continuity plan. **Never write into both official systems for the same event without a verified safe synchronization mechanism.**

## 7. Security, resilience and cloud
- Security/availability are higher priorities than minimizing infrastructure spend. Compare providers with evidenced capacity, regional compliance, disaster recovery, cost and vendor exit strategy; do not silently buy/provision.
- Target **RPO ≤ 5 minutes** and **RTO ≤ 1 hour** with HA, PostgreSQL replica/failover, encrypted offsite immutable backups, separate key management, periodic recovery drills at least quarterly and after major changes, and alerting. Targets are **not guarantees** until load and recovery tested.
- Principle of least privilege, account lifecycle, MFA/2FA, time-bound vendor access, revocable sessions, step-up authentication, audit trails resistant to manipulation, encryption in transit/at rest, KMS and rotation.
- Separate environments and tenant-like branch scoping; do not copy raw personal data to development. Use synthetic/anonymized tests. Mock integration endpoints **only Dev/Staging**.
- Incident runbooks cover triage, evidence preservation, internal/legal notifications, containment, recovery, postmortem, reconciliations, and controlled operating fallback.
- Manage operational budget/alerts and monthly cloud reporting. Do not allow cost caps to automatically terminate critical finance systems.

## 8. Required sequence BEFORE coding
Your **first delivery must be a documentary engineering audit**, not generated UI screens:
1. Verify all 880 source slots and available source evidence; report labels that cannot be verified verbatim. Request the original transcript/export where needed for full signoff.
2. Deduplicate semantically without losing originating IDs; identify contradictions and missing acceptance criteria. Create one canonical requirements graph, trace source IDs to implementation IDs.
3. Reconcile 172 decision entries, distinguish selected policies from explicitly deferred decisions, and preserve all 24 open issues. Do not mark any closed without evidence.
4. Produce an **ADR** for remaining technical options (ORM, provider, authentication, integrations). Expose unresolved questions rather than deciding silently.
5. Produce module dependency graph and phased implementation plan consistent with **all modules before go-live**.
6. Propose DB schema/ERDs, module boundaries, REST/OpenAPI contracts, event/outbox schemas, roles/approval matrix, migration map, and threat model. Label proposals as provisional until approved.
7. Define individual test cases/acceptance criteria; link every source ID. Create a verifiable backlog ordered by dependencies.
8. Present a concise approvals dashboard (design blockers / implementation blockers / only go-live blockers); request professional review for legal/tax/accounting unknowns.
9. Only then implement independently scoped modules in planned stages and submit actual, reproducible test proof.

## 9. Phased delivery plan and no partial go-live
Phase 1 foundation/security; Phase 2 accounting/finance; Phase 3 sales/invoicing; Phase 4 inventory/products; Phase 5 operations (logistics/projects/CRM/claims/tasks); Phase 6 employees/HR/payroll; Phase 7 reporting/KPIs/budgets; Phase 8 integrations; Phase 9 AI. **Dependencies may require substeps in a different technical sequence; document them.** Migration, testing, documentation, security and observability run throughout all phases.

**No Production activation** until ALL requested modules are functionally complete, audited, tested; all legal/accounting/design go-live blockers are closed; genuine external integrations are verified or formally accepted as a documented compliant alternative; Albtrix history/current balances are reconciled; two-branch pilot and payroll/finance checks pass; directors formally authorize **simultaneous Prizren + Prishtina cutover**.

## 10. Definition of done, code quality and evidence
Use Git owned by Temaj, PR/code reviews, strict typing, automated lint/static/security/dependency scans, unit/integration/E2E/regression/financial-invariant tests, load/concurrency checks, recoverability exercises, CI and gated CD with safe migration/rollback. Never claim a test passed unless it was run and a reproducible record exists. Never call a placeholder/mock a feature implemented.

For **each module**, report:
- Requirement IDs covered; code paths/commits/migrations; feature demo URL in Staging where applicable.
- Authorization matrix, source data/branch scope, outbox/API contract changes.
- Test case IDs, commands actually executed, test date, result (pass/fail/not run), defects and screenshots/log artifacts where permitted.
- Open issues and blockers by class, owner, evidence required and disposition.
- Approval decision (accepted / changes requested / blocked).

Deliver **English** engineering specifications and **Albanian** end-user UI and role-specific guides. Do not expose secrets, private employee salaries or customer identifiers in documentation/demos. Provide install/deployment/runbook, company-controlled Git/cloud handover and license inventory.

## 11. Mandatory output for your FIRST RESPONSE to this prompt
Do **not** generate the entire application or claim it is complete. Produce:
1. Acknowledged repository inventory and provenance warnings.
2. An audit plan for all 880 requirements with estimated evidence collection approach **but without arbitrary deadlines**.
3. Confirmed vs deferred decision summary; 24 open-issue matrix with blockers and responsible approval roles.
4. Module boundary/dependency proposal and first implementation backlog, explicitly honoring zero partial go-live.
5. Prioritized professional approval requests; no tax/accounting guesses.
6. Exact next artifacts and acceptance criteria; identify which work can safely start on synthetic data.

After approvals, continue module-by-module, preserving durable state in `09_PROJECT_PROGRESS/`, with no hidden changes to confirmed scope.
