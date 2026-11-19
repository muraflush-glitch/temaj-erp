# Dependency-ordered phased engineering roadmap

**IMPORTANT:** These are phases of engineering, not sequential go-live releases. All modules must be tested and complete before the ONE coordinated Production activation of Prizren and Prishtina.

| Phase | Workstream | Deliverables and gates |
|---:|---|---|
| 0 | Source audit (pre-code) | Verify 880-row source mapping, dedupe, 172 decisions, 24 issues, ADRs, code/release policy, test cases. Audit is required and currently unfinished. |
| 1 | Foundations / Security | NestJS + Next.js, PostgreSQL schema/migrations, identity abstraction, roles, branches, permissions, approvals, documents, audit, CI and Dev/Staging. Legal entity dimension remains configurable pending `OPEN-01`. |
| 2 | Accounting / Finance | GL, cash/bank, AR/AP, expenses, loans, period controls, financial reports; obtain professional approvals for valuation/COGS/tax/chart before final calculations. |
| 3 | Sales / Invoicing | CRM parties, quotations, pricing, orders, invoices, mixed/partial receipts, returns/refunds, fiscal adapter, credit/discount approvals. |
| 4 | Inventory / Product | UOM, box/piece/m², lot/shade/caliber, warehouse locations, cycle counting, transfer transit, purchasing, landed cost. |
| 5 | Operations | Transportation, projects, claims, contracts/docs, CRM, tasks, assets, budgets, logistics and configurable workflows. |
| 6 | People / HR | Employee records/contracts, schedules, leave, payroll, advances/bonuses, payroll approval, privacy; validate payroll tax rules. |
| 7 | Reporting / Direction | KPI dashboard, controlled consolidation, custom reports, revenue/budget scenarios, alerts, report snapshots. |
| 8 | External integrations | temaj.eu Shop/Business/Architects Pro/Projects, samples, bank/pos/fiscal, messaging; real adapters tested against documented providers, fallback file import where appropriate. |
| 9 | AI | Human-controlled assistant, permission-constrained retrieval, grounded finance explanations, document extraction, fraud anomalies and forecasts. |
| 10 | System validation / cutover | Full import/reconciliation, cross-module regression, 50-concurrent load, RPO/RTO drills, UAT and training, coordinated two-branch go-live only with formal signoff. |

**Cross-cutting tracks in all phases:** Albtrix mapping/migration rehearsal; security; availability; observability; documentation and module acceptance; regression tests; Dev/Staging/Production gating; approved cost estimates and external vendor due diligence.

## First safe engineering backlog (no real financial transactions)
1. Build ADR inventory and review unresolved environment and ORM choices.
2. Produce domain boundary diagrams, role/permission matrix and legal entity abstraction.
3. Set up company-controlled private Git, CI, strict TS, test harness, Dev/Staging infrastructure (only after owner authorization for accounts/costs).
4. Implement versioned audit mechanism, policy enforcement and stable ID/outbox patterns with synthetic data.
5. Propose normalized product/UOM/shade/lot model with simulated stock, zero negative stock behavior, import staging validation.
6. Build no-real-provider integration adapters and mock-only test harness in Dev/Staging.
7. Prepare accountant review pack for unresolved finance policies; do not silently finalize ledger posting rules.

## Reporting to the company
For each workstream: status, requirement IDs, decisions, open blockers, code commit hashes, migration names, actual test logs, defects, costs/risks, acceptance signature and next items. Maintain this in `09_PROJECT_PROGRESS/` after every phase.
