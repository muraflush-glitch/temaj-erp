# Temaj ERP — system architecture baseline (PROPOSED)

## Status / ADRs
Approved: NestJS/TypeScript; Next.js/React/TypeScript; PostgreSQL; modular monolith; PWA; three isolated cloud environments; REST/Webhooks; shared app for Prizren + Prishtina. Unresolved: ORM, cloud provider/region, identity vendor, fiscal device/provider, payment gateway and messaging providers. These need separate decision records; **do not implement a vendor integration against imaginary APIs**.

## Logical topology
```text
Responsive browser / PWA (Albanian UI; accessible; role aware)
          |
      TLS / WAF / rate limits
          |
    Next.js frontend (no monetary trust decisions here)
          |
   NestJS API and background job endpoints
          |
  Identity and policy enforcement (RBAC + contextual ABAC)
          |
  +---------------------------------------------+
  | Modular monolith: bounded contexts         |
  | org/branch, party/CRM, product/warehouse,  |
  | sales/pricing, procurement/imports,        |
  | payments/cash/bank, ledger/tax, HR/payroll,|
  | projects/logistics, reporting/assets,      |
  | support/docs, notifications, AI, audit     |
  +---------------------------------------------+
          |                   |
       PostgreSQL       Outbox + queue/worker
          |                   |
       PITR/replica       adapter contracts / webhook delivery
                              |
             temaj.eu / bank/POS/fiscal / email/SMS/WhatsApp
```

## Architectural boundaries
- Each business module owns its domain commands, validation and persistence responsibilities; do not permit cross-module direct writes that violate invariants. Use explicit APIs/events.
- Distinguish `Branch` (internal organizational dimension) from `LegalEntity` (tax/accounting reporting entity). Legal structure is OPEN-01; no permanent account architecture based on an unverified assumption.
- Use exact-permission rules: `view`, `create`, `edit`, `confirm`, `cancel`, `approve`, `export` per resource and branch scope. Confirm approvals against immutable document version/hash; material changes invalidate the approval.
- Maintain consistent `CorrelationId`, `ActorId`, `BranchId`, `SourceDocumentId`, legal entity where appropriate, timestamps and idempotency keys.
- Do not use an AI model as a source of truth for financial math; AI only reads authorized projections and gives sourced insights.

## Concurrency and resilience
- Short ACID transactions per atomic business command; external gateways operate outside DB transactions with outbox/saga state, retry and reconciliation.
- Unique indexes for business identity, source IDs, payment provider event IDs and idempotency keys. Lock/transactionally allocate available stock.
- Durable job execution with error budgets, dead-letter quarantine, manual replay and observable success/failure metrics.
- A Payment authorized/settled by external provider is not automatically a customer CashReceipt until provider confirmation/matching meets the approved rule.
- Full migration rollback (especially schema) must be staged and data-preserving; backwards-compatible migrations, expand/migrate/contract and backups are preferred.

## API design baseline
- Versioned `/api/v1/` REST APIs with OpenAPI, consistent error envelope, pagination/filtering and per-operation permissions.
- Webhook events include unique event ID, payload schema/version, timestamp, logical source, signature and idempotent consumer behavior.
- Synchronization ownership matrix needs professional confirmation: ERP is proposed system of record for inventory/financial posting, while temaj.eu is an order capture frontend. Confirm field-level ownership before enabling any live two-way sync.
- Import/export and bulk action APIs support dry-run, validation reports, audit logs, resume/retry and scoped authorization.

## Documentation that is still required before code signoff
Final ERD, migration scripts, role/action/branch matrix, API/OpenAPI contracts, event schema registry, state transition diagrams, threat model, production runbooks, approved design ADRs and data retention table.
