import { INestApplication } from '@nestjs/common';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Pool } from 'pg';
import request from 'supertest';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { migrate } from '../src/database/migrate';
import { ADMIN, APPROVER, createApp, freshDatabase, login, loginWithMfa } from './helpers';

let pool: Pool;
let app: INestApplication;
const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  pool = await freshDatabase();
  app = await createApp();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

async function branchId(code: string): Promise<number> {
  const r = await pool.query<{ id: string }>('SELECT id FROM branch WHERE code = $1', [code]);
  return Number(r.rows[0]?.id);
}

async function createUser(adminToken: string, email: string): Promise<number> {
  const res = await http().post('/api/access/users').set(auth(adminToken))
    .send({ email, displayName: `Test ${email}`, password: 'Punonjes-Test-Fjalekalim-1' });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe('Migrimet', () => {
  it('ekzekutimi i dytë nuk aplikon asgjë', async () => {
    expect(await migrate(pool)).toEqual([]);
  });

  it('zbulon një migrim të ndryshuar pas aplikimit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    writeFileSync(join(dir, '001_foundation.sql'), 'SELECT 1;');
    await expect(migrate(pool, dir)).rejects.toThrow(/checksum/);
  });
});

describe('Hyrja në sistem dhe sesionet', () => {
  it('pa token → 401; /health është publik', async () => {
    expect((await http().get('/api/org/branches')).status).toBe(401);
    expect((await http().get('/api/health')).status).toBe(200);
  });

  it('fjalëkalim i gabuar → 401 me mesazh të përgjithshëm', async () => {
    const res = await http().post('/api/auth/login').send({ email: ADMIN.email, password: 'gabim-gabim-gabim' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_LOGIN');
  });

  it('bllokon llogarinë pas 5 tentativave të dështuara', async () => {
    const t = await login(app, ADMIN.email, ADMIN.password);
    await createUser(t, 'bllokim@temaj.test');
    for (let i = 0; i < 5; i++) {
      await http().post('/api/auth/login').send({ email: 'bllokim@temaj.test', password: 'gabim-gabim-gabim' });
    }
    const res = await http().post('/api/auth/login').send({ email: 'bllokim@temaj.test', password: 'Punonjes-Test-Fjalekalim-1' });
    expect(res.status).toBe(423);
    expect(res.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('/auth/me kthen lejet; logout e revokon sesionin menjëherë', async () => {
    const t = await login(app, ADMIN.email, ADMIN.password);
    const me = await http().get('/api/auth/me').set(auth(t));
    expect(me.status).toBe(200);
    expect(me.body.permissions.map((p: { permission: string }) => p.permission)).toContain('admin.users.manage');
    expect((await http().post('/api/auth/logout').set(auth(t))).status).toBe(204);
    expect((await http().get('/api/auth/me').set(auth(t))).status).toBe(401);
  });

  it('token-i nuk ruhet në databazë, vetëm hash-i i tij', async () => {
    const t = await login(app, ADMIN.email, ADMIN.password);
    const r = await pool.query('SELECT 1 FROM user_session WHERE token_hash = $1', [t]);
    expect(r.rowCount).toBe(0);
  });

  it('me 2FA aktive, hyrja pa kod refuzohet', async () => {
    const t = await login(app, ADMIN.email, ADMIN.password);
    await createUser(t, 'mfa@temaj.test');
    await loginWithMfa(app, 'mfa@temaj.test', 'Punonjes-Test-Fjalekalim-1');
    const res = await http().post('/api/auth/login').send({ email: 'mfa@temaj.test', password: 'Punonjes-Test-Fjalekalim-1' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MFA_REQUIRED');
    const bad = await http().post('/api/auth/login').send({ email: 'mfa@temaj.test', password: 'Punonjes-Test-Fjalekalim-1', totp: '000000' });
    expect(bad.body.code).toBe('MFA_INVALID');
  });
});

describe('Lejet', () => {
  it('përdorues pa rol nuk lexon degët as auditin', async () => {
    const admin = await login(app, ADMIN.email, ADMIN.password);
    await createUser(admin, 'pa-rol@temaj.test');
    const t = await login(app, 'pa-rol@temaj.test', 'Punonjes-Test-Fjalekalim-1');
    expect((await http().get('/api/org/branches').set(auth(t))).status).toBe(403);
    expect((await http().get('/api/audit').set(auth(t))).status).toBe(403);
  });

  it('roli i skaduar nuk jep më leje', async () => {
    const admin = await login(app, ADMIN.email, ADMIN.password);
    const uid = await createUser(admin, 'skaduar@temaj.test');
    await pool.query(
      `INSERT INTO user_role(user_id, role_id, branch_id, valid_until)
       SELECT $1, id, NULL, now() - interval '1 minute' FROM role WHERE code = 'EMPLOYEE'`, [uid]);
    const t = await login(app, 'skaduar@temaj.test', 'Punonjes-Test-Fjalekalim-1');
    expect((await http().get('/api/org/branches').set(auth(t))).status).toBe(403);
  });

  it('të dyja degët ekzistojnë me magazinat e tyre', async () => {
    const t = await login(app, ADMIN.email, ADMIN.password);
    const res = await http().get('/api/org/branches').set(auth(t));
    expect(res.body.map((b: { code: string }) => b.code)).toEqual(['PR', 'PZ']);
    const wh = await http().get('/api/org/warehouses').set(auth(t));
    expect(wh.body).toHaveLength(2);
  });
});

describe('Aprovimet me katër sy (dhënia e roleve)', () => {
  let adminToken: string;
  let approverToken: string;
  let targetUser: number;

  beforeAll(async () => {
    adminToken = await login(app, ADMIN.email, ADMIN.password);
    targetUser = await createUser(adminToken, 'punonjes.pz@temaj.test');
    approverToken = (await loginWithMfa(app, APPROVER.email, APPROVER.password)).token;
  });

  it('dhënia e rolit krijon kërkesë në pritje, jo rol të menjëhershëm', async () => {
    const res = await http().post('/api/access/role-grants').set(auth(adminToken)).send({
      userId: targetUser, roleCode: 'EMPLOYEE', branchId: await branchId('PZ'), reason: 'Punonjës i ri në Prizren', idempotencyKey: 'grant-pz-0001',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PENDING', created: true });
    const t = await login(app, 'punonjes.pz@temaj.test', 'Punonjes-Test-Fjalekalim-1');
    expect((await http().get('/api/org/branches').set(auth(t))).status).toBe(403);
  });

  it('e njëjta kërkesë e dërguar dy herë nuk krijon dy aprovime (idempotencë)', async () => {
    const body = { userId: targetUser, roleCode: 'EMPLOYEE', branchId: await branchId('PZ'), reason: 'Punonjës i ri në Prizren', idempotencyKey: 'grant-pz-0001' };
    const res = await http().post('/api/access/role-grants').set(auth(adminToken)).send(body);
    expect(res.body.created).toBe(false);
    const n = await pool.query(`SELECT count(*)::int AS n FROM approval_request WHERE idempotency_key = 'grant-pz-0001'`);
    expect(n.rows[0].n).toBe(1);
  });

  it('aprovuesi pa 2FA në sesion bllokohet (step-up)', async () => {
    const pending = await pool.query<{ id: string }>(`SELECT id FROM approval_request WHERE idempotency_key = 'grant-pz-0001'`);
    const plainSession = await login(app, APPROVER.email, APPROVER.password, undefined).catch(() => null);
    // Aprovuesi ka 2FA aktive, prandaj hyrja pa kod nuk lejohet fare.
    expect(plainSession).toBeNull();
    // Sesion pa mfa_passed (p.sh. i krijuar para aktivizimit të 2FA) → STEP_UP_REQUIRED
    const adminRes = await http().post(`/api/approvals/${pending.rows[0]?.id}/decide`).set(auth(adminToken)).send({ decision: 'APPROVE' });
    expect(adminRes.status).toBe(403);
    expect(adminRes.body.code).toBe('STEP_UP_REQUIRED');
  });

  it('aprovuesi me 2FA aprovon → roli jepet në të njëjtin transaksion', async () => {
    const list = await http().get('/api/approvals/pending').set(auth(approverToken));
    expect(list.status).toBe(200);
    const item = list.body.find((r: { idempotency_key: string }) => r.idempotency_key === 'grant-pz-0001');
    expect(item).toBeDefined();
    const res = await http().post(`/api/approvals/${item.id}/decide`).set(auth(approverToken)).send({ decision: 'APPROVE', comment: 'OK' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    const t = await login(app, 'punonjes.pz@temaj.test', 'Punonjes-Test-Fjalekalim-1');
    expect((await http().get('/api/org/branches').set(auth(t))).status).toBe(200);
  });

  it('vendimi i dytë mbi të njëjtën kërkesë refuzohet', async () => {
    const r = await pool.query<{ id: string }>(`SELECT id FROM approval_request WHERE idempotency_key = 'grant-pz-0001'`);
    const res = await http().post(`/api/approvals/${r.rows[0]?.id}/decide`).set(auth(approverToken)).send({ decision: 'REJECT' });
    expect(res.status).toBe(409);
  });

  it('databaza vetë e ndalon vetë-aprovimin, edhe nëse kodi anashkalohet', async () => {
    const adminId = (await pool.query<{ id: string }>(`SELECT id FROM app_user WHERE email = $1`, [ADMIN.email])).rows[0]?.id;
    const req = await pool.query<{ id: string }>(
      `INSERT INTO approval_request(action_code, branch_id, amount, reason, policy_id, required_approvals, requested_by, idempotency_key)
       SELECT 'access.grant_role', NULL, 0, 'test', id, 1, $1, 'self-test-1' FROM approval_policy LIMIT 1 RETURNING id`, [adminId]);
    await expect(pool.query(
      `INSERT INTO approval_decision(request_id, approver_id, decision) VALUES ($1, $2, 'APPROVE')`, [req.rows[0]?.id, adminId],
    )).rejects.toThrow(/SELF_APPROVAL_FORBIDDEN/);
  });

  it('nuk mund të kërkosh role për veten', async () => {
    const me = await http().get('/api/auth/me').set(auth(adminToken));
    const res = await http().post('/api/access/role-grants').set(auth(adminToken)).send({
      userId: me.body.id, roleCode: 'SECURITY_APPROVER', branchId: null, reason: 'Dua më shumë leje', idempotencyKey: 'self-grant-1',
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SELF_GRANT_FORBIDDEN');
  });

  it('refuzimi nuk jep rolin', async () => {
    const uid = await createUser(adminToken, 'refuzuar@temaj.test');
    const req = await http().post('/api/access/role-grants').set(auth(adminToken)).send({
      userId: uid, roleCode: 'SYSTEM_ADMIN', branchId: null, reason: 'Kërkesë testuese', idempotencyKey: 'grant-reject-1',
    });
    const res = await http().post(`/api/approvals/${req.body.id}/decide`).set(auth(approverToken)).send({ decision: 'REJECT', comment: 'Jo' });
    expect(res.body.status).toBe('REJECTED');
    const roles = await pool.query('SELECT 1 FROM user_role WHERE user_id = $1', [uid]);
    expect(roles.rowCount).toBe(0);
  });

  it('veprim pa politikë aprovimi bllokohet (fail closed)', async () => {
    app.get(ApprovalsService).register('test.no_policy', { requestPermission: 'org.read', execute: async () => undefined });
    const me = await http().get('/api/auth/me').set(auth(adminToken));
    await expect(app.get(ApprovalsService).request(
      { id: me.body.id, sessionId: 0, mfaPassed: false },
      { actionCode: 'test.no_policy', branchId: null, amount: '10.00', payload: {}, reason: 'test', idempotencyKey: 'no-policy-1' },
    )).rejects.toMatchObject({ code: 'NO_APPROVAL_POLICY' });
  });

  it('heqja e rolit hyn në fuqi menjëherë', async () => {
    const ur = await pool.query<{ id: string }>(
      `SELECT ur.id FROM user_role ur JOIN app_user u ON u.id = ur.user_id WHERE u.email = 'punonjes.pz@temaj.test' AND ur.revoked_at IS NULL`);
    const res = await http().post(`/api/access/user-roles/${ur.rows[0]?.id}/revoke`).set(auth(adminToken)).send({ reason: 'Largim nga puna' });
    expect(res.status).toBe(204);
    const t = await login(app, 'punonjes.pz@temaj.test', 'Punonjes-Test-Fjalekalim-1');
    expect((await http().get('/api/org/branches').set(auth(t))).status).toBe(403);
  });

  it('çaktivizimi i përdoruesit revokon sesionet e hapura', async () => {
    const uid = await createUser(adminToken, 'largohet@temaj.test');
    const t = await login(app, 'largohet@temaj.test', 'Punonjes-Test-Fjalekalim-1');
    expect((await http().get('/api/auth/me').set(auth(t))).status).toBe(200);
    expect((await http().post(`/api/access/users/${uid}/deactivate`).set(auth(adminToken)).send({ reason: 'Largim nga puna' })).status).toBe(204);
    expect((await http().get('/api/auth/me').set(auth(t))).status).toBe(401);
  });
});

describe('Audit trail', () => {
  it('regjistron veprimet kryesore', async () => {
    const t = await login(app, ADMIN.email, ADMIN.password);
    const res = await http().get('/api/audit?limit=500').set(auth(t));
    const actions = new Set(res.body.map((r: { action: string }) => r.action));
    for (const a of ['auth.login', 'auth.login_failed', 'user.created', 'approval.requested', 'approval.approve', 'approval.executed', 'access.role_granted', 'access.role_revoked', 'user.deactivated']) {
      expect(actions).toContain(a);
    }
  });

  it('nuk ruan fjalëkalime ose hash-e në audit', async () => {
    const secrets = [ADMIN.password, APPROVER.password, 'Punonjes-Test-Fjalekalim-1', 'gabim-gabim-gabim', 'scrypt$'];
    for (const s of secrets) {
      const r = await pool.query('SELECT 1 FROM audit_log WHERE strpos(details::text, $1) > 0', [s]);
      expect(r.rowCount).toBe(0);
    }
  });

  it('UPDATE dhe DELETE mbi auditin refuzohen', async () => {
    await expect(pool.query(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/AUDIT_LOG_APPEND_ONLY/);
    await expect(pool.query(`DELETE FROM audit_log`)).rejects.toThrow(/AUDIT_LOG_APPEND_ONLY/);
  });

  it('zinxhiri mbetet i rregullt edhe me 200 shkrime paralele', async () => {
    await Promise.all(Array.from({ length: 200 }, (_, i) => pool.query(
      `INSERT INTO audit_log(action, entity_type, entity_id, details, prev_hash, hash) VALUES ('test.parallel', 'test', $1, '{}', '', '')`, [String(i)])));
    const v = await pool.query<{ b: string | null }>('SELECT audit_log_verify() AS b');
    expect(v.rows[0]?.b).toBeNull();
  });

  it('zinxhiri i hash-eve është i paprekur dhe zbulon ndërhyrjen', async () => {
    const t = await login(app, ADMIN.email, ADMIN.password);
    expect((await http().get('/api/audit/verify').set(auth(t))).body).toEqual({ intact: true, firstBrokenId: null });
    // Simulojmë një sulmues me qasje superuser që çaktivizon mbrojtjen dhe ndryshon një rresht.
    const target = await pool.query<{ id: string }>(`SELECT id FROM audit_log ORDER BY id LIMIT 1 OFFSET 2`);
    await pool.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update');
    await pool.query(`UPDATE audit_log SET details = '{"ndryshuar":true}' WHERE id = $1`, [target.rows[0]?.id]);
    await pool.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update');
    const v = await http().get('/api/audit/verify').set(auth(t));
    expect(v.body).toEqual({ intact: false, firstBrokenId: Number(target.rows[0]?.id) });
  });
});
