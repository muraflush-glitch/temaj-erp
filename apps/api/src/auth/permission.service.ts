import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module';
import { Db, Tx } from '../database/db';

export type Scope = number | 'any' | 'global';

@Injectable()
export class PermissionService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * scope 'any' = në cilëndo degë; 'global' = vetëm rol për gjithë kompaninë;
   * number = në atë degë (rol i degës ose rol global). Rolet e revokuara ose të skaduara nuk llogariten.
   */
  async has(userId: number, permission: string, scope: Scope = 'any', q: Db | Tx = this.db): Promise<boolean> {
    const branchId = typeof scope === 'number' ? scope : null;
    const res = await q.query(
      `SELECT 1 FROM user_role ur
         JOIN role_permission rp ON rp.role_id = ur.role_id
         JOIN app_user u ON u.id = ur.user_id AND u.is_active
        WHERE ur.user_id = $1 AND rp.permission_code = $2
          AND ur.revoked_at IS NULL AND (ur.valid_until IS NULL OR ur.valid_until > now())
          AND CASE $4::text
                WHEN 'any' THEN TRUE
                WHEN 'global' THEN ur.branch_id IS NULL
                ELSE (ur.branch_id IS NULL OR ur.branch_id = $3) END
        LIMIT 1`,
      [userId, permission, branchId, typeof scope === 'number' ? 'branch' : scope],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async listForUser(userId: number): Promise<{ permission: string; branch_id: number | null }[]> {
    const res = await this.db.query<{ permission: string; branch_id: string | null }>(
      `SELECT DISTINCT rp.permission_code AS permission, ur.branch_id
         FROM user_role ur JOIN role_permission rp ON rp.role_id = ur.role_id
        WHERE ur.user_id = $1 AND ur.revoked_at IS NULL AND (ur.valid_until IS NULL OR ur.valid_until > now())
        ORDER BY 1, 2`,
      [userId],
    );
    return res.rows.map((r) => ({ permission: r.permission, branch_id: r.branch_id == null ? null : Number(r.branch_id) }));
  }
}
