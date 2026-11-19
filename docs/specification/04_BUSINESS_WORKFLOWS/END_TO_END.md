# Priority end-to-end workflows — starting acceptance cases

These flows are representative high-risk tests, not the complete suite for 880 requirement IDs. Each workflow must be expanded into positive, negative, permissions, concurrency, replay, audit and rollback cases. IDs below are scenario IDs, NOT substitutes for requirement IDs.

### WF-01: Cash sale with tile dispatch, single branch
Authorized salesperson creates quote/order with product packaging UOM; confirms price/discount threshold and credit; reserves lot/shade; cashier collects real cash/POS with provider proof; dispatch worker physically releases stock; invoice/fiscal document is generated under verified legal rules; accounting postings occur at the approved points. Verify cash till balance = actual money; stock decreases on dispatch, no negative lot, VAT/COGS rules approved, no duplicate invoice/payment.

### WF-02: Sale with mixed and partial payments
One invoice is settled from customer advance + POS + bank + cash; outstanding receivable is automatically correct; overpayment remains customer credit (not uncontrolled income). Validate bank/POS unmatched entries, independent refunds, late payment reconciling and duplicate webhook replay.

### WF-03: Quote/order with stock shortage
A client order exceeds available stock. Preserve order with clearly documented outstanding shortage; do not create negative physical movement. Reservation of in-stock shade/lot occurs only under approved credit. Pending purchase and fulfillment plan are visible; no phantom dispatch.

### WF-04: Branch-to-branch transfer
Prizren initiates; manager approves if required; dispatched units move into `IN_TRANSIT`; Prishtina separately confirms goods receipt and any shortage/damage. Receiving stock is unavailable before acceptance. Intra-entity transfers cannot inflate total company sales.

### WF-05: Open boxes, UOM and shade mixing
Product-specific box/sqm/piece mapping with historically versioned factor; permit partial units only where product supports them; block mixing shades/calibers except documented authorized override. Use decimal area precision with controlled presentation rounding. Validate conversion reversibility for representative packaging examples.

### WF-06: Purchase order → goods receipt → supplier invoice
Authorized requisition/PO; delivery may be partial; physical receipt by authorized warehouse user; match PO/GRN/supplier invoice with approved tolerances. Damaged goods quarantine with photos and vendor claim; no creation of supplier liability for fictitious receipt.

### WF-07: Import with provisional landed costs
Goods received before complete freight/customs/insurance invoices; record provisional cost and shipment file. After invoices arrive, allocate by documented per-charge basis. Recoverable tax is separated from capitalized cost. If stock already sold, keep handling in pending policy `OPEN-08` until accountant signs off.

### WF-08: Cash advance offset by payroll bonuses — core regression
A staff member receives EUR 200 genuine advance paid **once** out of the cash till. Four monthly bonuses of EUR 50 are earned and, with documented agreement and approval, applied to reduce advance balance 200→150→100→50→0. **No new EUR 200 cash receipt exists**; salary/bonus payable and advance receivable offset entries reflect actual noncash settlement, subject to verified payroll/tax policy. Cash reconciliation remains unchanged after each noncash offset.

### WF-09: Payroll with partial payment and period lock
Prepare payroll by HR/finance, calculate approved amounts, track absence/overtime and taxes per verified rules. Independent approver signs; pay by bank/cash (where legally permitted) in parts, keep payable outstanding. A return or bonus correction after lock is posted in subsequent authorized adjustment with original preserved.

### WF-10: Month-end close and interbranch reporting
Reconcile till, bank, supplier/customer subledgers, inventory valuation and GL; allocate shared costs by approved basis; snapshot approved branch and company reports; mark closed period immutable. Subsequent correction is recorded with reversal and audit trail, not editing the closed snapshot.

### WF-11: Sensitive authorization change and payment approval
Changing supplier bank account, credit limit, or disallowed role triggers independent verification, versioned history, approval request with content hash. Requester cannot approve themselves; changed values after approval invalidate that approval; emergency access logs and later review do not bypass high-risk segregation.

### WF-12: Website order twice due to webhook retries
Receive identical `order_created` event twice from temaj.eu. Same external ID/idempotency key maps to exactly one local order, one reservation and no duplicate financial posting. A failed sync is retryable with bounded attempts, dead-letter record, audit and manual replay.

### WF-13: Interrupted session during posting
Client loses internet after submitting payment/dispatch command. Server may have committed; client must query idempotency status rather than blindly resubmit. No duplicate receipt, no double stock deduction. Offline drafts are clearly marked unposted and cannot confirm financial actions offline.

### WF-14: Historical Albtrix trial migration
Load customers, suppliers, open invoices, payments, advances and full available transaction history with source IDs; import batch can be replayed without duplication. Quarantine bad rows; validate amounts and branch/warehouse/lot balances against source reports. Never mark import 'reconciled' unless differences are zero or formally accounted/approved with criticality gate.

### WF-15: Final two-branch cutover
Both branches complete training/UAT; all 9 phases and critical integrations verified; accountant signs opening balances; define a single cutoff and freeze Albtrix; import final validated changes; obtain director signoff; activate **Prizren and Prishtina simultaneously**; monitor for mismatch and use controlled contingency when needed.

### WF-16: Complaint, return and refund
Customer complaint references source invoice/order and shade/lot; separate damaged quarantine stock; financial credit note/refund requires independent approval and legitimate document workflow. Prevent same item returned/refunded twice; report impact on prior salesperson commissions and cost.

### WF-17: Project order with partial site delivery
One customer has multiple site projects with floor/apartment/room hierarchies; BOQ, material reservations, staged delivery and costs tracked by project. Partial delivery affects actual stock on dispatch, not just quotation; trace project receivables and profitability without double counting shared expenses.

### WF-18: AI answers from authoritative data
An authorized director asks: 'Compare branch sales and margin this month'. AI queries only authorized accounting metrics and explains source transactions/formulas and date window; does not invent unsupported results. A branch staff user asking for other branches' salaries receives denial. No AI-initiated unapproved refunds or invoices.
