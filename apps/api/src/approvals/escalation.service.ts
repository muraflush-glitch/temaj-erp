import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { DB } from '../database/database.module';
import { Db, withTransaction } from '../database/db';
import { NOTIFICATION_TOPIC } from '../outbox/dev-notification.sink';
import { OutboxService } from '../outbox/outbox.service';

/**
 * DEC-G52-09: aprovimet pa përgjigje eskalohen pas afatit.
 * Njoftohen të gjithë përdoruesit aktivë me rolin aprovues për atë degë (përveç kërkuesit).
 */
@Injectable()
export class EscalationService {
  constructor(@Inject(DB) private readonly db: Db, private readonly outbox: OutboxService, private readonly audit: AuditService) {}

  async escalateOverdue(now?: Date): Promise<number> {
    return withTransaction(this.db, async (tx) => {
      const overdue = await tx.query<{ id: string; branch_id: string | null; action_code: string; requested_by: string; approver_permission: string }>(
        `SELECT r.id, r.branch_id, r.action_code, r.requested_by, p.approver_permission
           FROM approval_request r JOIN approval_policy p ON p.id = r.policy_id
          WHERE r.status = 'PENDING' AND r.escalated_at IS NULL AND p.escalate_after_hours IS NOT NULL
            AND r.created_at + make_interval(hours => p.escalate_after_hours) <= COALESCE($1::timestamptz, now())
          ORDER BY r.id FOR UPDATE OF r SKIP LOCKED`, [now?.toISOString() ?? null]);
      for (const r of overdue.rows) {
        const approvers = await tx.query<{ email: string }>(
          `SELECT DISTINCT u.email FROM user_role ur
             JOIN role_permission rp ON rp.role_id = ur.role_id AND rp.permission_code = $1
             JOIN app_user u ON u.id = ur.user_id AND u.is_active
            WHERE ur.revoked_at IS NULL AND (ur.valid_until IS NULL OR ur.valid_until > now())
              AND (ur.branch_id IS NULL OR ur.branch_id = $2) AND u.id <> $3`,
          [r.approver_permission, r.branch_id, r.requested_by]);
        for (const a of approvers.rows) {
          await this.outbox.enqueue(tx, NOTIFICATION_TOPIC, {
            channel: 'email', recipient: a.email,
            subject: `Aprovim i vonuar #${r.id}`,
            body: `Kërkesa #${r.id} (${r.action_code}) pret vendimin tuaj përtej afatit.`,
          }, `escalation:${r.id}:${a.email}`);
        }
        await tx.query('UPDATE approval_request SET escalated_at = COALESCE($2::timestamptz, now()) WHERE id = $1', [r.id, now?.toISOString() ?? null]);
        await this.audit.record(tx, { actorUserId: null, action: 'approval.escalated', entityType: 'approval_request', entityId: r.id,
          branchId: r.branch_id == null ? null : Number(r.branch_id), details: { notified: approvers.rowCount } });
      }
      return overdue.rowCount ?? 0;
    });
  }
}
