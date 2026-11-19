import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PermissionService, Scope } from '../auth/permission.service';
import { DomainError, forbidden, notFound } from '../common/errors';
import { AuthUser } from '../common/request';
import { DB } from '../database/database.module';
import { Db, one, Tx, withTransaction } from '../database/db';

/** Një veprim që kërkon aprovim: kush mund ta kërkojë dhe çfarë ndodh kur aprovohet. */
export interface ApprovalAction {
  /** Leja që duhet të ketë kërkuesi në degën e kërkesës. */
  requestPermission: string;
  /** Kontroll shtesë para krijimit të kërkesës (p.sh. ekziston përdoruesi?). */
  validate?: (tx: Tx, payload: Record<string, unknown>, branchId: number | null) => Promise<void>;
  /** Ekzekutohet në të njëjtin transaksion me aprovimin final. */
  execute: (tx: Tx, req: ApprovalRequestRow) => Promise<void>;
  /** Ekzekutohet kur kërkesa refuzohet ose anulohet (p.sh. për ta kthyer dokumentin në draft). */
  onClosedWithoutApproval?: (tx: Tx, req: ApprovalRequestRow) => Promise<void>;
}

export interface ApprovalRequestRow {
  id: string; action_code: string; branch_id: string | null; amount: string; payload: Record<string, unknown>;
  reason: string; policy_id: string; required_approvals: number; status: string; requested_by: string;
  created_at: Date; decided_at: Date | null;
}

export interface NewApprovalRequest {
  actionCode: string;
  branchId: number | null;
  /** Shuma si string dhjetor (p.sh. "1250.50") — kurrë float. */
  amount: string;
  payload: Record<string, unknown>;
  reason: string;
  idempotencyKey: string;
}

@Injectable()
export class ApprovalsService {
  private readonly actions = new Map<string, ApprovalAction>();

  constructor(@Inject(DB) private readonly db: Db, private readonly perms: PermissionService, private readonly audit: AuditService) {}

  register(actionCode: string, action: ApprovalAction): void {
    if (this.actions.has(actionCode)) throw new Error(`Veprimi ${actionCode} është regjistruar dy herë`);
    this.actions.set(actionCode, action);
  }

  private scopeOf(branchId: number | null): Scope {
    return branchId == null ? 'global' : branchId;
  }

  async request(actor: AuthUser, input: NewApprovalRequest): Promise<{ id: number; status: string; created: boolean }> {
    const action = this.actions.get(input.actionCode);
    if (!action) throw new DomainError('UNKNOWN_ACTION', `Veprim i panjohur: ${input.actionCode}`);
    if (!/^\d{1,15}(\.\d{1,4})?$/.test(input.amount)) throw new DomainError('VALIDATION', 'Shuma duhet të jetë numër dhjetor pozitiv');

    return withTransaction(this.db, (tx) => this.requestInTx(tx, actor, input));
  }

