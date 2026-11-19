# Albtrix → Temaj ERP migration & coordinated cutover

## Confirmed facts vs unknowns
Known: Albtrix is current software with an online DB; export via **Excel/CSV**. User requires migration of all available customer/supplier/product/stock/staff/transaction history, active balances and relevant attachments; pilot and rehearsal migrations; **both branches activate together only after all modules are finished**.

Unknown: actual export sheets/column names, schema completeness, document attachment availability, stable source IDs, fiscal integrations, historic shade/lot detail, bank/POS export formats, legal entity ownership. **Do not fill unknowns with guesses.**

## Technical stages
1. **Discovery and immutable source capture**: receive sample exports from authorized Albtrix user; record file name, date, SHA-256, source report period, owner, row counts, encoding/decimal/date formats and branch. Make backup of original files.
2. **Profile and classify**: columns/primary keys, duplicate IDs, nulls, UOM, currencies, ledger codes, branch membership, transactions and status semantics.
3. **Propose mapping**: source→target field matrix, transformation rules, version, valid-from date, reference lookup, category and signed owner. Keep an explicit `external_mapping` table for crosswalks and original codes.
4. **Build idempotent staging loader**: file batch ID, import run ID, row-level hash, validation/quarantine reasons, ability to rerun. Never directly write raw unvalidated Excel rows into live postings.
5. **Dependency-ordered imports**: legal entities/branches (once verified), identity master, parties, products/UOM/lot, warehouse balances, documents, partial allocations, advances, bank/cash, journals, historical links and snapshots.
6. **Reconcile**: per-depot SKU/lot/shade quantities, customer/supplier open items and aging, cash/bank balances, tax and journal totals, payroll advances, legal entity/branch balances, report by fiscal period. Compare to source totals **and** independent accountant-reviewed trial balance.
7. **Multiple rehearsal runs**: controlled sample and full-size staging, measure counts/timing/errors, replay same file twice and prove no duplicates, test rollback and restoration, preserve exception reports.
8. **Cutover rehearsal**: final export strategy including source changes since last test, freeze/access planning, user training, communication, downtime and rollback triggers.
9. **Official cutover**: after all modules accepted, choose signed timestamp, freeze Albtrix, capture final exports and delta or controlled full import, verify checksums and totals, accountant/branch manager/management signoff. Activate both Prizren and Prishtina in a single coordinated event, with clear official source of truth.
10. **Post-cutover**: enhanced monitoring, compare first cash closes, inventory and GL balances; investigate discrepancies without silently editing original records. Maintain read-only searchable Albtrix archive and controlled access.

## Hard blockers before official import
- Real source exports and attachment inventories obtained; report unmapped fields (`OPEN-21`).
- Legal entity structure resolved (`OPEN-01`).
- Chart of accounts, inventory valuation, COGS timing, VAT and payroll opening balances reviewed by appointed accountant (`OPEN-02` to `OPEN-10`).
- Both branches' warehouse location mapping and equipment verified (`OPEN-20`, `OPEN-22`).
- Last-run reconciliation records zero unexplained critical differences; signoffs attached.

## Reconciliation report design
Per batch and category: source row count, target count, rejected count, duplicates, source sum, target sum, currency, UOM, branch, variance, tolerance, explanation, owner, resolved flag, approval and artifact links. 'No variance' should be verified across both quantity and value dimensions, not merely total records.

## Rollback
Document the exact replay/switch-back method with reconciliation and ownership of transactions entered near cutover. A 'restore an old backup' command is **not sufficient** when live payments or fiscal documents have already been issued. Such records require a legally and operationally sound recovery plan.
