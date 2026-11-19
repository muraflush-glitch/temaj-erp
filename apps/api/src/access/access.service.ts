import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/crypto';
import { PermissionService } from '../auth/permission.service';
import { DomainError, forbidden, notFound } from '../common/errors';
import { AuthUser } from '../common/request';
import { DB } from '../database/database.module';
import { Db, one, Tx, withTransaction } from '../database/db';

export const GRANT_ROLE = 'access.grant_role';

/**
 * Menaxhimi i qasjes. Dhënia e një roli kalon gjithmonë përmes aprovimit (katër sy);
 * heqja e qasjes bëhet menjëherë, sepse ul rrezikun.
 */
@Injectable()
export class AccessService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly approvals: ApprovalsService,
    private readonly perms: PermissionService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.approvals.register(GRANT_ROLE, {
      requestPermission: 'admin.roles.request',
      validate: async (tx, payload) => { await this.resolveGrant(tx, payload); },
      execute: async (tx, req) => {
        const g = await this.resolveGrant(tx, req.payload);
        await tx.query(
          `INSERT INTO user_role(user_id, role_id, branch_id, granted_by, valid_until) VALUES ($1, $2, $3, $4, $5)`,
          [g.userId, g.roleId, req.branch_id, req.requested_by, g.validUntil]);
        await this.audit.record(tx, { actorUserId: Number(req.requested_by), action: 'access.role_granted', entityType: 'app_user',
          entityId: g.userId, branchId: req.branch_id == null ? null : Number(req.branch_id),
          details: { roleCode: g.roleCode, approvalRequestId: Number(req.id), validUntil: g.validUntil } });
      },
    });
  }

  private async resolveGrant(tx: Tx, payload: Record<string, unknown>) {
    const userId = Number(payload['userId']);
    const roleCode = String(payload['roleCode'] ?? '');
    const validUntil = payload['validUntil'] == null ? null : String(payload['validUntil']);
    const user = await one<{ id: string }>(tx, 'SELECT id FROM app_user WHERE id = $1 AND is_active', [userId]);
    if (!user) throw notFound('Përdoruesi');
    const role = await one<{ id: string }>(tx, 'SELECT id FROM role WHERE code = $1', [roleCode]);
    if (!role) throw notFound('Roli');
    return { userId, roleId: Number(role.id), roleCode, validUntil };
  }

  async requestRoleGrant(actor: AuthUser, input: { userId: number; roleCode: string; branchId: number | null; validUntil?: string; reason: string; idempotencyKey: string }) {
    if (input.userId === actor.id) throw new DomainError('SELF_GRANT_FORBIDDEN', 'Nuk mund të kërkoni role për veten', 403);
    return this.approvals.request(actor, {
      actionCode: GRANT_ROLE, branchId: input.branchId, amount: '0', reason: input.reason, idempotencyKey: input.idempotencyKey,
      payload: { userId: input.userId, roleCode: input.roleCode, validUntil: input.validUntil ?? null },
    });
  }

  async revokeRole(actor: AuthUser, userRoleId: number, reason: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const ur = await one<{ user_id: string; branch_id: string | null }>(tx,
        'SELECT user_id, branch_id FROM user_role WHERE id = $1 AND revoked_at IS NULL FOR UPDATE', [userRoleId]);
      if (!ur) throw notFound('Roli aktiv');
      const scope = ur.branch_id == null ? 'global' as const : Number(ur.branch_id);
      if (!(await this.perms.has(actor.id, 'admin.roles.revoke', scope, tx))) throw forbidden();
      await tx.query('UPDATE user_role SET revoked_at = now() WHERE id = $1', [userRoleId]);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'access.role_revoked', entityType: 'app_user', entityId: ur.user_id,
        branchId: scope === 'global' ? null : scope, details: { userRoleId, reason } });
    });
  }

  async createUser(actor: AuthUser, input: { email: string; displayName: string; password: string }): Promise<{ id: number }> {
    if (!(await this.perms.has(actor.id, 'admin.users.manage', 'global'))) throw forbidden();
    const hash = await hashPassword(input.password);
    return withTransaction(this.db, async (tx) => {
      const row = await one<{ id: string }>(tx,
        'INSERT INTO app_user(email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id', [input.email, input.displayName, hash]);
      const id = Number(row?.id);
      // Asnjë fjalëkalim apo hash në audit.
      await this.audit.record(tx, { actorUserId: actor.id, action: 'user.created', entityType: 'app_user', entityId: id, details: { email: input.email } });
      return { id };
    });
  }

  async deactivateUser(actor: AuthUser, userId: number, reason: string): Promise<void> {
    if (!(await this.perms.has(actor.id, 'admin.users.manage', 'global'))) throw forbidden();
    if (userId === actor.id) throw new DomainError('SELF_DEACTIVATE_FORBIDDEN', 'Nuk mund ta çaktivizoni llogarinë tuaj', 403);
    await withTransaction(this.db, async (tx) => {
      const res = await tx.query('UPDATE app_user SET is_active = FALSE WHERE id = $1 AND is_active', [userId]);
      if (!res.rowCount) throw notFound('Përdoruesi aktiv');
      await tx.query('UPDATE user_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'user.deactivated', entityType: 'app_user', entityId: userId, details: { reason } });
    });
  }

  async listUsers(actor: AuthUser) {
    if (!(await this.perms.has(actor.id, 'admin.users.manage', 'any'))) throw forbidden();
    const res = await this.db.query(
      `SELECT u.id, u.email, u.display_name, u.is_active, u.mfa_enabled,
              COALESCE(json_agg(json_build_object('userRoleId', ur.id, 'role', r.code, 'branchId', ur.branch_id, 'validUntil', ur.valid_until))
                       FILTER (WHERE ur.id IS NOT NULL), '[]') AS roles
         FROM app_user u
         LEFT JOIN user_role ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
         LEFT JOIN role r ON r.id = ur.role_id
        GROUP BY u.id ORDER BY u.display_name`);
    return res.rows;
  }
}
