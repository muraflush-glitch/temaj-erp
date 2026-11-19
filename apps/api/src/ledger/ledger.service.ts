import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { PermissionService, Scope } from '../auth/permission.service';
import { DomainError, forbidden, notFound } from '../common/errors';
import { AuthUser } from '../common/request';
import { DB } from '../database/database.module';
import { Db, one, Tx, withTransaction } from '../database/db';

export const CLOSE_PERIOD = 'ledger.close_period';
const AMOUNT = /^\d{1,15}(\.\d{1,4})?$/;
const isZero = (s: string): boolean => /^0+(\.0+)?$/.test(s);

export interface LineInput { accountCode: string; branchId: number | null; debit: string; credit: string; description?: string }
export interface DraftInput { legalEntityCode?: string; entryDate: string; description: string; lines: LineInput[]; idempotencyKey: string; sourceType?: string; sourceRef?: string }

/**
 * Libri kryesor (prototip). Shumat janë gjithmonë string dhjetorë → NUMERIC; asnjë float.
 * Rregullat e balancës, pandryshueshmërisë dhe periudhave zbatohen nga databaza (migrimi 003);
 * ky shërbim shton lejet sipas degës, idempotencën dhe auditin.
 */
@Injectable()
export class LedgerService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly perms: PermissionService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    // Mbyllja e periudhës kalon gjithmonë përmes aprovimit me katër sy.
    this.approvals.register(CLOSE_PERIOD, {
      requestPermission: 'ledger.period.request_close',
      validate: async (tx, payload) => {
        const p = await one<{ status: string }>(tx, 'SELECT status FROM fiscal_period WHERE id = $1', [Number(payload['periodId'])]);
        if (!p) throw notFound('Periudha');
        if (p.status === 'CLOSED') throw new DomainError('PERIOD_CLOSED', 'Periudha është mbyllur tashmë', 409);
      },
      execute: async (tx, req) => {
        const periodId = Number(req.payload['periodId']);
        await tx.query(`UPDATE fiscal_period SET status = 'CLOSED', closed_by = $2 WHERE id = $1`, [periodId, req.requested_by]);
        await this.audit.record(tx, { actorUserId: Number(req.requested_by), action: 'ledger.period_closed', entityType: 'fiscal_period',
          entityId: periodId, details: { approvalRequestId: Number(req.id) } });
      },
    });
  }

  private async entityId(q: Db | Tx, code?: string): Promise<number> {
    const res = await q.query<{ id: string }>('SELECT id FROM legal_entity WHERE ($1::text IS NULL OR code = $1) ORDER BY id LIMIT 2', [code ?? null]);
    if (res.rows.length === 0) throw notFound('Subjekti ligjor');
    if (res.rows.length > 1) throw new DomainError('LEGAL_ENTITY_REQUIRED', 'Duhet të zgjidhni subjektin ligjor');
    return Number(res.rows[0]?.id);
  }

  /** Përdoruesi duhet ta ketë lejen në çdo degë që prek regjistrimi (ose globalisht për rreshtat pa degë). */
  private async requireOnScopes(q: Db | Tx, userId: number, permission: string, branchIds: (number | null)[]): Promise<void> {
    const scopes = new Set<Scope>(branchIds.map((b) => (b == null ? 'global' : b)));
    for (const s of scopes) {
      if (!(await this.perms.has(userId, permission, s, q))) throw forbidden();
    }
  }

  private async entryScopes(q: Db | Tx, entryId: number): Promise<(number | null)[]> {
    const res = await q.query<{ branch_id: string | null }>('SELECT DISTINCT branch_id FROM journal_line WHERE entry_id = $1', [entryId]);
    return res.rows.map((r) => (r.branch_id == null ? null : Number(r.branch_id)));
  }

  async createDraft(actor: AuthUser, input: DraftInput): Promise<{ id: number; created: boolean }> {
    if (input.lines.length < 2) throw new DomainError('VALIDATION', 'Regjistrimi duhet të ketë së paku dy rreshta');
    for (const l of input.lines) {
      if (!AMOUNT.test(l.debit) || !AMOUNT.test(l.credit)) throw new DomainError('VALIDATION', 'Shumat duhet të jenë numra dhjetorë pozitivë (deri në 4 shifra pas presjes)');
      if (isZero(l.debit) === isZero(l.credit)) throw new DomainError('VALIDATION', 'Çdo rresht duhet të ketë ose debi ose kredi, jo të dyja dhe jo zero');
    }
    return withTransaction(this.db, async (tx) => {
      const existing = await one<{ id: string }>(tx, 'SELECT id FROM journal_entry WHERE created_by = $1 AND idempotency_key = $2', [actor.id, input.idempotencyKey]);
      if (existing) return { id: Number(existing.id), created: false };
      await this.requireOnScopes(tx, actor.id, 'ledger.entry.create', input.lines.map((l) => l.branchId));
      const entityId = await this.entityId(tx, input.legalEntityCode);
      const e = await one<{ id: string }>(tx,
        `INSERT INTO journal_entry(legal_entity_id, entry_date, description, source_type, source_ref, created_by, idempotency_key)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7) RETURNING id`,
        [entityId, input.entryDate, input.description, input.sourceType ?? 'MANUAL', input.sourceRef ?? null, actor.id, input.idempotencyKey]);
      const id = Number(e?.id);
      let no = 0;
      for (const l of input.lines) {
        const acc = await one<{ id: string }>(tx, 'SELECT id FROM ledger_account WHERE legal_entity_id = $1 AND code = $2', [entityId, l.accountCode]);
        if (!acc) throw new DomainError('INVALID_ACCOUNT', `Llogaria ${l.accountCode} nuk ekziston`);
        await tx.query(
          `INSERT INTO journal_line(entry_id, line_no, account_id, branch_id, debit, credit, description)
           VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7)`,
          [id, ++no, acc.id, l.branchId, l.debit, l.credit, l.description ?? null]);
      }
      await this.audit.record(tx, { actorUserId: actor.id, action: 'ledger.entry_drafted', entityType: 'journal_entry', entityId: id, details: { entryDate: input.entryDate, lines: no } });
      return { id, created: true };
    });
  }

  async post(actor: AuthUser, entryId: number): Promise<{ entryNo: number }> {
    return withTransaction(this.db, async (tx) => {
      const e = await one<{ status: string }>(tx, 'SELECT status FROM journal_entry WHERE id = $1 FOR UPDATE', [entryId]);
      if (!e) throw notFound('Regjistrimi');
      if (e.status === 'POSTED') throw new DomainError('ALREADY_POSTED', 'Regjistrimi është postuar tashmë', 409);
      await this.requireOnScopes(tx, actor.id, 'ledger.entry.post', await this.entryScopes(tx, entryId));
      return { entryNo: await this.postInTx(tx, actor.id, entryId) };
    });
  }

  private async postInTx(tx: Tx, userId: number, entryId: number): Promise<number> {
    const r = await one<{ entry_no: string }>(tx, `UPDATE journal_entry SET status = 'POSTED', posted_by = $2 WHERE id = $1 RETURNING entry_no`, [entryId, userId]);
    const entryNo = Number(r?.entry_no);
    await this.audit.record(tx, { actorUserId: userId, action: 'ledger.entry_posted', entityType: 'journal_entry', entityId: entryId, details: { entryNo } });
    return entryNo;
  }

  /**
   * Regjistrim automatik nga një modul tjetër (faturë, arkëtim), brenda transaksionit të dokumentit burim.
   * Lejet i ka kontrolluar moduli thirrës; balanca, periudha dhe llogaritë kontrollohen nga databaza si për çdo regjistrim.
   */
  async postSystemEntry(tx: Tx, userId: number, e: { legalEntityId: number; entryDate: string; description: string; sourceType: string; sourceRef: string;
    idempotencyKey: string; lines: { accountId: number; branchId: number | null; debit: string; credit: string }[] }): Promise<number> {
    const r = await one<{ id: string }>(tx,
      `INSERT INTO journal_entry(legal_entity_id, entry_date, description, source_type, source_ref, created_by, idempotency_key)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7) RETURNING id`,
      [e.legalEntityId, e.entryDate, e.description, e.sourceType, e.sourceRef, userId, e.idempotencyKey]);
    const id = Number(r?.id);
    let no = 0;
    for (const l of e.lines) {
      if (/^0+(\.0+)?$/.test(l.debit) && /^0+(\.0+)?$/.test(l.credit)) continue;   // rreshtat zero (p.sh. TVSH 0) nuk regjistrohen
      await tx.query('INSERT INTO journal_line(entry_id, line_no, account_id, branch_id, debit, credit) VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric)',
        [id, ++no, l.accountId, l.branchId, l.debit, l.credit]);
    }
    await this.postInTx(tx, userId, id);
    return id;
  }

  async deleteDraft(actor: AuthUser, entryId: number): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const e = await one<{ status: string; created_by: string }>(tx, 'SELECT status, created_by FROM journal_entry WHERE id = $1 FOR UPDATE', [entryId]);
      if (!e) throw notFound('Regjistrimi');
      if (e.status !== 'DRAFT') throw new DomainError('IMMUTABLE', 'Regjistrimi i postuar nuk fshihet; përdorni kthimin', 409);
      await this.requireOnScopes(tx, actor.id, 'ledger.entry.create', await this.entryScopes(tx, entryId));
      await tx.query('DELETE FROM journal_entry WHERE id = $1', [entryId]);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'ledger.draft_deleted', entityType: 'journal_entry', entityId: entryId });
    });
  }

  /** Kthimi (storno): regjistrim i ri me debi/kredi të këmbyera, i lidhur me origjinalin. Origjinali mbetet i paprekur. */
  async reverse(actor: AuthUser, entryId: number, input: { entryDate: string; reason: string; idempotencyKey: string }): Promise<{ id: number; entryNo: number; created: boolean }> {
    return withTransaction(this.db, async (tx) => {
      const dup = await one<{ id: string; entry_no: string }>(tx, 'SELECT id, entry_no FROM journal_entry WHERE created_by = $1 AND idempotency_key = $2', [actor.id, input.idempotencyKey]);
      if (dup) return { id: Number(dup.id), entryNo: Number(dup.entry_no), created: false };
      const orig = await one<{ legal_entity_id: string; entry_no: string | null; status: string }>(tx,
        'SELECT legal_entity_id, entry_no, status FROM journal_entry WHERE id = $1 FOR UPDATE', [entryId]);
      if (!orig) throw notFound('Regjistrimi');
      if (orig.status !== 'POSTED') throw new DomainError('NOT_POSTED', 'Vetëm regjistrimet e postuara mund të kthehen', 409);
      const already = await one(tx, 'SELECT 1 FROM journal_entry WHERE reverses_entry_id = $1', [entryId]);
      if (already) throw new DomainError('ALREADY_REVERSED', 'Regjistrimi është kthyer tashmë', 409);
      await this.requireOnScopes(tx, actor.id, 'ledger.entry.reverse', await this.entryScopes(tx, entryId));
      const e = await one<{ id: string }>(tx,
        `INSERT INTO journal_entry(legal_entity_id, entry_date, description, source_type, source_ref, created_by, idempotency_key, reverses_entry_id)
         VALUES ($1, $2::date, $3, 'REVERSAL', $4, $5, $6, $7) RETURNING id`,
        [orig.legal_entity_id, input.entryDate, `Kthim i regjistrimit nr. ${orig.entry_no}: ${input.reason}`, String(entryId), actor.id, input.idempotencyKey, entryId]);
      const id = Number(e?.id);
      await tx.query(
        `INSERT INTO journal_line(entry_id, line_no, account_id, branch_id, debit, credit, description)
         SELECT $1, line_no, account_id, branch_id, credit, debit, description FROM journal_line WHERE entry_id = $2`, [id, entryId]);
      const entryNo = await this.postInTx(tx, actor.id, id);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'ledger.entry_reversed', entityType: 'journal_entry', entityId: entryId, details: { reversalEntryId: id, reason: input.reason } });
      return { id, entryNo, created: true };
    });
  }

  async getEntry(actor: AuthUser, entryId: number) {
    const e = await one(this.db,
      `SELECT id, entry_no, to_char(entry_date, 'YYYY-MM-DD') AS entry_date, description, status, source_type, source_ref, reverses_entry_id, created_by, posted_by, posted_at
         FROM journal_entry WHERE id = $1`, [entryId]);
    if (!e) throw notFound('Regjistrimi');
    await this.requireOnScopes(this.db, actor.id, 'ledger.read', await this.entryScopes(this.db, entryId));
    const lines = await this.db.query(
      `SELECT l.line_no, a.code AS account_code, a.name AS account_name, l.branch_id, l.debit::text, l.credit::text, l.description
         FROM journal_line l JOIN ledger_account a ON a.id = l.account_id WHERE l.entry_id = $1 ORDER BY l.line_no`, [entryId]);
    return { ...e, lines: lines.rows };
  }

  async listEntries(actor: AuthUser, limit: number) {
    if (!(await this.perms.has(actor.id, 'ledger.read', 'global'))) throw forbidden();
    const res = await this.db.query(
      `SELECT e.id, e.entry_no, to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date, e.description, e.status, e.reverses_entry_id,
              (SELECT COALESCE(sum(debit), 0)::text FROM journal_line WHERE entry_id = e.id) AS total
         FROM journal_entry e ORDER BY e.id DESC LIMIT $1`, [limit]);
    return res.rows;
  }

  /** Bilanci vërtetues: vetëm regjistrimet e postuara deri në datën e dhënë. */
  async trialBalance(actor: AuthUser, asOf: string, branchId?: number, legalEntityCode?: string) {
    if (!(await this.perms.has(actor.id, 'ledger.read', branchId ?? 'global'))) throw forbidden();
    const entityId = await this.entityId(this.db, legalEntityCode);
    const res = await this.db.query<{ code: string; name: string; type: string; debit: string; credit: string; balance: string }>(
      `SELECT a.code, a.name, a.type, sum(l.debit)::text AS debit, sum(l.credit)::text AS credit, (sum(l.debit) - sum(l.credit))::text AS balance
         FROM journal_line l
         JOIN journal_entry e ON e.id = l.entry_id AND e.status = 'POSTED' AND e.legal_entity_id = $1 AND e.entry_date <= $2::date
         JOIN ledger_account a ON a.id = l.account_id
        WHERE ($3::bigint IS NULL OR l.branch_id = $3)
        GROUP BY a.id ORDER BY a.code`, [entityId, asOf, branchId ?? null]);
    const tot = await one<{ debit: string; credit: string }>(this.db,
      `SELECT COALESCE(sum(l.debit), 0)::text AS debit, COALESCE(sum(l.credit), 0)::text AS credit
         FROM journal_line l JOIN journal_entry e ON e.id = l.entry_id AND e.status = 'POSTED' AND e.legal_entity_id = $1 AND e.entry_date <= $2::date
        WHERE ($3::bigint IS NULL OR l.branch_id = $3)`, [entityId, asOf, branchId ?? null]);
    return { asOf, branchId: branchId ?? null, accounts: res.rows, totalDebit: tot?.debit ?? '0', totalCredit: tot?.credit ?? '0' };
  }

  async accounts(actor: AuthUser) {
    if (!(await this.perms.has(actor.id, 'ledger.read', 'any'))) throw forbidden();
    const res = await this.db.query('SELECT code, name, type, is_postable, is_active, is_provisional FROM ledger_account ORDER BY code');
    return res.rows;
  }

  async periods(actor: AuthUser) {
    if (!(await this.perms.has(actor.id, 'ledger.read', 'any'))) throw forbidden();
    const res = await this.db.query(
      `SELECT id, name, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, status, closed_at FROM fiscal_period ORDER BY start_date`);
    return res.rows;
  }

  async requestPeriodClose(actor: AuthUser, periodId: number, reason: string, idempotencyKey: string) {
    return this.approvals.request(actor, { actionCode: CLOSE_PERIOD, branchId: null, amount: '0', payload: { periodId }, reason, idempotencyKey });
  }
}