  /** Si `request`, por brenda transaksionit të thirrësit: dokumenti dhe kërkesa e tij ruhen ose dështojnë bashkë. */
  async requestInTx(tx: Tx, actor: AuthUser, input: NewApprovalRequest): Promise<{ id: number; status: string; created: boolean }> {
    if (!this.actions.has(input.actionCode)) throw new DomainError('UNKNOWN_ACTION', `Veprim i panjohur: ${input.actionCode}`);
    if (!/^\d{1,15}(\.\d{1,4})?$/.test(input.amount)) throw new DomainError('VALIDATION', 'Shuma duhet të jetë numër dhjetor pozitiv');
    const action = this.actions.get(input.actionCode) as ApprovalAction;
    {
      // Idempotencë: e njëjta kërkesë e dërguar dy herë nuk krijon dy aprovime.
      const existing = await one<{ id: string; status: string }>(tx,
        'SELECT id, status FROM approval_request WHERE requested_by = $1 AND idempotency_key = $2', [actor.id, input.idempotencyKey]);
      if (existing) return { id: Number(existing.id), status: existing.status, created: false };

      if (!(await this.perms.has(actor.id, action.requestPermission, this.scopeOf(input.branchId), tx))) throw forbidden();
      await action.validate?.(tx, input.payload, input.branchId);

      // Politika më specifike: dega para globales, pastaj pragu më i lartë që përputhet.
      const policy = await one<{ id: string; required_approvals: number }>(tx,
        `SELECT id, required_approvals FROM approval_policy
          WHERE is_active AND action_code = $1 AND min_amount <= $2::numeric
            AND (branch_id IS NULL OR branch_id = $3)
          ORDER BY (branch_id IS NOT NULL) DESC, min_amount DESC LIMIT 1`,
        [input.actionCode, input.amount, input.branchId]);
      // Pa politikë = bllokim (fail closed), jo kalim pa aprovim.
      if (!policy) throw new DomainError('NO_APPROVAL_POLICY', 'Nuk ka politikë aprovimi për këtë veprim; kontaktoni administratorin', 422);

      const row = await one<{ id: string }>(tx,
        `INSERT INTO approval_request(action_code, branch_id, amount, payload, reason, policy_id, required_approvals, requested_by, idempotency_key)
         VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [input.actionCode, input.branchId, input.amount, JSON.stringify(input.payload), input.reason, policy.id,
         policy.required_approvals, actor.id, input.idempotencyKey]);
      const id = Number(row?.id);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'approval.requested', entityType: 'approval_request', entityId: id,
        branchId: input.branchId, details: { actionCode: input.actionCode, amount: input.amount, reason: input.reason } });
      return { id, status: 'PENDING', created: true };
    }
  }

  /** A ka politikë aprovimi për këtë veprim dhe shumë? Përdoret kur aprovimi kërkohet vetëm mbi një prag. */
  async policyApplies(q: Db | Tx, actionCode: string, amount: string, branchId: number | null): Promise<boolean> {
    const r = await q.query(
      `SELECT 1 FROM approval_policy WHERE is_active AND action_code = $1 AND min_amount <= $2::numeric AND (branch_id IS NULL OR branch_id = $3) LIMIT 1`,
      [actionCode, amount, branchId]);
    return (r.rowCount ?? 0) > 0;
  }

  async decide(actor: AuthUser, requestId: number, decision: 'APPROVE' | 'REJECT', comment?: string): Promise<{ status: string }> {
    // Step-up: vendimet kërkojnë sesion të verifikuar me 2FA.
    if (!actor.mfaPassed) throw new DomainError('STEP_UP_REQUIRED', 'Për të vendosur mbi aprovime duhet 2FA aktive në këtë sesion', 403);

    return withTransaction(this.db, async (tx) => {
      const req = await one<ApprovalRequestRow & { approver_permission: string }>(tx,
        `SELECT r.*, p.approver_permission FROM approval_request r JOIN approval_policy p ON p.id = r.policy_id
          WHERE r.id = $1 FOR UPDATE OF r`, [requestId]);
      if (!req) throw notFound('Kërkesa për aprovim');
      const branchId = req.branch_id == null ? null : Number(req.branch_id);
      if (Number(req.requested_by) === actor.id) throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'Nuk mund ta aprovoni kërkesën tuaj', 403);
      if (req.status !== 'PENDING') throw new DomainError('APPROVAL_NOT_PENDING', 'Kërkesa nuk është më në pritje', 409);
      if (!(await this.perms.has(actor.id, req.approver_permission, this.scopeOf(branchId), tx))) throw forbidden('Nuk keni të drejtë të aprovoni këtë kërkesë');

      // Triggeri në DB e ndalon gjithashtu vetë-aprovimin dhe vendimin e dytë të të njëjtit person.
      await tx.query('INSERT INTO approval_decision(request_id, approver_id, decision, comment) VALUES ($1, $2, $3, $4)',
        [requestId, actor.id, decision, comment ?? null]);

      let status = 'PENDING';
      if (decision === 'REJECT') {
        status = 'REJECTED';
      } else {
        const cnt = await one<{ n: string }>(tx, `SELECT count(*) AS n FROM approval_decision WHERE request_id = $1 AND decision = 'APPROVE'`, [requestId]);
        if (Number(cnt?.n) >= req.required_approvals) status = 'APPROVED';
      }
      if (status !== 'PENDING') {
        await tx.query('UPDATE approval_request SET status = $2, decided_at = now() WHERE id = $1', [requestId, status]);
      }
      await this.audit.record(tx, { actorUserId: actor.id, action: `approval.${decision.toLowerCase()}`, entityType: 'approval_request',
        entityId: requestId, branchId, details: { resultingStatus: status, comment: comment ?? null } });

      if (status === 'REJECTED') {
        await this.actions.get(req.action_code)?.onClosedWithoutApproval?.(tx, req);
      }
      if (status === 'APPROVED') {
        const action = this.actions.get(req.action_code);
        if (!action) throw new DomainError('UNKNOWN_ACTION', `Veprim i panjohur: ${req.action_code}`, 500);
        await action.execute(tx, req);
        await this.audit.record(tx, { actorUserId: actor.id, action: 'approval.executed', entityType: 'approval_request',
          entityId: requestId, branchId, details: { actionCode: req.action_code } });
      }
      return { status };
    });
  }

  async cancel(actor: AuthUser, requestId: number): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const res = await tx.query(
        `UPDATE approval_request SET status = 'CANCELLED', decided_at = now()
          WHERE id = $1 AND requested_by = $2 AND status = 'PENDING' RETURNING *`, [requestId, actor.id]);
      if (!res.rowCount) throw new DomainError('CANNOT_CANCEL', 'Mund të anuloni vetëm kërkesat tuaja që janë në pritje', 409);
      const row = res.rows[0] as ApprovalRequestRow;
      await this.actions.get(row.action_code)?.onClosedWithoutApproval?.(tx, row);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'approval.cancelled', entityType: 'approval_request', entityId: requestId });
    });
  }

  /** Kërkesat në pritje që ky përdorues ka të drejtë t'i vendosë (pa ato të vetat). */
  async pendingFor(actor: AuthUser): Promise<ApprovalRequestRow[]> {
    const res = await this.db.query<ApprovalRequestRow>(
      `SELECT r.* FROM approval_request r JOIN approval_policy p ON p.id = r.policy_id
        WHERE r.status = 'PENDING' AND r.requested_by <> $1
          AND NOT EXISTS (SELECT 1 FROM approval_decision d WHERE d.request_id = r.id AND d.approver_id = $1)
          AND EXISTS (
            SELECT 1 FROM user_role ur JOIN role_permission rp ON rp.role_id = ur.role_id
             WHERE ur.user_id = $1 AND rp.permission_code = p.approver_permission
               AND ur.revoked_at IS NULL AND (ur.valid_until IS NULL OR ur.valid_until > now())
               AND (ur.branch_id IS NULL OR ur.branch_id = r.branch_id))
        ORDER BY r.created_at`, [actor.id]);
    return res.rows;
  }

  async mine(actor: AuthUser): Promise<ApprovalRequestRow[]> {
    const res = await this.db.query<ApprovalRequestRow>('SELECT * FROM approval_request WHERE requested_by = $1 ORDER BY id DESC LIMIT 200', [actor.id]);
    return res.rows;
  }
}
