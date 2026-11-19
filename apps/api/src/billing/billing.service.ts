import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from '../auth/permission.service';
import { DomainError, forbidden, notFound } from '../common/errors';
import { AuthUser } from '../common/request';
import { DB } from '../database/database.module';
import { Db, one, Tx, withTransaction } from '../database/db';
import { CashService } from '../cash/cash.service';
import { LedgerService } from '../ledger/ledger.service';

type Role = 'RECEIVABLE' | 'SALES_REVENUE' | 'VAT_OUTPUT' | 'CASH' | 'BANK' | 'CUSTOMER_ADVANCES';
const MONEY = /^\d{1,15}(\.\d{1,2})?$/;
const QTY = /^\d{1,15}(\.\d{1,4})?$/;
export const CREDIT_NOTE = 'sales.credit_note';

/** Production nuk niset sa kohë ka rregulla, llogari ose lidhje provizore (të pamiratuara nga kontabilisti). */
export async function assertNoProvisionalPolicies(pool: Pool): Promise<void> {
  const r = await pool.query<{ what: string; n: string }>(
    `SELECT 'rregulla (policy_setting)' AS what, count(*) AS n FROM policy_setting WHERE is_provisional
     UNION ALL SELECT 'lidhje llogarish (account_role)', count(*) FROM account_role WHERE is_provisional
     UNION ALL SELECT 'llogari kontabël', count(*) FROM ledger_account WHERE is_provisional`);
  const open = r.rows.filter((x) => Number(x.n) > 0).map((x) => `${x.n} ${x.what}`);
  if (open.length) throw new Error(`Production i bllokuar: ekzistojnë vlera provizore të pamiratuara — ${open.join('; ')}`);
}

/**
 * Faturimi dhe arkëtimet (PROVIZOR). Fatura krijohet vetëm për mallin e dorëzuar, regjistrohet në librin kryesor
 * në të njëjtin transaksion dhe nuk ndryshohet më. Arka/banka rritet vetëm kur regjistrohet një arkëtim real.
 */
