# Traceability, testing and acceptance strategy

## Truthfulness about coverage
`REQUIREMENTS_MATRIX.csv` has **880 source-index slots**. Test IDs and acceptance criteria currently show `TO_DEFINE` because an AI-generated generic claim would not constitute evidence of test coverage. A **complete traceability audit has NOT been executed**. Only count tests as 'covered' after a concrete test is written, run and linked to the requirement.

## Test layers
1. Unit: decimal math, tax calculation only after approved policies, UOM conversion, auth thresholds, state transitions, payroll advance offsets.
2. Integration: transaction boundaries with PostgreSQL, outbox delivery, filesystem object storage, document linking, double-entry atomicity, stock race conditions, ERP–website payload reconciliation.
3. End-to-end: cash sale, partial mixed payment, partial dispatch, return/refund, supplier purchase/receipt/invoice, staff payroll, monthly close, multi-branch stock transfer, CRM/project, fleet/claims/support.
4. Recovery: DB/PITR/replica failover, immutable backups, RPO/RTO evidence, queue dead-letter replay, changed DNS/identity secret rotation.
5. Security: branch-scoped RBAC/ABAC, salary privacy, maker-checker, approval invalidation on document change, vendor access expiry.
6. Performance: baseline targets of ~2 sec common pages, ~1 sec search, ~3 sec common commit, 50 concurrent users (these are targets, not guarantees); load/stress and realistic seeded volumes.
7. Migration: import source crosswalk checks, corrupted Excel/CSV, decimal separators, duplicate records, external key conflicts, full-history links, branch/lot/finance reconciliation.

## Mandatory property/invariant tests
- GL entry posts only when total debits equal total credits; multiple payment parts never create extra receivables/cash.
- Employee EUR 200 cash advance + four EUR 50 bonus offsets equals zero advance and zero **new cash receipt** from offsets.
- Confirmed financial entry immutable, closed period correction recorded as authorized reversal in the permitted period.
- Available stock never negative; concurrent dispatch/order cannot double-consume same lot.
- Branch transfer is staged in transit; receiving stock only after acknowledgment; intra-entity transfers not external sales.
- A webhook retry does not duplicate customer order, receipt, reservation, refund or fiscal event.
- Authorized staff member sees only assigned branches; a worker sees only their own payroll unless explicitly authorized.
- Import same Albtrix batch twice yields same source-mapping cardinality and no extra balances.
- Rollback/recovery yields a consistent state, followed by financial transaction reconciliation.

## Requirements trace template
| Field | Required evidence |
|---|---|
| `REQ-Txx-yy` | Original user text / topic / source confirmation |
| Owner & priority | Role-approved business owner, policy source |
| Design | Domain entity/ERD, API, permission and process state |
| Implementation | Git commit(s) and changed files |
| Test | Exact test case IDs and automated test code |
| Execution | Run command, environment, date, logs, pass/fail |
| Acceptance | Witness/signoff and defect disposition |

## Per-module gate
No module marked DONE unless UI + backend + persistence + validations + authorization + audit + integration events + tests + documentation are complete. Distinguish `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `STAGING_ACCEPTED` and `PRODUCTION_APPROVED`. Do not label full program production-ready during phased development.

## System-wide final gate
- All 45 topic inventories mapped to signed, deduplicated canonical implementations with zero unexplained source omissions.
- All 172 decision entries checked and all blocker-class open issues resolved with evidence; not all 24 may be resolution blockers for document drafting, but every Production-relevant blocker must close.
- All finance/payroll/tax policy calculations approved professionally.
- End-to-end flows and backup failover tested; migrations reconciled; staff trained and pilot approved.
- Both Prizren and Prishtina go live **simultaneously only after written management signoff**.
