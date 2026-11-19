import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { EscalationService } from '../src/approvals/escalation.service';
import { decryptSecret, encryptSecret } from '../src/common/secrets';
import { NOTIFICATION_TOPIC } from '../src/outbox/dev-notification.sink';
import { OutboxService } from '../src/outbox/outbox.service';
import { ADMIN, APPROVER, createApp, freshDatabase, login, loginWithMfa } from './helpers';

let pool: Pool;
let app: INestApplication;
const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => { pool = await freshDatabase(); app = await createApp(); });
afterAll(async () => { await app.close(); await pool.end(); });

describe('Enkriptimi i çelësave 2FA', () => {
  it('çelësi 2FA nuk ruhet si tekst i lexueshëm në databazë', async () => {
    const { secret } = await loginWithMfa(app, APPROVER.email, APPROVER.password);
    const r = await pool.query<{ mfa_secret: string }>('SELECT mfa_secret FROM app_user WHERE email = $1', [APPROVER.email]);
    const stored = r.rows[0]?.mfa_secret ?? '';
    expect(stored.startsWith('v1:k1:')).toBe(true);
    expect(stored).not.toContain(secret);
  });

  it('databaza refuzon një çelës 2FA të paenkriptuar', async () => {
    await expect(pool.query(`UPDATE app_user SET mfa_secret = 'JBSWY3DPEHPK3PXP' WHERE email = $1`, [ADMIN.email]))
      .rejects.toThrow(/app_user_mfa_secret_encrypted/);
  });

  it('sekreti i kopjuar te një përdorues tjetër nuk dekriptohet (AAD)', () => {
    const blob = encryptSecret('SEKRET', 'user:1');
    expect(decryptSecret(blob, 'user:1')).toBe('SEKRET');
    expect(() => decryptSecret(blob, 'user:2')).toThrow();
  });

  it('rrotullimi i çelësit: të dhënat e vjetra lexohen ende me çelësin e vjetër', () => {
    const old = encryptSecret('SEKRET', 'user:7');
    process.env.SECRET_ACTIVE_KEY_ID = 'k2';
    try {
      const fresh = encryptSecret('SEKRET', 'user:7');
      expect(fresh.startsWith('v1:k2:')).toBe(true);
      expect(decryptSecret(old, 'user:7')).toBe('SEKRET');
    } finally { process.env.SECRET_ACTIVE_KEY_ID = 'k1'; }
  });

  it('ndryshimi i një bajti zbulohet (GCM)', () => {
    const parts = encryptSecret('SEKRET', 'user:1').split(':');
    const ct = Buffer.from(parts[4] ?? '', 'base64'); ct[0] = (ct[0] ?? 0) ^ 1; parts[4] = ct.toString('base64');
    expect(() => decryptSecret(parts.join(':'), 'user:1')).toThrow();
  });
});

describe('Kufizimi sipas IP-së', () => {
  it('pas kufirit, edhe fjalëkalimi i saktë refuzohet me 429 nga e njëjta IP', async () => {
    await pool.query('DELETE FROM login_attempt');
    process.env.LOGIN_IP_LIMIT = '3';
    try {
      for (let i = 0; i < 3; i++) {
        await http().post('/api/auth/login').send({ email: `x${i}@temaj.test`, password: 'gabim-gabim-gabim' });
      }
      const res = await http().post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password });
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('RATE_LIMITED');
    } finally {
      process.env.LOGIN_IP_LIMIT = '1000';
      await pool.query('DELETE FROM login_attempt');
    }
  });
});