@Injectable()
export class BillingService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly perms: PermissionService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly cash: CashService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    // Nota e kreditit (kthim malli ose korrigjim fature) lëshohet vetëm pas aprovimit nga një person tjetër.
    this.approvals.register(CREDIT_NOTE, {
      requestPermission: 'sales.credit_note.request',
      validate: async (tx, payload) => { await this.creditLines(tx, Number(payload['invoiceId']), payload['lines'] as { lineNo: number; qty: string }[]); },
      execute: async (tx, req) => { await this.issueCreditNote(tx, req.id, Number(req.requested_by), req.reason, req.payload); },
    });
  }

  /** Llogarit vlerat e kreditit për çdo rresht, në përpjesëtim me sasinë e kthyer; refuzon sasinë mbi të faturuarën. */
  private async creditLines(tx: Tx, invoiceId: number, lines: { lineNo: number; qty: string }[]) {
    if (!Array.isArray(lines) || lines.length === 0) throw new DomainError('VALIDATION', 'Duhet së paku një rresht');
    const out: { lineNo: number; qty: string; net: string; vat: string; orderLineNo: number; productId: string }[] = [];
    for (const l of lines) {
      if (!QTY.test(String(l.qty)) || /^0+(\.0+)?$/.test(String(l.qty))) throw new DomainError('VALIDATION', 'Sasia duhet të jetë numër dhjetor pozitiv');
      const r = await one<{ ok: boolean; net: string; vat: string; order_line_no: number; product_id: string }>(tx,
        `SELECT ($3::numeric <= il.qty - COALESCE((SELECT sum(c.qty) FROM credit_note_line c WHERE c.invoice_id = il.invoice_id AND c.invoice_line_no = il.line_no), 0)) AS ok,
                round(il.net * $3::numeric / il.qty, 2)::text AS net, round(il.vat * $3::numeric / il.qty, 2)::text AS vat, il.order_line_no, il.product_id
           FROM sales_invoice_line il WHERE il.invoice_id = $1 AND il.line_no = $2`, [invoiceId, l.lineNo, l.qty]);
      if (!r) throw notFound(`Rreshti ${l.lineNo} i faturës`);
      if (!r.ok) throw new DomainError('OVER_CREDIT', 'Sasia e kthyer nuk mund ta kalojë sasinë e faturuar (duke llogaritur kthimet e mëparshme)', 422);
      out.push({ lineNo: l.lineNo, qty: String(l.qty), net: r.net, vat: r.vat, orderLineNo: r.order_line_no, productId: r.product_id });
    }
    return out;
  }

  async requestCreditNote(actor: AuthUser, invoiceId: number, input: { lines: { lineNo: number; qty: string }[]; restock: boolean; reason: string; idempotencyKey: string }) {
    const inv = await one<{ branch_id: string }>(this.db, 'SELECT branch_id FROM sales_invoice WHERE id = $1', [invoiceId]);
    if (!inv) throw notFound('Fatura');
    // Leja kontrollohet para çdo gjëje tjetër, që pa leje të mos merret asnjë informacion mbi faturën.
    if (!(await this.perms.has(actor.id, 'sales.credit_note.request', Number(inv.branch_id)))) throw forbidden();
    const lines = await withTransaction(this.db, (tx) => this.creditLines(tx, invoiceId, input.lines));
    const total = await one<{ t: string }>(this.db, 'SELECT sum(x)::text AS t FROM unnest($1::numeric[]) AS t(x)', [lines.flatMap((l) => [l.net, l.vat])]);
    return this.approvals.request(actor, { actionCode: CREDIT_NOTE, branchId: Number(inv.branch_id), amount: total?.t ?? '0', reason: input.reason,
      idempotencyKey: input.idempotencyKey, payload: { invoiceId, lines: input.lines, restock: input.restock } });
  }

  private async issueCreditNote(tx: Tx, approvalRequestId: string, userId: number, reason: string, payload: Record<string, unknown>): Promise<void> {
    const invoiceId = Number(payload['invoiceId']); const restock = payload['restock'] === true;
    const inv = await one<{ legal_entity_id: string; customer_id: string; branch_id: string; order_id: string; warehouse_id: string; invoice_no: string; today: string }>(tx,
      `SELECT i.legal_entity_id, i.customer_id, i.branch_id, i.order_id, o.warehouse_id, i.invoice_no, to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today
         FROM sales_invoice i JOIN sales_order o ON o.id = i.order_id WHERE i.id = $1 FOR UPDATE OF i`, [invoiceId]);
    if (!inv) throw notFound('Fatura');
    const lines = await this.creditLines(tx, invoiceId, payload['lines'] as { lineNo: number; qty: string }[]);
    const tot = await one<{ net: string; vat: string; gross: string }>(tx,
      'SELECT sum(n)::text AS net, sum(v)::text AS vat, (sum(n) + sum(v))::text AS gross FROM unnest($1::numeric[], $2::numeric[]) AS t(n, v)', [lines.map((l) => l.net), lines.map((l) => l.vat)]);
    if (!tot) throw new Error('Totalet mungojnë');
    const entityId = Number(inv.legal_entity_id); const branchId = Number(inv.branch_id);
    const acc = await this.accounts(tx, entityId, ['RECEIVABLE', 'SALES_REVENUE', 'VAT_OUTPUT']);
    // Regjistrimi i kundërt i faturës, vetëm për pjesën e kredituar.
    const entryId = await this.ledger.postSystemEntry(tx, userId, {
      legalEntityId: entityId, entryDate: inv.today, description: `Notë krediti për faturën nr. ${inv.invoice_no}`, sourceType: 'CREDIT_NOTE', sourceRef: String(invoiceId),
      idempotencyKey: `credit-note:${approvalRequestId}`,
      lines: [
        { accountId: acc.SALES_REVENUE, branchId, debit: tot.net, credit: '0' },
        { accountId: acc.VAT_OUTPUT, branchId, debit: tot.vat, credit: '0' },
        { accountId: acc.RECEIVABLE, branchId, debit: '0', credit: tot.gross },
      ],
    });
    const cn = await one<{ id: string; credit_no: string }>(tx,
      `INSERT INTO credit_note(legal_entity_id, fiscal_year, invoice_id, customer_id, branch_id, credit_date, reason, restocked, net, vat, gross, journal_entry_id, approval_request_id, requested_by)
       VALUES ($1, 0, $2, $3, $4, $5::date, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11, $12, $13) RETURNING id, credit_no`,
      [entityId, invoiceId, inv.customer_id, branchId, inv.today, reason, restock, tot.net, tot.vat, tot.gross, entryId, approvalRequestId, userId]);
    for (const l of lines) {
      await tx.query('INSERT INTO credit_note_line(credit_note_id, invoice_id, invoice_line_no, qty, net, vat) VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric)', [cn?.id, invoiceId, l.lineNo, l.qty, l.net, l.vat]);
      if (restock) {
        // Malli i kthyer hyn në magazinën e porosisë, me të njëjtin lot.
        const ol = await one<{ lot_id: string | null }>(tx, 'SELECT lot_id FROM sales_order_line WHERE order_id = $1 AND line_no = $2', [inv.order_id, l.orderLineNo]);
        await tx.query(
          `INSERT INTO stock_movement(type, warehouse_id, product_id, lot_id, qty, document_ref, reason, created_by, idempotency_key)
           VALUES ('CUSTOMER_RETURN', $1, $2, $3, $4::numeric, $5, $6, $7, $8)`,
          [inv.warehouse_id, l.productId, ol?.lot_id ?? null, l.qty, `NK-${cn?.credit_no}`, reason, userId, `credit-note:${cn?.id}:${l.lineNo}`]);
      }
    }
    await this.audit.record(tx, { actorUserId: userId, action: 'sales.credit_note_issued', entityType: 'credit_note', entityId: cn?.id, branchId,
      details: { invoiceId, creditNo: Number(cn?.credit_no), gross: tot.gross, restock, approvalRequestId: Number(approvalRequestId) } });
  }

  private async accounts(tx: Tx, entityId: number, roles: Role[]): Promise<Record<Role, number>> {
    const r = await tx.query<{ role: Role; account_id: string }>('SELECT role, account_id FROM account_role WHERE legal_entity_id = $1 AND role = ANY($2)', [entityId, roles]);
    const out = {} as Record<Role, number>;
    for (const row of r.rows) out[row.role] = Number(row.account_id);
    for (const role of roles) if (!out[role]) throw new DomainError('ACCOUNT_ROLE_MISSING', `Mungon lidhja e llogarisë për rolin ${role}`, 422);
    return out;
  }

  async vatRate(q: Db | Tx): Promise<{ pct: string; provisional: boolean }> {
    const r = await one<{ value: { pct: string }; is_provisional: boolean }>(q, `SELECT value, is_provisional FROM policy_setting WHERE key = 'vat.standard_rate'`);
    if (!r) throw new DomainError('POLICY_MISSING', 'Norma e TVSH-së nuk është konfiguruar', 422);
    return { pct: r.value.pct, provisional: r.is_provisional };
  }

  /** Faturon gjithë mallin e dorëzuar dhe ende të pafaturuar të porosisë. Porosia me pagesë në dorëzim kërkon arkëtimin në të njëjtin hap. */
  async invoiceOrder(actor: AuthUser, orderId: number, input: { idempotencyKey: string; payment?: { method: 'CASH' | 'BANK'; reference?: string } }): Promise<{ id: number; invoiceNo: number; gross: string; created: boolean }> {
    return withTransaction(this.db, async (tx) => {
      const dup = await one<{ id: string; invoice_no: string; gross: string }>(tx, 'SELECT id, invoice_no, gross::text FROM sales_invoice WHERE created_by = $1 AND idempotency_key = $2', [actor.id, input.idempotencyKey]);
      if (dup) return { id: Number(dup.id), invoiceNo: Number(dup.invoice_no), gross: dup.gross, created: false };
      const o = await one<{ branch_id: string; customer_id: string; on_credit: boolean; legal_entity_id: string; payment_term_days: number }>(tx,
        `SELECT o.branch_id, o.customer_id, o.on_credit, b.legal_entity_id, c.payment_term_days
           FROM sales_order o JOIN branch b ON b.id = o.branch_id JOIN customer c ON c.id = o.customer_id WHERE o.id = $1 FOR UPDATE OF o`, [orderId]);
      if (!o) throw notFound('Porosia');
      const branchId = Number(o.branch_id); const entityId = Number(o.legal_entity_id);
      if (!(await this.perms.has(actor.id, 'sales.invoice.create', branchId, tx))) throw forbidden();
      if (!o.on_credit && !input.payment) throw new DomainError('PAYMENT_REQUIRED', 'Porosia është me pagesë në dorëzim: fatura kërkon arkëtimin në të njëjtin hap', 422);
      if (input.payment && !(await this.perms.has(actor.id, 'payments.receive', branchId, tx))) throw forbidden();

      const vat = await this.vatRate(tx);
      // PROVIZOR: neto e rreshtit rrumbullakohet në 2 shifra; TVSH-ja llogaritet për rresht.
      const lines = await tx.query<{ line_no: number; product_id: string; qty: string; unit_price: string; discount_pct: string; net: string; vat: string }>(
        `SELECT l.line_no, l.product_id, (l.qty_delivered - l.qty_invoiced)::text AS qty, l.unit_price::text, l.discount_pct::text,
                round((l.qty_delivered - l.qty_invoiced) * l.unit_price * (100 - l.discount_pct) / 100, 2)::text AS net,
                round(round((l.qty_delivered - l.qty_invoiced) * l.unit_price * (100 - l.discount_pct) / 100, 2) * $2::numeric / 100, 2)::text AS vat
           FROM sales_order_line l WHERE l.order_id = $1 AND l.qty_delivered > l.qty_invoiced ORDER BY l.line_no`, [orderId, vat.pct]);
      if (lines.rows.length === 0) throw new DomainError('NOTHING_TO_INVOICE', 'Nuk ka mall të dorëzuar dhe të pafaturuar', 409);
      const tot = await one<{ net: string; vat: string; gross: string; today: string; due: string }>(tx,
        `SELECT sum(n)::text AS net, sum(v)::text AS vat, (sum(n) + sum(v))::text AS gross, to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today,
                to_char(CURRENT_DATE + $3::int, 'YYYY-MM-DD') AS due
           FROM unnest($1::numeric[], $2::numeric[]) AS t(n, v)`,
        [lines.rows.map((l) => l.net), lines.rows.map((l) => l.vat), o.on_credit ? o.payment_term_days : 0]);
      if (!tot) throw new Error('Totalet mungojnë');

      const acc = await this.accounts(tx, entityId, ['RECEIVABLE', 'SALES_REVENUE', 'VAT_OUTPUT']);
      const entryId = await this.ledger.postSystemEntry(tx, actor.id, {
        legalEntityId: entityId, entryDate: tot.today, description: `Faturë shitjeje për porosinë #${orderId}`, sourceType: 'SALES_INVOICE', sourceRef: String(orderId),
        idempotencyKey: `inv:${input.idempotencyKey}`,
        lines: [
          { accountId: acc.RECEIVABLE, branchId, debit: tot.gross, credit: '0' },
          { accountId: acc.SALES_REVENUE, branchId, debit: '0', credit: tot.net },
          { accountId: acc.VAT_OUTPUT, branchId, debit: '0', credit: tot.vat },
        ],
      });
      const inv = await one<{ id: string; invoice_no: string }>(tx,
        `INSERT INTO sales_invoice(legal_entity_id, fiscal_year, order_id, customer_id, branch_id, invoice_date, due_date, vat_rate, net, vat, gross, is_provisional_tax, journal_entry_id, created_by, idempotency_key)
         VALUES ($1, 0, $2, $3, $4, $5::date, $6::date, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11, $12, $13, $14) RETURNING id, invoice_no`,
        [entityId, orderId, o.customer_id, branchId, tot.today, tot.due, vat.pct, tot.net, tot.vat, tot.gross, vat.provisional, entryId, actor.id, input.idempotencyKey]);
      const id = Number(inv?.id);
      let no = 0;
      for (const l of lines.rows) {
        await tx.query(
          `INSERT INTO sales_invoice_line(invoice_id, line_no, order_line_no, product_id, qty, unit_price, discount_pct, net, vat)
           VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::numeric)`,
          [id, ++no, l.line_no, l.product_id, l.qty, l.unit_price, l.discount_pct, l.net, l.vat]);
        await tx.query('UPDATE sales_order_line SET qty_invoiced = qty_invoiced + $3::numeric WHERE order_id = $1 AND line_no = $2', [orderId, l.line_no, l.qty]);
      }
      await this.audit.record(tx, { actorUserId: actor.id, action: 'sales.invoice_issued', entityType: 'sales_invoice', entityId: id, branchId,
        details: { orderId, invoiceNo: Number(inv?.invoice_no), gross: tot.gross, provisionalTax: vat.provisional } });
      if (input.payment) {
        await this.paymentInTx(tx, actor, { customerId: Number(o.customer_id), branchId, entityId, method: input.payment.method, amount: tot.gross,
          reference: input.payment.reference, idempotencyKey: `pay-for-inv:${input.idempotencyKey}`, onlyInvoiceId: id });
      }
      return { id, invoiceNo: Number(inv?.invoice_no), gross: tot.gross, created: true };
    });
  }

  /** Arkëtim nga klienti. Shpërndahet te faturat më të vjetra të hapura; teprica mbetet si avans i klientit (detyrim). */
  async receivePayment(actor: AuthUser, customerId: number, input: { branchId: number; method: 'CASH' | 'BANK'; amount: string; reference?: string; idempotencyKey: string }): Promise<{ id: number; allocated: string; advance: string; created: boolean }> {
    if (!MONEY.test(input.amount) || /^0+(\.0+)?$/.test(input.amount)) throw new DomainError('VALIDATION', 'Shuma duhet të jetë pozitive, me jo më shumë se 2 shifra pas presjes');
    return withTransaction(this.db, async (tx) => {
      const dup = await one<{ id: string }>(tx, 'SELECT id FROM customer_payment WHERE received_by = $1 AND idempotency_key = $2', [actor.id, input.idempotencyKey]);
      if (dup) return { id: Number(dup.id), allocated: '0', advance: '0', created: false };
      if (!(await this.perms.has(actor.id, 'payments.receive', input.branchId, tx))) throw forbidden();
      const b = await one<{ legal_entity_id: string }>(tx, 'SELECT legal_entity_id FROM branch WHERE id = $1', [input.branchId]);
      if (!b) throw notFound('Dega');
      if (!(await one(tx, 'SELECT 1 FROM customer WHERE id = $1', [customerId]))) throw notFound('Klienti');
      const r = await this.paymentInTx(tx, actor, { customerId, branchId: input.branchId, entityId: Number(b.legal_entity_id), method: input.method, amount: input.amount, reference: input.reference, idempotencyKey: input.idempotencyKey });
      return { ...r, created: true };
    });
  }

  private async paymentInTx(tx: Tx, actor: AuthUser, p: { customerId: number; branchId: number; entityId: number; method: 'CASH' | 'BANK'; amount: string; reference?: string; idempotencyKey: string; onlyInvoiceId?: number }): Promise<{ id: number; allocated: string; advance: string }> {
    // Kyçja e klientit e serializon shpërndarjen e pagesave të tij.
    await tx.query('SELECT 1 FROM customer WHERE id = $1 FOR UPDATE', [p.customerId]);
    const open = await tx.query<{ invoice_id: string; take: string }>(
      `WITH o AS (SELECT invoice_id, open_amount, sum(open_amount) OVER (ORDER BY invoice_date, invoice_id) AS running
                    FROM customer_open_invoice WHERE customer_id = $1 AND open_amount > 0 AND ($3::bigint IS NULL OR invoice_id = $3))
       SELECT invoice_id, LEAST(open_amount, $2::numeric - (running - open_amount))::text AS take FROM o WHERE running - open_amount < $2::numeric ORDER BY running`,
      [p.customerId, p.amount, p.onlyInvoiceId ?? null]);
    const sums = await one<{ allocated: string; advance: string; today: string }>(tx,
      `SELECT COALESCE(sum(x), 0)::text AS allocated, ($2::numeric - COALESCE(sum(x), 0))::text AS advance, to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today FROM unnest($1::numeric[]) AS t(x)`,
      [open.rows.map((r) => r.take), p.amount]);
    if (!sums) throw new Error('Shumat mungojnë');
    // Para në dorë pranohen vetëm me arkë të hapur; arkëtimi lidhet me seancën e ditës.
    const cashSessionId = p.method === 'CASH' ? await this.cash.openSessionId(tx, p.branchId) : null;
    const acc = await this.accounts(tx, p.entityId, ['RECEIVABLE', 'CUSTOMER_ADVANCES', p.method]);
    const entryId = await this.ledger.postSystemEntry(tx, actor.id, {
      legalEntityId: p.entityId, entryDate: sums.today, description: `Arkëtim nga klienti #${p.customerId} (${p.method === 'CASH' ? 'arkë' : 'bankë'})`,
      sourceType: 'CUSTOMER_PAYMENT', sourceRef: String(p.customerId), idempotencyKey: `pay:${p.idempotencyKey}`,
      lines: [
        { accountId: acc[p.method], branchId: p.branchId, debit: p.amount, credit: '0' },
        { accountId: acc.RECEIVABLE, branchId: p.branchId, debit: '0', credit: sums.allocated },
        { accountId: acc.CUSTOMER_ADVANCES, branchId: p.branchId, debit: '0', credit: sums.advance },
      ],
    });
    const pay = await one<{ id: string }>(tx,
      `INSERT INTO customer_payment(legal_entity_id, customer_id, branch_id, method, amount, received_on, reference, journal_entry_id, received_by, idempotency_key, cash_session_id)
       VALUES ($1, $2, $3, $4, $5::numeric, $6::date, $7, $8, $9, $10, $11) RETURNING id`,
      [p.entityId, p.customerId, p.branchId, p.method, p.amount, sums.today, p.reference ?? null, entryId, actor.id, p.idempotencyKey, cashSessionId]);
    const id = Number(pay?.id);
    for (const r of open.rows) {
      await tx.query('INSERT INTO payment_allocation(payment_id, invoice_id, amount) VALUES ($1, $2, $3::numeric)', [id, r.invoice_id, r.take]);
    }
    await this.audit.record(tx, { actorUserId: actor.id, action: 'payment.received', entityType: 'customer_payment', entityId: id, branchId: p.branchId,
      details: { method: p.method, amount: p.amount, allocated: sums.allocated, advance: sums.advance } });
    return { id, allocated: sums.allocated, advance: sums.advance };
  }

  async customerBalance(actor: AuthUser, customerId: number) {
    if (!(await this.perms.has(actor.id, 'customers.read', 'any'))) throw forbidden();
    const c = await one<{ credit_limit: string }>(this.db, 'SELECT credit_limit::text FROM customer WHERE id = $1', [customerId]);
    if (!c) throw notFound('Klienti');
    const inv = await this.db.query(
      `SELECT invoice_id, fiscal_year, invoice_no, to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date, to_char(due_date, 'YYYY-MM-DD') AS due_date,
              gross::text, open_amount::text, GREATEST(CURRENT_DATE - due_date, 0) AS days_overdue
         FROM customer_open_invoice WHERE customer_id = $1 AND open_amount > 0 ORDER BY invoice_date, invoice_id`, [customerId]);
    const t = await one<{ open: string; advances: string }>(this.db,
      `SELECT (SELECT COALESCE(sum(open_amount), 0) FROM customer_open_invoice WHERE customer_id = $1)::text AS open,
              (SELECT COALESCE(sum(p.amount), 0) - COALESCE((SELECT sum(a.amount) FROM payment_allocation a JOIN customer_payment p2 ON p2.id = a.payment_id WHERE p2.customer_id = $1), 0)
                 FROM customer_payment p WHERE p.customer_id = $1)::text AS advances`, [customerId]);
    return { creditLimit: c.credit_limit, openTotal: t?.open ?? '0', unappliedAdvances: t?.advances ?? '0', openInvoices: inv.rows };
  }

  async getInvoice(actor: AuthUser, invoiceId: number) {
    const i = await one<{ branch_id: string }>(this.db,
      `SELECT i.id, i.branch_id, i.fiscal_year, i.invoice_no, to_char(i.invoice_date, 'YYYY-MM-DD') AS invoice_date, to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
              i.vat_rate::text, i.net::text, i.vat::text, i.gross::text, i.is_provisional_tax, i.is_fiscalized, i.order_id,
              c.code AS customer_code, c.name AS customer_name, c.phone AS customer_phone,
              b.name AS branch_name, b.city AS branch_city, e.name AS seller_name, e.tax_number AS seller_tax_number, e.verified AS seller_verified,
              o.open_amount::text
         FROM sales_invoice i JOIN customer c ON c.id = i.customer_id JOIN branch b ON b.id = i.branch_id JOIN legal_entity e ON e.id = i.legal_entity_id
         JOIN customer_open_invoice o ON o.invoice_id = i.id WHERE i.id = $1`, [invoiceId]);
    if (!i) throw notFound('Fatura');
    if (!(await this.perms.has(actor.id, 'sales.read', Number(i.branch_id)))) throw forbidden();
    const lines = await this.db.query(
      `SELECT l.line_no, p.sku, p.name, p.base_uom, l.qty::text, l.unit_price::text, l.discount_pct::text, l.net::text, l.vat::text,
              COALESCE((SELECT sum(c.qty) FROM credit_note_line c WHERE c.invoice_id = l.invoice_id AND c.invoice_line_no = l.line_no), 0)::text AS qty_credited
         FROM sales_invoice_line l JOIN product p ON p.id = l.product_id WHERE l.invoice_id = $1 ORDER BY l.line_no`, [invoiceId]);
    const credits = await this.db.query(
      `SELECT id, credit_no, fiscal_year, to_char(credit_date, 'YYYY-MM-DD') AS credit_date, reason, restocked, gross::text FROM credit_note WHERE invoice_id = $1 ORDER BY id`, [invoiceId]);
    return { ...i, lines: lines.rows, creditNotes: credits.rows };
  }

  async invoices(actor: AuthUser) {
    const res = await this.db.query(
      `SELECT i.id, i.fiscal_year, i.invoice_no, to_char(i.invoice_date, 'YYYY-MM-DD') AS invoice_date, b.code AS branch, c.name AS customer_name,
              i.net::text, i.vat::text, i.gross::text, i.vat_rate::text, i.is_provisional_tax, o.open_amount::text
         FROM sales_invoice i JOIN branch b ON b.id = i.branch_id JOIN customer c ON c.id = i.customer_id JOIN customer_open_invoice o ON o.invoice_id = i.id
        WHERE EXISTS (SELECT 1 FROM user_role ur JOIN role_permission rp ON rp.role_id = ur.role_id AND rp.permission_code = 'sales.read'
                       WHERE ur.user_id = $1 AND ur.revoked_at IS NULL AND (ur.valid_until IS NULL OR ur.valid_until > now())
                         AND (ur.branch_id IS NULL OR ur.branch_id = i.branch_id))
        ORDER BY i.id DESC LIMIT 200`, [actor.id]);
    return res.rows;
  }
}
