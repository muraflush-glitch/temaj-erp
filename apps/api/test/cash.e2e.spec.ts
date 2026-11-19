import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp, freshDatabase, userWithRole } from './helpers';

type U = { id: number; token: string };
let pool: Pool; let app: INestApplication;
let cashier: U; let cashierPr: U; let approver: U; let seller: U; let keeper: U; let salesMgr: U; let acct: U;
let PZ: number; let WPZ: number; let regPz: number; let cust: number;
let seq = 0;
const key = () => `cash-test-${++seq}`;
const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  pool = await freshDatabase();
  app = await createApp();
  PZ = Number((await pool.query<{ id: string }>(`SELECT id FROM branch WHERE code = 'PZ'`)).rows[0]?.id);
  WPZ = Number((await pool.query<{ id: string }>(`SELECT id FROM warehouse WHERE code = 'PZ-MAIN'`)).rows[0]?.id);
  regPz = Number((await pool.query<{ id: string }>(`SELECT id FROM cash_register WHERE code = 'ARKA-PZ'`)).rows[0]?.id);
  cashier = await userWithRole(app, pool, 'arketar@temaj.test', 'CASHIER', 'PZ');
  cashierPr = await userWithRole(app, pool, 'arketar.pr@temaj.test', 'CASHIER', 'PR');
  approver = await userWithRole(app, pool, 'aprovues.fin@temaj.test', 'FINANCE_APPROVER', null, true);
  seller = await userWithRole(app, pool, 'shites@temaj.test', 'SALESPERSON', 'PZ');
  keeper = await userWithRole(app, pool, 'magazinier@temaj.test', 'WAREHOUSE_KEEPER', 'PZ');
  salesMgr = await userWithRole(app, pool, 'menaxher@temaj.test', 'SALES_MANAGER', null);
  acct = await userWithRole(app, pool, 'kontabilist@temaj.test', 'ACCOUNTANT', null);
  await http().post('/api/inventory/receipts').set(auth(keeper.token)).send({ warehouseId: WPZ, sku: 'TEST-WC-01', qty: '50', documentRef: 'HYRJE', idempotencyKey: key() });
  await http().post('/api/sales/prices').set(auth(salesMgr.token)).send({ sku: 'TEST-WC-01', validFrom: '2020-01-01', unitPrice: '100.00' });
  cust = (await http().post('/api/sales/customers').set(auth(seller.token)).send({ code: 'KL-ARKA', name: 'Klient arke', kind: 'PERSON' })).body.id;
});
afterAll(async () => { await app.close(); await pool.end(); });

