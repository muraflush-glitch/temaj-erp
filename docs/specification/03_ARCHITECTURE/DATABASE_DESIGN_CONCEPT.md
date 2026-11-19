# Database and data-integrity design (CONCEPT ONLY)

PostgreSQL is approved; exact tables, constraints, index design and ORM are **pending engineering audit and legal-entity review**. The following is a proposed object map, NOT final DDL.

| Domain | Example entities | Critical constraints |
|---|---|---|
| Organization | `legal_entity`, `branch`, `warehouse`, `storage_location`, `staff_membership` | branch belongs to approved legal entity; archived status ≠ hard deletion |
| Identity | `user`, `role`, `permission`, `role_assignment`, `approval_policy`, `approval_request` | branch-scoped permissions; approvals cannot self-approve restricted actions |
| Parties | `party`, `customer_account`, `supplier_account`, `contact`, `contract` | stable source import mapping; avoid silent deduplication |
| Products | `product`, `uom`, `product_packaging`, `barcode`, `lot_shade_caliber` | versioned UOM factors and product-specific allow_partial_pack |
| Stock | `stock_movement`, `stock_reservation`, `transfer`, `transfer_receipt`, `stock_count`, `quarantine` | no negative committed physical stock; receipt idempotent; lot-scoped movement |
| Sales | `quote`, `sales_order`, `sales_order_line`, `invoice`, `invoice_line`, `dispatch`, `return`, `credit_note` | unique document sequence; state transitions and irreversible confirmed records |
| Money | `cash_till`, `cash_session`, `bank_account`, `payment`, `payment_allocation`, `refund`, `cash_transfer` | no phantom cash receipts; partial allocations reconciled; approval evidence |
| Procurement | `purchase_request`, `purchase_order`, `goods_receipt`, `supplier_invoice`, `landed_cost_batch`, `supplier_return` | PO/receipt/invoice discrepancies auditable; cost method approved |
| Accounting | `account`, `fiscal_period`, `journal_entry`, `journal_line`, `exchange_rate`, `tax_rule`, `report_snapshot` | balanced debits/credits; period lock; immutable postings; versioned rate rules |
| HR | `employee`, `employment_contract`, `payroll_run`, `payroll_line`, `employee_advance`, `advance_offset`, `leave`, `shift` | salary privacy; approval segregation; advance offset never cash inflow |
| Operations | `project`, `shipment`, `vehicle`, `claim`, `task`, `asset` | authorized state changes with links to source documents |
| Documents | `document`, `document_version`, `attachment`, `retention_policy`, `signature` | access restriction, content hashes and retention enforcement |
| Integration | `external_mapping`, `integration_event`, `outbox_event`, `webhook_delivery`, `import_run`, `import_exception` | stable source ID, idempotent retry, durable event delivery |
| Audit/support | `audit_event`, `support_ticket`, `incident`, `risk_event` | immutable or tamper-evident, retain actor, context and reasons |

## Mandatory accounting invariant
For every posted journal entry `E`, sum(`debit(E)`) = sum(`credit(E)`) **in the accounting currency**, under approved rounding rules. This invariant must be enforced transactionally and tested, not merely rendered in a report.

## Mandatory money/stock invariant
A noncash employee bonus offset **does not increase any cash account**. An internal stock transfer **does not create external group revenue**. Goods `IN_TRANSIT` are not counted as physically available in the receiving branch. A confirmed `DISPATCH` cannot consume more available lot-specific stock than actually exists.

## Record lifecycle / audit
Use draft → submitted → approved → confirmed/posted → corrected (through reversal) states, with activity history. No direct edits to posted entries; no orphaned stock movements or payment allocations. Closed periods retain original reports and signoffs.

## Design blockers from OPEN issues
`OPEN-01` legal entities, `OPEN-03` valuation method, `OPEN-04` COGS timing, `OPEN-05` chart of accounts, `OPEN-06` VAT, `OPEN-07` payroll tax, `OPEN-08` late landed costs, `OPEN-10` reporting/depreciation. Finish extensible schemas where safe; hold irreversible accounting logic until professional signoff.
