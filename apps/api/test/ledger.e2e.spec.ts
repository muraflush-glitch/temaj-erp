import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp, freshDatabase, userWithRole } from './helpers';

let pool: Pool;
let app: INestApplication;
let acct: { id: number; token: string };      // kontabilist, të gjitha degët
let acctPz: { id: number; token: string };    // kontabilist vetëm për Prizrenin
let approver: { id: number; token: string };  // aprovues financiar me 2FA
let PZ: number; let PR: number; let entity: number;
let seq = 0;
const key = () => `ledger-test-${++seq}`;
const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  pool = await freshDatabase();
  app = await createApp();
  const b = await pool.query<{ id: string; code: string; legal_entity_id: string }>('SELECT id, code, legal_entity_id FROM branch');
  PZ = Number(b.rows.find((r) => r.code === 'PZ')?.id); PR = Number(b.rows.find((r) => r.code === 'PR')?.id);
  entity = Number(b.rows[0]?.legal_entity_id);
  await pool.query(
    `INSERT INTO fiscal_period(legal_entity_id, name, start_date, end_date) VALUES
       ($1, 'Janar 2030', '2030-01-01', '2030-01-31'), ($1, 'Shkurt 2030', '2030-02-01', '2030-02-28')`, [entity]);
  acct = await userWithRole(app, pool, 'kontabilist@temaj.test', 'ACCOUNTANT', null);
  acctPz = await userWithRole(app, pool, 'kontabilist.pz@temaj.test', 'ACCOUNTANT', 'PZ');
  approver = await userWithRole(app, pool, 'aprovues.fin@temaj.test', 'FINANCE_APPROVER', null, true);
});
afterAll(async () => { await app.close(); await pool.end(); });

type Line = [account: string, debit: string, credit: string, branch?: number | null];
const body = (date: string, lines: Line[], k = key()) => ({
  entryDate: date, description: 'Regjistrim testues', idempotencyKey: k,
  lines: lines.map(([accountCode, debit, credit, branch]) => ({ accountCode, debit, credit, branchId: branch === undefined ? PZ : branch })),
});
async function draft(token: string, date: string, lines: Line[]): Promise<number> {
  const res = await http().post('/api/ledger/entries').set(auth(token)).send(body(date, lines));
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.id as number;
}
async function posted(token: string, date: string, lines: Line[]): Promise<number> {
  const id = await draft(token, date, lines);
  const res = await http().post(`/api/ledger/entries/${id}/post`).set(auth(token));
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return id;
}
const tb = async (asOf: string, branchId?: number) =>
  (await http().get(`/api/ledger/trial-balance?asOf=${asOf}${branchId ? `&branchId=${branchId}` : ''}`).set(auth(acct.token))).body;
const balanceOf = (t: { accounts: { code: string; balance: string }[] }, code: string) => t.accounts.find((a) => a.code === code)?.balance ?? '0.0000';