/** Shitje e plotë me para në dorë: 1 WC = 100 + 18 % = 118.00 €. */
async function cashSale(method: 'CASH' | 'BANK' = 'CASH') {
  const o = await http().post('/api/sales/orders').set(auth(seller.token)).send({ branchId: PZ, warehouseId: WPZ, customerId: cust, idempotencyKey: key(), lines: [{ sku: 'TEST-WC-01', qty: '1' }] });
  await http().post(`/api/sales/orders/${o.body.id}/confirm`).set(auth(seller.token)).send({});
  await http().post(`/api/sales/orders/${o.body.id}/deliveries`).set(auth(keeper.token)).send({ documentRef: 'FD', idempotencyKey: key(), lines: [{ lineNo: 1, qty: '1' }] });
  return http().post(`/api/sales/orders/${o.body.id}/invoices`).set(auth(cashier.token)).send({ idempotencyKey: key(), payment: { method } });
}
const open = (t = cashier.token, reg = regPz) => http().post(`/api/cash/registers/${reg}/open`).set(auth(t));
const close = (sid: number, counted: string, bankDeposit = '0', reason?: string) => http().post(`/api/cash/sessions/${sid}/close`).set(auth(cashier.token)).send({ counted, bankDeposit, reason });
const cashInLedger = async () => {
  const today = (await pool.query<{ d: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0]?.d;
  const t = (await http().get(`/api/ledger/trial-balance?asOf=${today}`).set(auth(acct.token))).body as { accounts: { code: string; balance: string }[] };
  return (code: string) => Number(t.accounts.find((a) => a.code === code)?.balance ?? 0);
};

describe('Arka ditore', () => {
  let sid: number;

  it('me arkë të mbyllur nuk arkëtohet para në dorë, por banka pranohet', async () => {
    const res = await cashSale('CASH');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CASH_SESSION_NOT_OPEN');
    // Fatura nuk u krijua pa arkëtimin e saj (i gjithë hapi u kthye mbrapsht).
    expect((await pool.query('SELECT 1 FROM sales_invoice')).rowCount).toBe(0);
    expect((await cashSale('BANK')).status).toBe(201);
  });

  it('arkëtari i degës tjetër nuk e hap arkën e Prizrenit; arka nuk hapet dy herë', async () => {
    expect((await open(cashierPr.token)).status).toBe(403);
    const res = await open();
    expect(res.status).toBe(201);
    expect(res.body.openingFloat).toBe('0.00');
    sid = res.body.id;
    expect((await open()).status).toBe(409);
  });

  it('shuma e pritur llogaritet nga sistemi: vetëm arkëtimet me para në dorë', async () => {
    expect((await cashSale('CASH')).status).toBe(201);
    expect((await cashSale('CASH')).status).toBe(201);
    expect((await cashSale('BANK')).status).toBe(201);
    const reg = (await http().get('/api/cash/registers').set(auth(cashier.token))).body;
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({ code: 'ARKA-PZ', session_status: 'OPEN', expected_now: '236.00', payments: 2 });
  });

  it('numërimi me mungesë kërkon arsyetim; arka bllokohet derisa të vendosë aprovuesi', async () => {
    expect((await close(sid, '230.00')).body.code).toBe('REASON_REQUIRED');
    const res = await close(sid, '230.00', '0', 'Kusur i dhënë gabim');
    expect(res.body).toMatchObject({ status: 'PENDING_CLOSE', expected: '236.00', difference: '-6.00' });
    expect((await cashSale('CASH')).body.code).toBe('CASH_SESSION_NOT_OPEN');   // gjatë pritjes nuk arkëtohet
    // Arkëtari nuk e aprovon dot mungesën e vet.
    expect((await http().post(`/api/approvals/${res.body.approvalRequestId}/decide`).set(auth(cashier.token)).send({ decision: 'APPROVE' })).status).toBe(403);
    // Refuzimi e kthen arkën të hapur për rinumërim.
    await http().post(`/api/approvals/${res.body.approvalRequestId}/decide`).set(auth(approver.token)).send({ decision: 'REJECT', comment: 'Numëro përsëri' });
    expect((await http().get('/api/cash/registers').set(auth(cashier.token))).body[0].session_status).toBe('OPEN');
  });

  it('mungesa e aprovuar regjistrohet si shpenzim dhe arka në libër përputhet me paratë e numëruara', async () => {
    const res = await close(sid, '231.00', '200.00', 'Mungojnë 5 € pas rinumërimit');
    expect(res.body.difference).toBe('-5.00');
    const dec = await http().post(`/api/approvals/${res.body.approvalRequestId}/decide`).set(auth(approver.token)).send({ decision: 'APPROVE' });
    expect(dec.body.status).toBe('APPROVED');
    const bal = await cashInLedger();
    expect(bal('T-6100')).toBeCloseTo(5, 2);       // mungesa e arkës
    expect(bal('T-1050')).toBeCloseTo(200, 2);     // paratë e nxjerra për bankë
    expect(bal('T-1000')).toBeCloseTo(31, 2);      // në arkë mbeten 231 − 200
    const h = (await http().get(`/api/cash/registers/${regPz}/sessions`).set(auth(cashier.token))).body;
    expect(h[0]).toMatchObject({ status: 'CLOSED', expected: '236.00', counted: '231.00', difference: '-5.00', bank_deposit: '200.00' });
  });

  it('seanca e mbyllur nuk ndryshohet, as në databazë', async () => {
    await expect(pool.query(`UPDATE cash_session SET counted = 236 WHERE id = $1`, [sid])).rejects.toThrow(/CASH_SESSION_IMMUTABLE/);
    await expect(pool.query(`DELETE FROM cash_session WHERE id = $1`, [sid])).rejects.toThrow(/CASH_SESSION_IMMUTABLE/);
  });

  it('dita tjetër fillon me paratë e mbetura; mbyllja pa diferencë nuk kërkon aprovim', async () => {
    const o = await open();
    expect(o.body.openingFloat).toBe('31.00');
    await cashSale('CASH');
    const res = await close(o.body.id, '149.00', '100.00');   // 31 + 118
    expect(res.body).toEqual({ status: 'CLOSED', expected: '149.00', difference: '0.00' });
    expect((await cashInLedger())('T-1000')).toBeCloseTo(49, 2);
  });

  it('teprica regjistrohet si e ardhur e veçantë, jo si shitje', async () => {
    const o = await open();
    const res = await close(o.body.id, '51.50', '0', 'Klienti la kusurin');
    expect(res.body.difference).toBe('2.50');
    await http().post(`/api/approvals/${res.body.approvalRequestId}/decide`).set(auth(approver.token)).send({ decision: 'APPROVE' });
    const bal = await cashInLedger();
    expect(bal('T-4100')).toBeCloseTo(-2.5, 2);
    expect(bal('T-1000')).toBeCloseTo(51.5, 2);
  });

  it('sistemi e vendos vetë shumën e pritur edhe nëse dikush e shkruan me dorë', async () => {
    const o = await open();
    await pool.query(`UPDATE cash_session SET status = 'PENDING_CLOSE', counted = 51.50, bank_deposit = 0, closed_by = $2, expected = 999999 WHERE id = $1`, [o.body.id, cashier.id]);
    const e = await pool.query<{ expected: string }>('SELECT expected::text FROM cash_session WHERE id = $1', [o.body.id]);
    expect(e.rows[0]?.expected).toBe('51.50');
  });

  it('arkëtimi me para në dorë nuk lidhet dot me një seancë të mbyllur', async () => {
    const p = await pool.query<{ id: string }>(`SELECT id FROM customer_payment WHERE method = 'CASH' LIMIT 1`);
    await expect(pool.query(
      `INSERT INTO customer_payment(legal_entity_id, customer_id, branch_id, method, amount, received_on, journal_entry_id, received_by, idempotency_key, cash_session_id)
       SELECT legal_entity_id, customer_id, branch_id, 'CASH', 1, received_on, journal_entry_id, received_by, 'raw-closed', cash_session_id FROM customer_payment WHERE id = $1`, [p.rows[0]?.id],
    )).rejects.toThrow(/CASH_SESSION_NOT_OPEN/);
    expect((await pool.query<{ b: string | null }>('SELECT audit_log_verify() AS b')).rows[0]?.b).toBeNull();
  });
});
