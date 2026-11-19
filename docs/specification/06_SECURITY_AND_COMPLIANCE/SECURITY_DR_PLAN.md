# Security, privacy, high availability & disaster recovery policy

## Confirmed objectives
- Maximum priority: correctness, confidentiality and availability, even at higher cost.
- **RPO target ≤5 min**, **RTO target ≤1 h**, which must be **proved by recovery tests** and sized provider service contracts; not warranties at specification stage.
- PostgreSQL replica, controlled failover, offsite **encrypted immutable** backups with isolated credentials; backup retention **daily/weekly/monthly/yearly** by approved policy. Restore drills **at least every 3 months and after critical changes**.
- Monitor services, queue, database, disk, backup success, replication lag, availability, error rate, p95/p99 latency, suspicious logins, changed payout/bank details, cash differences and failures.

## Access
Per-user MFA/2FA; granular RBAC and attribute checks by branch/role/entity/action/threshold; principle of least privilege; step-up authentication for sensitive operations; short-lived access for vendors; users are individually identifiable. Administrator access cannot bypass logged maker-checker logic for protected financial operations.

## Encryption / secrets
TLS, encrypted at rest, KMS-managed rotating keys with separate authorization and recovery plan. No secrets in Git, logs, screenshots or user-facing error messages; use managed secret storage. Protect backups from same-account credential compromise; consider separately managed retention policies and delete holds.

## Privacy
Use synthetic/anonymized data in Dev/Staging; guard payroll and medical HR documents; control export and privileged report access; audit sensitive read operations as appropriate. Jurisdiction-specific employee/customer data retention and cross-border transfers are **OPEN**, need professional review and documented legal basis. Do not automatically assume EU hosting meets Kosovo obligations.

## Incident response
Detect → classify → limit access/contain → preserve timestamps/log evidence → eradicate → recover from trusted state → reconcile cash/payments/stock/GL → document customer/legal notifications where applicable → postmortem and preventive changes. Define P1 incident ownership and enhanced post-cutover support.

## High availability and continuity
Multi-AZ/region policy only after legal/technical review; failover with writes fenced against split brain; transaction log replication and tested PITR; backup integrity checks; independent outbox replay safeguards. Controlled offline drafts do not become real cash/inventory/accounting entries until verified online server commit. No unapproved double entry during fallback.

## Security verification checklist
- Threat model and application penetration test by qualified party.
- Privilege escalation, IDOR, branch scoping, mass assignment, CSRF/XSS/SQL injection, brute force/rate limits.
- Sensitive payload log redaction and signed audit event protection.
- Backup tamper resistance and tested restore for relevant target point.
- Failed provider credentials/messaging permissions; incident alert tested.
- Vendor exit, license, keys and domain accounts belong to company.

## Open matters
Cloud provider/region, identity solution and document retention schedules are explicitly undecided; bank/POS/fiscal vendors remain unknown. Capture approval as formal ADR before connecting live systems.
