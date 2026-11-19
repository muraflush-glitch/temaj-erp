# Integration contracts and source-of-truth decisions (PROPOSED)

| Integration | Proposed ownership | Minimum technical test | Known blocker |
|---|---|---|---|
| temaj.eu Shop | Website captures checkout/order; ERP validates & owns financially posted sale, inventory and fulfillment status | Signed event, idempotent order import, stock update, return/refund and conflict replay | OPEN-16, OPEN-17 |
| temaj.eu Architects Pro / Projects / Business / samples | Portal originates professional requests, quotations, project material lists; ERP validates commerce and stock | Permissions, account mapping, quote version, project crosswalk | OPEN-17 |
| Banks | Bank/approved source owns bank statement; ERP owns reconciliation and finance journal | Real sample statement import, duplicate handling and unmatched receipt | OPEN-14 |
| POS terminals | Bank/provider owns transaction confirmation; ERP stores provider token/reference and reconciliation | Settlement/fee/refund handling, no duplicate receipt | OPEN-15 |
| Online payment gateway | Provider owns authorization/settlement; ERP owns order/payment allocation | webhook signature, replay, partial capture/refund, settlement matching | OPEN-16 |
| Fiscalization | Authorized provider/device is legal source; ERP initiates approved fiscal flow and captures evidence | Legal approval and actual fiscal device/provider integration | OPEN-09 |
| Email | Authorized sender with DKIM/SPF/DMARC where supported | Delivery success/failure and opt-out/permissions | OPEN-18 |
| SMS / WhatsApp | Authorized provider and number; templates per service rules | Validated templates, opt-in, delivery callbacks and rate limits | OPEN-19 |
| Barcode/QR printers/scanners | ERP sends print/scan instructions to supported devices | Verified physical scanning and exact SKU/lot/label | OPEN-20 |
| Albtrix Excel/CSV | Albtrix export snapshots are immutable source of historical mapping; target import is new ERP | Sample parsing, import idempotency, total reconciliation and source ID crosswalk | OPEN-21 plus mapping inspection |

**Required safeguards**: API versions; OAuth/service authorization as applicable; mTLS where appropriate; webhook signing; request/response schema validation; timestamps; retries with exponential backoff; dead-letter queue; circuit breaker; idempotency and a reconciliation dashboard; privacy policies; explicit data residency and retention decision.

No provider, exact API method, fiscal status, bank link or live order integration may be claimed until supported by real vendor docs and witnessed tests. Where a vendor lacks an API, offer a documented file-based workflow without claiming 'real-time sync'.