describe('Outbox', () => {
  let outbox: OutboxService;
  beforeAll(() => { outbox = app.get(OutboxService); });

  it('idempotenca: e njëjta ngjarje nuk regjistrohet dy herë', async () => {
    await outbox.enqueue(pool, NOTIFICATION_TOPIC, { recipient: 'a@temaj.test', subject: 'Test' }, 'ev-1');
    await outbox.enqueue(pool, NOTIFICATION_TOPIC, { recipient: 'a@temaj.test', subject: 'Test' }, 'ev-1');
    const n = await pool.query(`SELECT count(*)::int AS n FROM outbox_event WHERE idempotency_key = 'ev-1'`);
    expect(n.rows[0].n).toBe(1);
    const stats = await outbox.processBatch();
    expect(stats.done).toBe(1);
    const sink = await pool.query(`SELECT recipient FROM dev_notification_sink`);
    expect(sink.rows).toEqual([{ recipient: 'a@temaj.test' }]);
  });

  it('ngjarja e anuluar me rollback nuk dërgohet kurrë', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await outbox.enqueue(c, NOTIFICATION_TOPIC, { recipient: 'b@temaj.test', subject: 'Rollback' }, 'ev-rollback');
      await c.query('ROLLBACK');
    } finally { c.release(); }
    const n = await pool.query(`SELECT 1 FROM outbox_event WHERE idempotency_key = 'ev-rollback'`);
    expect(n.rowCount).toBe(0);
  });

  it('dështimi riprovohet me vonesë dhe pas kufirit shkon në dead-letter', async () => {
    let calls = 0;
    outbox.on('test.always_fails', async () => { calls++; throw new Error('Ofruesi nuk përgjigjet'); });
    await pool.query(`INSERT INTO outbox_event(topic, payload, idempotency_key, max_attempts) VALUES ('test.always_fails', '{}', 'ev-fail', 3)`);
    let t = Date.now() + 1000; // kufi sigurie mbi orën e databazës
    const s1 = await outbox.processBatch(20, new Date(t));
    expect(s1.retried).toBe(1);
    // E njëjta kohë: ende nuk është gati për riprovim.
    expect((await outbox.processBatch(20, new Date(t))).retried).toBe(0);
    t += 31_000; await outbox.processBatch(20, new Date(t));
    t += 61_000; const s3 = await outbox.processBatch(20, new Date(t));
    expect(s3.dead).toBe(1);
    expect(calls).toBe(3);
    const dead = await outbox.deadLetters();
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ topic: 'test.always_fails', last_error: 'Ofruesi nuk përgjigjet' });
  });

  it('dy punëtorë paralelë nuk e përpunojnë të njëjtën ngjarje dy herë', async () => {
    let calls = 0;
    outbox.on('test.count', async () => { calls++; await new Promise((r) => setTimeout(r, 20)); });
    for (let i = 0; i < 10; i++) {
      await outbox.enqueue(pool, 'test.count', {}, `ev-count-${i}`);
    }
    await Promise.all([outbox.processBatch(10), outbox.processBatch(10), outbox.processBatch(10)]);
    expect(calls).toBe(10);
  });
});

describe('Eskalimi i aprovimeve (DEC-G52-09)', () => {
  it('kërkesa e vonuar njofton aprovuesit një herë, jo kërkuesin', async () => {
    const admin = await login(app, ADMIN.email, ADMIN.password);
    const u = await http().post('/api/access/users').set(auth(admin)).send({ email: 'eskalim@temaj.test', displayName: 'Eskalim', password: 'Punonjes-Test-Fjalekalim-1' });
    const req = await http().post('/api/access/role-grants').set(auth(admin)).send({
      userId: u.body.id, roleCode: 'EMPLOYEE', branchId: null, reason: 'Test eskalimi', idempotencyKey: 'esc-0001' });
    expect(req.status).toBe(201);

    const esc = app.get(EscalationService);
    expect(await esc.escalateOverdue()).toBe(0); // afati 24 orë nuk ka kaluar
    const later = new Date(Date.now() + 25 * 3600_000);
    expect(await esc.escalateOverdue(later)).toBe(1);
    expect(await esc.escalateOverdue(later)).toBe(0); // nuk eskalohet dy herë

    await app.get(OutboxService).processBatch(50);
    const sink = await pool.query<{ recipient: string; subject: string }>(
      `SELECT recipient, subject FROM dev_notification_sink WHERE subject LIKE 'Aprovim i vonuar%'`);
    expect(sink.rows).toEqual([{ recipient: APPROVER.email, subject: `Aprovim i vonuar #${req.body.id}` }]);
    const audit = await pool.query(`SELECT 1 FROM audit_log WHERE action = 'approval.escalated' AND entity_id = $1`, [String(req.body.id)]);
    expect(audit.rowCount).toBe(1);
  });
});
