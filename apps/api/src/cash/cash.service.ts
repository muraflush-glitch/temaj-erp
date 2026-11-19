import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from '../auth/permission.service';
import { DomainError, forbidden, notFound } from '../common/errors';
import { AuthUser } from '../common/request';
import { DB } from '../database/database.module';
import { Db, one, Tx, withTransaction } from '../database/db';
import { LedgerService } from '../ledger/ledger.service';

export const CASH_DIFFERENCE = 'cash.close_difference';
const MONEY = /^\d{1,15}(\.\d{1,2})?$/;

/**
 * Arka ditore (PROVIZOR). Arkëtari hap arkën, arkëton gjatë ditës dhe në fund numëron paratë.
 * Sistemi e llogarit vetë shumën e pritur; çdo mungesë ose tepricë kërkon arsyetim dhe aprovim nga një person tjetër.
 */
@Injectable()
export class CashService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly perms: PermissionService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly ledger: LedgerService,
  ) {}

  onModuleInit(): void {
    this.approvals.register(CASH_DIFFERENCE, {
      requestPermission: 'cash.session.manage',
      execute: async (tx, req) => {
        const sid = Number(req.payload['sessionId']);
        const s = await one<{ status: string }>(tx, 'SELECT status FROM cash_session WHERE id = $1 FOR UPDATE', [sid]);
        if (s?.status !== 'PENDING_CLOSE') throw new DomainError('CASH_STATE', 'Arka nuk është në pritje të mbylljes', 409);
        await this.finalize(tx, sid, Number(req.id));
      },
      onClosedWithoutApproval: async (tx, req) => {
        // Refuzim: arka kthehet e hapur dhe duhet numëruar përsëri.
        await tx.query(`UPDATE cash_session SET status = 'OPEN', counted = NULL, expected = NULL, bank_deposit = NULL, closed_by = NULL, close_reason = NULL
                         WHERE id = $1 AND status = 'PENDING_CLOSE'`, [Number(req.payload['sessionId'])]);
      },
    });
  }

  /** Seanca e hapur e arkës së degës; përdoret nga arkëtimet me para në dorë. */
  async openSessionId(tx: Tx, branchId: number): Promise<number> {
    const s = await one<{ id: string }>(tx,
      `SELECT s.id FROM cash_session s JOIN cash_register r ON r.id = s.register_id WHERE r.branch_id = $1 AND r.is_active AND s.status = 'OPEN'`, [branchId]);
    if (!s) throw new DomainError('CASH_SESSION_NOT_OPEN', 'Arka e degës nuk është e hapur. Hapeni arkën para se të arkëtoni para në dorë.', 409);
    return Number(s.id);
  }

  async registers(actor: AuthUser) {
    const res = await this.db.query(
      `SELECT r.id, r.code, r.name, b.code AS branch, r.branch_id,
              s.id AS session_id, s.status AS session_status, s.opened_at, s.opening_float::text,
              CASE WHEN s.id IS NOT NULL THEN cash_session_expected(s.id)::text END AS expected_now,
              (SELECT count(*) FROM customer_payment p WHERE p.cash_session_id = s.id)::int AS payments
         FROM cash_register r JOIN branch b ON b.id = r.branch_id
         LEFT JOIN cash_session s ON s.register_id = r.id AND s.status <> 'CLOSED'
        WHERE r.is_active AND EXISTS (
                SELECT 1 FROM user_role ur JOIN role_permission rp ON rp.role_id = ur.role_id AND rp.permission_code IN ('cash.session.manage', 'approvals.cash.decide')
                 WHERE ur.user_id = $1 AND ur.revoked_at IS NULL AND (ur.valid_until IS NULL OR ur.valid_until > now())
                   AND (ur.branch_id IS NULL OR ur.branch_id = r.branch_id))
        ORDER BY r.code`, [actor.id]);
    return res.rows;
  }

  async history(actor: AuthUser, registerId: number) {
    const r = await one<{ branch_id: string }>(this.db, 'SELECT branch_id FROM cash_register WHERE id = $1', [registerId]);
    if (!r) throw notFound('Arka');
    if (!(await this.perms.has(actor.id, 'cash.session.manage', Number(r.branch_id))) && !(await this.perms.has(actor.id, 'approvals.cash.decide', Number(r.branch_id)))) throw forbidden();
    const res = await this.db.query(
      `SELECT id, status, opened_at, closed_at, opening_float::text, expected::text, counted::text, (counted - expected)::text AS difference, bank_deposit::text, close_reason
         FROM cash_session WHERE register_id = $1 ORDER BY id DESC LIMIT 60`, [registerId]);
    return res.rows;
  }

  async open(actor: AuthUser, registerId: number): Promise<{ id: number; openingFloat: string }> {
    return withTransaction(this.db, async (tx) => {
      const r = await one<{ branch_id: string }>(tx, 'SELECT branch_id FROM cash_register WHERE id = $1 AND is_active FOR UPDATE', [registerId]);
      if (!r) throw notFound('Arka');
      const branchId = Number(r.branch_id);
      if (!(await this.perms.has(actor.id, 'cash.session.manage', branchId, tx))) throw forbidden();
      if (await one(tx, `SELECT 1 FROM cash_session WHERE register_id = $1 AND status <> 'CLOSED'`, [registerId])) {
        throw new DomainError('CASH_ALREADY_OPEN', 'Arka është e hapur ose pret mbylljen', 409);
      }
      // Gjendja fillestare = paratë e mbetura në arkë pas mbylljes së fundit.
      const last = await one<{ f: string }>(tx, `SELECT (counted - bank_deposit)::text AS f FROM cash_session WHERE register_id = $1 AND status = 'CLOSED' ORDER BY id DESC LIMIT 1`, [registerId]);
      const s = await one<{ id: string; opening_float: string }>(tx,
        'INSERT INTO cash_session(register_id, opened_by, opening_float) VALUES ($1, $2, $3::numeric) RETURNING id, opening_float::text', [registerId, actor.id, last?.f ?? '0']);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'cash.session_opened', entityType: 'cash_session', entityId: s?.id, branchId, details: { openingFloat: s?.opening_float } });
      return { id: Number(s?.id), openingFloat: s?.opening_float ?? '0' };
    });
  }

  async close(actor: AuthUser, sessionId: number, input: { counted: string; bankDeposit: string; reason?: string }): Promise<{ status: string; expected: string; difference: string; approvalRequestId?: number }> {
    if (!MONEY.test(input.counted) || !MONEY.test(input.bankDeposit)) throw new DomainError('VALIDATION', 'Shumat duhet të jenë numra me jo më shumë se 2 shifra pas presjes');
    return withTransaction(this.db, async (tx) => {
      const s = await one<{ status: string; branch_id: string }>(tx,
        `SELECT s.status, r.branch_id FROM cash_session s JOIN cash_register r ON r.id = s.register_id WHERE s.id = $1 FOR UPDATE OF s`, [sessionId]);
      if (!s) throw notFound('Seanca e arkës');
      if (s.status !== 'OPEN') throw new DomainError('CASH_STATE', 'Arka nuk është e hapur', 409);
      const branchId = Number(s.branch_id);
      if (!(await this.perms.has(actor.id, 'cash.session.manage', branchId, tx))) throw forbidden();
      const c = await one<{ expected: string; diff: string; zero: boolean; abs: string; dep_ok: boolean }>(tx,
        `SELECT e::text AS expected, ($2::numeric - e)::text AS diff, ($2::numeric = e) AS zero, abs($2::numeric - e)::text AS abs, ($3::numeric <= $2::numeric) AS dep_ok
           FROM (SELECT cash_session_expected($1) AS e) x`, [sessionId, input.counted, input.bankDeposit]);
      if (!c) throw new Error('Llogaritja mungon');
      if (!c.dep_ok) throw new DomainError('VALIDATION', 'Dorëzimi në bankë nuk mund të jetë më i madh se paratë e numëruara');
      const pending = !c.zero;
      if (pending && (!input.reason || input.reason.trim().length < 5)) {
        throw new DomainError('REASON_REQUIRED', `Numërimi ndryshon nga shuma e pritur për ${c.diff} €; duhet arsyetim për aprovim`, 422);
      }
      await tx.query(`UPDATE cash_session SET status = 'PENDING_CLOSE', counted = $2::numeric, bank_deposit = $3::numeric, closed_by = $4, close_reason = $5 WHERE id = $1`,
        [sessionId, input.counted, input.bankDeposit, actor.id, input.reason ?? null]);
      if (!pending) {
        await this.finalize(tx, sessionId, null);
        return { status: 'CLOSED', expected: c.expected, difference: c.diff };
      }
      const req = await this.approvals.requestInTx(tx, actor, { actionCode: CASH_DIFFERENCE, branchId, amount: c.abs, reason: input.reason as string,
        idempotencyKey: `cash-close:${sessionId}:${Date.now()}`, payload: { sessionId, expected: c.expected, counted: input.counted, difference: c.diff } });
      await tx.query('UPDATE cash_session SET approval_request_id = $2 WHERE id = $1', [sessionId, req.id]);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'cash.close_requested', entityType: 'cash_session', entityId: sessionId, branchId, details: { expected: c.expected, counted: input.counted, difference: c.diff } });
      return { status: 'PENDING_CLOSE', expected: c.expected, difference: c.diff, approvalRequestId: req.id };
    });
  }

  /** Mbyllja përfundimtare: regjistron në libër mungesën/tepricën dhe paratë e nxjerra për bankë, pastaj e mbyll seancën. */
  private async finalize(tx: Tx, sessionId: number, approvalRequestId: number | null): Promise<void> {
    const s = await one<{ branch_id: string; legal_entity_id: string; closed_by: string; counted: string; expected: string; bank_deposit: string; short: string; over: string; today: string }>(tx,
      `SELECT r.branch_id, b.legal_entity_id, s.closed_by, s.counted::text, s.expected::text, s.bank_deposit::text,
              GREATEST(s.expected - s.counted, 0)::text AS short, GREATEST(s.counted - s.expected, 0)::text AS over, to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today
         FROM cash_session s JOIN cash_register r ON r.id = s.register_id JOIN branch b ON b.id = r.branch_id WHERE s.id = $1`, [sessionId]);
    if (!s) throw notFound('Seanca e arkës');
    const branchId = Number(s.branch_id); const entityId = Number(s.legal_entity_id); const userId = Number(s.closed_by);
    const zero = (v: string): boolean => /^0+(\.0+)?$/.test(v);
    if (!zero(s.short) || !zero(s.over) || !zero(s.bank_deposit)) {
      const r = await tx.query<{ role: string; account_id: string }>('SELECT role, account_id FROM account_role WHERE legal_entity_id = $1', [entityId]);
      const acc = (role: string): number => {
        const a = r.rows.find((x) => x.role === role);
        if (!a) throw new DomainError('ACCOUNT_ROLE_MISSING', `Mungon lidhja e llogarisë për rolin ${role}`, 422);
        return Number(a.account_id);
      };
      await this.ledger.postSystemEntry(tx, userId, {
        legalEntityId: entityId, entryDate: s.today, description: `Mbyllja e arkës, seanca #${sessionId}`, sourceType: 'CASH_CLOSE', sourceRef: String(sessionId),
        idempotencyKey: `cash-close:${sessionId}`,
        lines: [
          { accountId: acc('CASH_SHORTAGE'), branchId, debit: s.short, credit: '0' },
          { accountId: acc('CASH'), branchId, debit: '0', credit: s.short },
          { accountId: acc('CASH'), branchId, debit: s.over, credit: '0' },
          { accountId: acc('CASH_SURPLUS'), branchId, debit: '0', credit: s.over },
          { accountId: acc('CASH_IN_TRANSIT'), branchId, debit: s.bank_deposit, credit: '0' },
          { accountId: acc('CASH'), branchId, debit: '0', credit: s.bank_deposit },
        ],
      });
    }
    await tx.query(`UPDATE cash_session SET status = 'CLOSED' WHERE id = $1`, [sessionId]);
    await this.audit.record(tx, { actorUserId: userId, action: 'cash.session_closed', entityType: 'cash_session', entityId: sessionId, branchId,
      details: { expected: s.expected, counted: s.counted, bankDeposit: s.bank_deposit, approvalRequestId } });
  }
}
