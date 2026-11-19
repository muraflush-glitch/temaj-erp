import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module';
import { Db, Tx } from '../database/db';

export interface AuditEntry {
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  branchId?: number | null;
  details?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Shkruan brenda transaksionit të veprimit, që auditi dhe veprimi të ruhen ose dështojnë bashkë. */
  async record(q: Db | Tx, e: AuditEntry): Promise<void> {
    await q.query(
      `INSERT INTO audit_log(actor_user_id, action, entity_type, entity_id, branch_id, details, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, '', '')`,
      [e.actorUserId, e.action, e.entityType, e.entityId == null ? null : String(e.entityId), e.branchId ?? null, JSON.stringify(e.details ?? {})],
    );
  }

  async list(limit: number, entityType?: string): Promise<unknown[]> {
    const res = await this.db.query(
      `SELECT id, occurred_at, actor_user_id, action, entity_type, entity_id, branch_id, details, hash
         FROM audit_log WHERE ($2::text IS NULL OR entity_type = $2) ORDER BY id DESC LIMIT $1`,
      [limit, entityType ?? null],
    );
    return res.rows;
  }

  /** Kthen null nëse zinxhiri është i paprekur, përndryshe ID-në e parë të dëmtuar. */
  async verifyChain(): Promise<number | null> {
    const res = await this.db.query<{ broken: string | null }>('SELECT audit_log_verify() AS broken');
    const broken = res.rows[0]?.broken;
    return broken == null ? null : Number(broken);
  }
}
