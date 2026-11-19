# Decisions and open issues — how to interpret the registers

- `DECISION_REGISTER.csv`: **172 entries** across groups 46–55, 58–59. The IDs are stable within this draft. A decision to *defer to the accountant*, *compare providers*, or *inspect source exports* is a confirmed **deferment**, NOT a selected technical or accounting rule.
- `OPEN_ISSUES.csv`: **24 `OPEN_UNVERIFIED` entries**, 10 accounting/legal and 14 operational/integration. All are OPEN. The proposed owner is a role, not an appointed person.
- Before final implementation, assign names/roles and evidence, resolve the issue and obtain signoff. Every decision rule should link to impacted requirement IDs, domain models and tests; the cross-links are pending a full source-by-source audit.
- Some decisions marked confirmed still require legal verification of detailed implementation (e.g., VAT effective dates, cash salary legality). Do not equate a design preference with proof of legal compliance.
- Never delete the original decision/issue history when superseded: add superseding ID, date, approver and migration impact.