describe('Postimi', () => {
  it('regjistrimi i balancuar postohet dhe merr numër', async () => {
    const id = await draft(acct.token, '2030-01-05', [['T-1000', '1000.00', '0'], ['T-3000', '0', '1000.00']]);
    const res = await http().post(`/api/ledger/entries/${id}/post`).set(auth(acct.token));
    expect(res.status).toBe(200);
    expect(res.body.entryNo).toBe(1);
  });

  it('regjistrimi i pabalancuar refuzohet', async () => {
    const id = await draft(acct.token, '2030-01-05', [['T-1000', '100.00', '0'], ['T-3000', '0', '99.99']]);
    const res = await http().post(`/api/ledger/entries/${id}/post`).set(auth(acct.token));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UNBALANCED_ENTRY');
    expect((await http().delete(`/api/ledger/entries/${id}`).set(auth(acct.token))).status).toBe(204);
  });

  it('databaza vetë e refuzon postimin e pabalancuar, edhe pa API', async () => {
    const e = await pool.query<{ id: string }>(
      `INSERT INTO journal_entry(legal_entity_id, entry_date, description, created_by, idempotency_key) VALUES ($1, '2030-01-06', 'direkt', $2, 'raw-1') RETURNING id`, [entity, acct.id]);
    const acc = await pool.query<{ id: string }>(`SELECT id FROM ledger_account WHERE code IN ('T-1000', 'T-3000') ORDER BY code`);
    await pool.query(`INSERT INTO journal_line(entry_id, line_no, account_id, debit, credit) VALUES ($1, 1, $2, 50, 0), ($1, 2, $3, 0, 49)`, [e.rows[0]?.id, acc.rows[0]?.id, acc.rows[1]?.id]);
    await expect(pool.query(`UPDATE journal_entry SET status = 'POSTED', posted_by = $2 WHERE id = $1`, [e.rows[0]?.id, acct.id])).rejects.toThrow(/UNBALANCED_ENTRY/);
    await expect(pool.query(
      `INSERT INTO journal_entry(legal_entity_id, entry_date, description, created_by, idempotency_key, status) VALUES ($1, '2030-01-06', 'direkt', $2, 'raw-2', 'POSTED')`, [entity, acct.id],
    )).rejects.toThrow(/ENTRY_MUST_START_AS_DRAFT/);
    await pool.query('DELETE FROM journal_entry WHERE id = $1', [e.rows[0]?.id]);
  });

  it('rreshti me debi dhe kredi njëkohësisht, ose me zero, refuzohet', async () => {
    const both = await http().post('/api/ledger/entries').set(auth(acct.token)).send(body('2030-01-05', [['T-1000', '10', '10'], ['T-3000', '0', '10']]));
    expect(both.status).toBe(400);
    const zero = await http().post('/api/ledger/entries').set(auth(acct.token)).send(body('2030-01-05', [['T-1000', '0', '0'], ['T-3000', '0', '10']]));
    expect(zero.status).toBe(400);
  });

  it('shumat ruhen saktësisht si dhjetore: 0.10 + 0.20 = 0.30', async () => {
    await posted(acct.token, '2030-01-07', [['T-1100', '0.10', '0'], ['T-1100', '0.20', '0'], ['T-4000', '0', '0.30']]);
    const t = await tb('2030-01-07');
    expect(balanceOf(t, 'T-1100')).toBe('0.3000');
  });

  it('data pa periudhë fiskale refuzohet', async () => {
    const id = await draft(acct.token, '2031-06-01', [['T-1000', '1', '0'], ['T-3000', '0', '1']]);
    const res = await http().post(`/api/ledger/entries/${id}/post`).set(auth(acct.token));
    expect(res.body.code).toBe('NO_FISCAL_PERIOD');
    await http().delete(`/api/ledger/entries/${id}`).set(auth(acct.token));
  });

  it('idempotenca: e njëjta kërkesë nuk krijon dy regjistrime', async () => {
    const b = body('2030-01-08', [['T-1000', '5', '0'], ['T-3000', '0', '5']], 'dup-key-0001');
    const a1 = await http().post('/api/ledger/entries').set(auth(acct.token)).send(b);
    const a2 = await http().post('/api/ledger/entries').set(auth(acct.token)).send(b);
    expect(a1.body.created).toBe(true);
    expect(a2.body).toEqual({ id: a1.body.id, created: false });
    await http().delete(`/api/ledger/entries/${a1.body.id}`).set(auth(acct.token));
  });

  it('postimi i dytë i të njëjtit regjistrim refuzohet', async () => {
    const id = await posted(acct.token, '2030-01-08', [['T-1000', '5', '0'], ['T-3000', '0', '5']]);
    expect((await http().post(`/api/ledger/entries/${id}/post`).set(auth(acct.token))).status).toBe(409);
  });
});

