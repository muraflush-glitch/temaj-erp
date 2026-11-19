import { Pool } from 'pg';
import { hashPassword } from '../auth/crypto';

/**
 * Të dhëna SINTETIKE për Development/Staging. Asnjë e dhënë reale e Temaj-it.
 * Emrat ligjorë, NUI dhe NRB mbeten bosh deri në OPEN-11.
 */
export const PERMISSIONS: [string, string][] = [
  ['org.read', 'Shiko degët, magazinat dhe rolet'],
  ['admin.users.manage', 'Krijo dhe çaktivizo përdorues'],
  ['admin.roles.request', 'Kërko dhënien e një roli (kalon në aprovim)'],
  ['admin.roles.revoke', 'Hiq një rol menjëherë'],
  ['approvals.access.decide', 'Aprovo ose refuzo kërkesat për qasje'],
  ['audit.read', 'Lexo audit trail-in'],
];

export const ROLES: { code: string; name: string; permissions: string[] }[] = [
  { code: 'SYSTEM_ADMIN', name: 'Administrator i sistemit', permissions: ['org.read', 'admin.users.manage', 'admin.roles.request', 'admin.roles.revoke', 'audit.read'] },
  { code: 'SECURITY_APPROVER', name: 'Aprovues i qasjes', permissions: ['org.read', 'approvals.access.decide', 'audit.read', 'admin.roles.revoke'] },
  { code: 'BRANCH_MANAGER', name: 'Menaxher dege', permissions: ['org.read', 'admin.roles.request'] },
  { code: 'EMPLOYEE', name: 'Punonjës', permissions: ['org.read'] },
];

export async function seed(pool: Pool, opts: { adminPassword: string; approverPassword: string }): Promise<void> {
  if (process.env.APP_ENV === 'production') throw new Error('Seed-i sintetik është i ndaluar në Production');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const [code, desc] of PERMISSIONS) {
      await c.query('INSERT INTO permission(code, description) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING', [code, desc]);
    }
    for (const r of ROLES) {
      const role = await c.query<{ id: string }>(
        `INSERT INTO role(code, name, is_system) VALUES ($1, $2, TRUE)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [r.code, r.name]);
      for (const p of r.permissions) {
        await c.query('INSERT INTO role_permission(role_id, permission_code) VALUES ($1, $2) ON CONFLICT DO NOTHING', [role.rows[0]?.id, p]);
      }
    }
    // Struktura juridike pret OPEN-01: modelohet si një subjekt i paverifikuar, i ndryshueshëm.
    const le = await c.query<{ id: string }>(
      `INSERT INTO legal_entity(code, name, verified) VALUES ('TEMAJ', 'Temaj Qeramike (pa verifikuar)', FALSE)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
    const leId = le.rows[0]?.id;
    for (const [code, name, city] of [['PZ', 'Dega Prizren', 'Prizren'], ['PR', 'Dega Prishtinë', 'Prishtinë']] as const) {
      const b = await c.query<{ id: string }>(
        `INSERT INTO branch(legal_entity_id, code, name, city) VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [leId, code, name, city]);
      await c.query(
        `INSERT INTO warehouse(branch_id, code, name) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
        [b.rows[0]?.id, `${code}-MAIN`, `Magazina kryesore ${city}`]);
    }
    await c.query(
      `INSERT INTO approval_policy(action_code, branch_id, min_amount, required_approvals, approver_permission, escalate_after_hours)
       SELECT 'access.grant_role', NULL, 0, 1, 'approvals.access.decide', 24
        WHERE NOT EXISTS (SELECT 1 FROM approval_policy WHERE action_code = 'access.grant_role' AND branch_id IS NULL)`);

    const users: [string, string, string, string][] = [
      ['admin@temaj.test', 'Administrator (test)', opts.adminPassword, 'SYSTEM_ADMIN'],
      ['aprovues@temaj.test', 'Aprovues (test)', opts.approverPassword, 'SECURITY_APPROVER'],
    ];
    for (const [email, name, pw, roleCode] of users) {
      const u = await c.query<{ id: string }>(
        `INSERT INTO app_user(email, display_name, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`, [email, name, await hashPassword(pw)]);
      await c.query(
        `INSERT INTO user_role(user_id, role_id, branch_id)
         SELECT $1, id, NULL FROM role WHERE code = $2
         ON CONFLICT DO NOTHING`, [u.rows[0]?.id, roleCode]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