describe('Pandryshueshmëria', () => {
  let id: number;
  beforeAll(async () => { id = await posted(acct.token, '2030-01-10', [['T-1000', '200.00', '0'], ['T-4000', '0', '200.00']]); });

  it('regjistrimi i postuar nuk ndryshohet, nuk fshihet dhe nuk kthehet në draft', async () => {
    await expect(pool.query(`UPDATE journal_entry SET description = 'ndryshuar' WHERE id = $1`, [id])).rejects.toThrow(/JOURNAL_ENTRY_IMMUTABLE/);
    await expect(pool.query(`UPDATE journal_entry SET status = 'DRAFT' WHERE id = $1`, [id])).rejects.toThrow(/JOURNAL_ENTRY_IMMUTABLE/);
    await expect(pool.query(`DELETE FROM journal_entry WHERE id = $1`, [id])).rejects.toThrow(/JOURNAL_ENTRY_IMMUTABLE/);
    expect((await http().delete(`/api/ledger/entries/${id}`).set(auth(acct.token))).status).toBe(409);
  });

  it('rreshtat e tij nuk ndryshohen, nuk fshihen dhe nuk shtohen', async () => {
    await expect(pool.query(`UPDATE journal_line SET debit = 999 WHERE entry_id = $1 AND debit > 0`, [id])).rejects.toThrow(/JOURNAL_ENTRY_IMMUTABLE/);
    await expect(pool.query(`DELETE FROM journal_line WHERE entry_id = $1`, [id])).rejects.toThrow(/JOURNAL_ENTRY_IMMUTABLE/);
    await expect(pool.query(
      `INSERT INTO journal_line(entry_id, line_no, account_id, debit, credit) SELECT $1, 99, id, 1, 0 FROM ledger_account LIMIT 1`, [id])).rejects.toThrow(/JOURNAL_ENTRY_IMMUTABLE/);
    await expect(pool.query('TRUNCATE journal_line')).rejects.toThrow(/JOURNAL_ENTRY_IMMUTABLE/);
  });

  it('kthimi (storno) krijon regjistrim të kundërt dhe e zeron efektin; origjinali mbetet', async () => {
    const before = await tb('2030-01-31');
    const res = await http().post(`/api/ledger/entries/${id}/reverse`).set(auth(acct.token)).send({ entryDate: '2030-01-11', reason: 'Gabim në shumë', idempotencyKey: key() });
    expect(res.status).toBe(201);
    const after = await tb('2030-01-31');
    expect(Number(balanceOf(after, 'T-1000'))).toBe(Number(balanceOf(before, 'T-1000')) - 200);
    const rev = await http().get(`/api/ledger/entries/${res.body.id}`).set(auth(acct.token));
    expect(rev.body.reverses_entry_id).toBe(String(id));
    expect(rev.body.lines.map((l: { account_code: string; debit: string; credit: string }) => [l.account_code, l.debit, l.credit]))
      .toEqual([['T-1000', '0.0000', '200.0000'], ['T-4000', '200.0000', '0.0000']]);
    const orig = await http().get(`/api/ledger/entries/${id}`).set(auth(acct.token));
    expect(orig.body.status).toBe('POSTED');
  });

  it('një regjistrim kthehet vetëm një herë', async () => {
    const res = await http().post(`/api/ledger/entries/${id}/reverse`).set(auth(acct.token)).send({ entryDate: '2030-01-12', reason: 'Tentativë e dytë', idempotencyKey: key() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_REVERSED');
  });
});

describe('Bilanci vërtetues dhe invariantet', () => {
  it('debia totale = kredia totale, gjithmonë', async () => {
    const t = await tb('2030-12-31');
    expect(t.totalDebit).toBe(t.totalCredit);
    const raw = await pool.query<{ d: string; c: string }>(
      `SELECT sum(debit)::text AS d, sum(credit)::text AS c FROM journal_line l JOIN journal_entry e ON e.id = l.entry_id WHERE e.status = 'POSTED'`);
    expect(raw.rows[0]?.d).toBe(raw.rows[0]?.c);
  });

  it('draftet nuk hyjnë në bilanc', async () => {
    const before = await tb('2030-01-31');
    const id = await draft(acct.token, '2030-01-15', [['T-1000', '777', '0'], ['T-3000', '0', '777']]);
    expect(await tb('2030-01-31')).toEqual(before);
    await http().delete(`/api/ledger/entries/${id}`).set(auth(acct.token));
  });

  it('shembulli kritik: avans 200 € dhe katër bonuse 50 € si kompensim — arka NUK rritet', async () => {
    const cash0 = Number(balanceOf(await tb('2030-01-31'), 'T-1000'));
    // Avansi: paratë dalin nga arka.
    await posted(acct.token, '2030-01-16', [['T-1300', '200.00', '0'], ['T-1000', '0', '200.00']]);
    // Katër bonuse 50 € kompensohen ndaj avansit: asnjë rresht nuk prek arkën.
    for (let i = 0; i < 4; i++) {
      await posted(acct.token, '2030-01-17', [['T-6000', '50.00', '0'], ['T-1300', '0', '50.00']]);
    }
    const t = await tb('2030-01-31');
    expect(Number(balanceOf(t, 'T-1300'))).toBe(0);              // avansi neto është zero
    expect(Number(balanceOf(t, 'T-1000'))).toBe(cash0 - 200);    // arka: vetëm dalja fillestare, asnjë hyrje 200 €
    expect(Number(balanceOf(t, 'T-6000'))).toBe(200);
  });

  it('bilanci sipas degës i ndan Prizrenin dhe Prishtinën', async () => {
    await posted(acct.token, '2030-01-18', [['T-1100', '40.00', '0', PR], ['T-4000', '0', '40.00', PR]]);
    const pr = await tb('2030-01-31', PR);
    expect(pr.accounts.map((a: { code: string; balance: string }) => [a.code, a.balance])).toEqual([['T-1100', '40.0000'], ['T-4000', '-40.0000']]);
  });

  it('numrat e regjistrimeve janë pa boshllëqe, edhe me 20 postime paralele', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 20; i++) ids.push(await draft(acct.token, '2030-01-20', [['T-1000', '1', '0'], ['T-3000', '0', '1']]));
    const results = await Promise.all(ids.map((id) => http().post(`/api/ledger/entries/${id}/post`).set(auth(acct.token))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const nos = await pool.query<{ n: string; mx: string; mn: string }>(`SELECT count(*) AS n, max(entry_no) AS mx, min(entry_no) AS mn FROM journal_entry WHERE status = 'POSTED'`);
    expect(Number(nos.rows[0]?.mn)).toBe(1);
    expect(Number(nos.rows[0]?.mx)).toBe(Number(nos.rows[0]?.n));
  });

  it('dështimi i postimit nuk harxhon numër', async () => {
    const before = await pool.query<{ last_no: string }>('SELECT last_no FROM journal_entry_counter');
    const id = await draft(acct.token, '2030-01-21', [['T-1000', '10', '0'], ['T-3000', '0', '9']]);
    await http().post(`/api/ledger/entries/${id}/post`).set(auth(acct.token));
    const after = await pool.query<{ last_no: string }>('SELECT last_no FROM journal_entry_counter');
    expect(after.rows[0]?.last_no).toBe(before.rows[0]?.last_no);
    await http().delete(`/api/ledger/entries/${id}`).set(auth(acct.token));
  });
});

describe('Lejet sipas degës', () => {
  it('kontabilisti i Prizrenit nuk regjistron për Prishtinën as në nivel kompanie', async () => {
    const pr = await http().post('/api/ledger/entries').set(auth(acctPz.token)).send(body('2030-01-22', [['T-1000', '1', '0', PR], ['T-3000', '0', '1', PR]]));
    expect(pr.status).toBe(403);
    const global = await http().post('/api/ledger/entries').set(auth(acctPz.token)).send(body('2030-01-22', [['T-1000', '1', '0', null], ['T-3000', '0', '1', null]]));
    expect(global.status).toBe(403);
    const pz = await http().post('/api/ledger/entries').set(auth(acctPz.token)).send(body('2030-01-22', [['T-1000', '1', '0', PZ], ['T-3000', '0', '1', PZ]]));
    expect(pz.status).toBe(201);
    await http().delete(`/api/ledger/entries/${pz.body.id}`).set(auth(acctPz.token));
  });

  it('kontabilisti i Prizrenit nuk sheh bilancin e kompanisë as të Prishtinës', async () => {
    expect((await http().get('/api/ledger/trial-balance?asOf=2030-01-31').set(auth(acctPz.token))).status).toBe(403);
    expect((await http().get(`/api/ledger/trial-balance?asOf=2030-01-31&branchId=${PR}`).set(auth(acctPz.token))).status).toBe(403);
    expect((await http().get(`/api/ledger/trial-balance?asOf=2030-01-31&branchId=${PZ}`).set(auth(acctPz.token))).status).toBe(200);
  });

  it('aprovuesi financiar lexon, por nuk krijon regjistrime', async () => {
    const res = await http().post('/api/ledger/entries').set(auth(approver.token)).send(body('2030-01-22', [['T-1000', '1', '0'], ['T-3000', '0', '1']]));
    expect(res.status).toBe(403);
  });
});

describe('Mbyllja e periudhës', () => {
  let periodId: number;
  beforeAll(async () => {
    periodId = Number((await pool.query<{ id: string }>(`SELECT id FROM fiscal_period WHERE name = 'Janar 2030'`)).rows[0]?.id);
  });

  it('periudha me drafte të papostuara nuk mbyllet', async () => {
    const d = await draft(acct.token, '2030-01-25', [['T-1000', '1', '0'], ['T-3000', '0', '1']]);
    const req = await http().post(`/api/ledger/periods/${periodId}/close-request`).set(auth(acct.token)).send({ reason: 'Mbyllja e janarit', idempotencyKey: key() });
    expect(req.status).toBe(201);
    const dec = await http().post(`/api/approvals/${req.body.id}/decide`).set(auth(approver.token)).send({ decision: 'APPROVE' });
    expect(dec.status).toBe(409);
    expect(dec.body.code).toBe('PERIOD_HAS_DRAFTS');
    // Aprovimi dështoi i tëri: kërkesa mbetet në pritje, periudha e hapur.
    const st = await pool.query<{ status: string }>('SELECT status FROM approval_request WHERE id = $1', [req.body.id]);
    expect(st.rows[0]?.status).toBe('PENDING');
    await http().delete(`/api/ledger/entries/${d}`).set(auth(acct.token));
    await http().post(`/api/approvals/${req.body.id}/cancel`).set(auth(acct.token));
  });

  it('kontabilisti nuk e mbyll dot vetë periudhën; duhet aprovues tjetër me 2FA', async () => {
    const req = await http().post(`/api/ledger/periods/${periodId}/close-request`).set(auth(acct.token)).send({ reason: 'Mbyllja e janarit', idempotencyKey: 'close-jan-2030' });
    expect(req.body.status).toBe('PENDING');
    expect((await pool.query<{ status: string }>('SELECT status FROM fiscal_period WHERE id = $1', [periodId])).rows[0]?.status).toBe('OPEN');
    const self = await http().post(`/api/approvals/${req.body.id}/decide`).set(auth(acct.token)).send({ decision: 'APPROVE' });
    expect(self.status).toBe(403);
    const dec = await http().post(`/api/approvals/${req.body.id}/decide`).set(auth(approver.token)).send({ decision: 'APPROVE' });
    expect(dec.body.status).toBe('APPROVED');
    expect((await pool.query<{ status: string }>('SELECT status FROM fiscal_period WHERE id = $1', [periodId])).rows[0]?.status).toBe('CLOSED');
  });

  it('në periudhën e mbyllur nuk postohet më', async () => {
    const id = await draft(acct.token, '2030-01-28', [['T-1000', '1', '0'], ['T-3000', '0', '1']]);
    const res = await http().post(`/api/ledger/entries/${id}/post`).set(auth(acct.token));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PERIOD_CLOSED');
  });

  it('periudha e mbyllur nuk rihapet, as drejtpërdrejt në databazë', async () => {
    await expect(pool.query(`UPDATE fiscal_period SET status = 'OPEN', closed_at = NULL WHERE id = $1`, [periodId])).rejects.toThrow(/PERIOD_CLOSED/);
  });

  it('korrigjimi i një regjistrimi të periudhës së mbyllur bëhet me kthim në periudhën e hapur', async () => {
    const jan = await pool.query<{ id: string }>(`SELECT id FROM journal_entry WHERE status = 'POSTED' AND entry_date = '2030-01-05' AND reverses_entry_id IS NULL ORDER BY id LIMIT 1`);
    const inClosed = await http().post(`/api/ledger/entries/${jan.rows[0]?.id}/reverse`).set(auth(acct.token)).send({ entryDate: '2030-01-30', reason: 'Korrigjim pas mbylljes', idempotencyKey: key() });
    expect(inClosed.body.code).toBe('PERIOD_CLOSED');
    const janBefore = await tb('2030-01-31');
    const ok = await http().post(`/api/ledger/entries/${jan.rows[0]?.id}/reverse`).set(auth(acct.token)).send({ entryDate: '2030-02-01', reason: 'Korrigjim pas mbylljes', idempotencyKey: key() });
    expect(ok.status).toBe(201);
    // Shifrat e janarit të mbyllur nuk lëvizin.
    expect(await tb('2030-01-31')).toEqual(janBefore);
  });

  it('periudhat nuk mbivendosen', async () => {
    await expect(pool.query(`INSERT INTO fiscal_period(legal_entity_id, name, start_date, end_date) VALUES ($1, 'Mbivendosje', '2030-02-15', '2030-03-15')`, [entity])).rejects.toThrow();
  });

  it('audit trail i ka regjistruar veprimet e librit dhe zinxhiri është i paprekur', async () => {
    const a = await pool.query<{ action: string }>(`SELECT DISTINCT action FROM audit_log WHERE action LIKE 'ledger.%'`);
    expect(a.rows.map((r) => r.action).sort()).toEqual(['ledger.draft_deleted', 'ledger.entry_drafted', 'ledger.entry_posted', 'ledger.entry_reversed', 'ledger.period_closed']);
    const v = await pool.query<{ b: string | null }>('SELECT audit_log_verify() AS b');
    expect(v.rows[0]?.b).toBeNull();
  });
});
