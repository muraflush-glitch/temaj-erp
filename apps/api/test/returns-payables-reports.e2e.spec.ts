import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp, freshDatabase, userWithRole } from './helpers';

type U = { id: number; token: string };
let pool: Pool; let app: INestApplication;
let seller: U; let salesMgr: U; let keeper: U; let cashier: U; let acct: U; let buyer: U; let ap: U; let finance: U;
let PZ: number; let WPZ: number; let cust: number; let supplierId: number; let today: string;
let seq = 0;
const key = () => `rpr-test-${++seq}`;
const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  pool = await freshDatabase();
  app = await createApp();
  today = (await pool.query<{ d: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0]?.d ?? '';
  PZ = Number((await pool.query<{ id: string }>(`SELECT id FROM branch WHERE code = 'PZ'`)).rows[0]?.id);
  WPZ = Number((await pool.query<{ id: string }>(`SELECT id FROM warehouse WHERE code = 'PZ-MAIN'`)).rows[0]?.id);
  seller = await userWithRole(app, pool, 'shites@temaj.test', 'SALESPERSON', 'PZ');
  salesMgr = await userWithRole(app, pool, 'menaxher@temaj.test', 'SALES_MANAGER', null, true);
  keeper = await userWithRole(app, pool, 'magazinier@temaj.test', 'WAREHOUSE_KEEPER', 'PZ');
  cashier = await userWithRole(app, pool, 'arketar@temaj.test', 'CASHIER', 'PZ');
  acct = await userWithRole(app, pool, 'kontabilist@temaj.test', 'ACCOUNTANT', null);
  buyer = await userWithRole(app, pool, 'bleres@temaj.test', 'PURCHASER', 'PZ');
  ap = await userWithRole(app, pool, 'financa@temaj.test', 'AP_CLERK', null);
  finance = await userWithRole(app, pool, 'aprovues.fin@temaj.test', 'FINANCE_APPROVER', null, true);
  await http().post('/api/inventory/receipts').set(auth(keeper.token)).send({ warehouseId: WPZ, sku: 'TEST-WC-01', qty: '20', documentRef: 'HYRJE', idempotencyKey: key() });
  await http().post('/api/sales/prices').set(auth(salesMgr.token)).send({ sku: 'TEST-WC-01', validFrom: '2020-01-01', unitPrice: '100.00' });
  cust = (await http().post('/api/sales/customers').set(auth(salesMgr.token)).send({ code: 'KL-KTHIM', name: 'Klient me kthim', kind: 'COMPANY', creditLimit: '5000', paymentTermDays: 15 })).body.id;
  supplierId = (await http().post('/api/purchasing/suppliers').set(auth(buyer.token)).send({ code: 'FUR-PAG', name: 'Furnitor për pagesë' })).body.id;
});
afterAll(async () => { await app.close(); await pool.end(); });

const tb = async () => {
  const t = (await http().get(`/api/ledger/trial-balance?asOf=${today}`).set(auth(acct.token))).body as { accounts: { code: string; balance: string }[]; totalDebit: string; totalCredit: string };
  return { bal: (code: string) => Number(t.accounts.find((a) => a.code === code)?.balance ?? 0), t };
};
const stockWc = async () => Number(((await http().get(`/api/inventory/warehouses/${WPZ}/stock`).set(auth(keeper.token))).body as { sku: string; on_hand: string }[]).find((r) => r.sku === 'TEST-WC-01')?.on_hand ?? 0);
const decide = (t: string, id: number, decision = 'APPROVE') => http().post(`/api/approvals/${id}/decide`).set(auth(t)).send({ decision });

describe('Kthimet dhe notat e kreditit', () => {
  let invoiceId: number;
  beforeAll(async () => {
    // Shitje me kredi: 4 WC × 100 = 400 neto, 72 TVSH, 472 bruto.
    const o = await http().post('/api/sales/orders').set(auth(seller.token)).send({ branchId: PZ, warehouseId: WPZ, customerId: cust, onCredit: true, idempotencyKey: key(), lines: [{ sku: 'TEST-WC-01', qty: '4' }] });
    await http().post(`/api/sales/orders/${o.body.id}/confirm`).set(auth(seller.token)).send({});
    await http().post(`/api/sales/orders/${o.body.id}/deliveries`).set(auth(keeper.token)).send({ documentRef: 'FD', idempotencyKey: key(), lines: [{ lineNo: 1, qty: '4' }] });
    invoiceId = (await http().post(`/api/sales/orders/${o.body.id}/invoices`).set(auth(cashier.token)).send({ idempotencyKey: key() })).body.id;
  });

  it('kërkesa për notë krediti nuk ndryshon asgjë derisa të aprovohet nga një person tjetër', async () => {
    const before = await tb(); const stock = await stockWc();
    const req = await http().post(`/api/sales/invoices/${invoiceId}/credit-note-requests`).set(auth(cashier.token)).send({ idempotencyKey: key(), restock: true, reason: 'Klienti ktheu 1 copë të padëmtuar', lines: [{ lineNo: 1, qty: '1' }] });
    expect(req.status).toBe(201);
    expect((await tb()).bal('T-1200')).toBe(before.bal('T-1200'));
    expect(await stockWc()).toBe(stock);
    expect((await decide(cashier.token, req.body.id)).status).toBe(403);   // kërkuesi nuk e aprovon dot vetë
    const dec = await decide(salesMgr.token, req.body.id);
    expect(dec.body.status).toBe('APPROVED');
    const after = await tb();
    expect(after.bal('T-1200') - before.bal('T-1200')).toBeCloseTo(-118, 2);   // borxhi ulet me bruto
    expect(after.bal('T-4000') - before.bal('T-4000')).toBeCloseTo(100, 2);    // të ardhurat ulen me neto
    expect(after.bal('T-2400') - before.bal('T-2400')).toBeCloseTo(18, 2);     // TVSH-ja ulet
    expect(await stockWc()).toBe(stock + 1);                                    // malli u kthye në stok
    expect(after.t.totalDebit).toBe(after.t.totalCredit);
  });

  it('fatura origjinale mbetet e paprekur; nota lidhet me të dhe borxhi i hapur ulet', async () => {
    const inv = (await http().get(`/api/sales/invoices/${invoiceId}`).set(auth(cashier.token))).body;
    expect(inv.gross).toBe('472.00');
    expect(inv.open_amount).toBe('354.00');
    expect(inv.creditNotes).toHaveLength(1);
    expect(inv.creditNotes[0]).toMatchObject({ credit_no: '1', gross: '118.00', restocked: true });
    expect(inv.lines[0].qty_credited).toBe('1.0000');
  });

  it('kthimi pa rikthim në stok (mall i dëmtuar) nuk e rrit stokun', async () => {
    const stock = await stockWc();
    const req = await http().post(`/api/sales/invoices/${invoiceId}/credit-note-requests`).set(auth(cashier.token)).send({ idempotencyKey: key(), restock: false, reason: 'Një copë e thyer te klienti', lines: [{ lineNo: 1, qty: '1' }] });
    await decide(salesMgr.token, req.body.id);
    expect(await stockWc()).toBe(stock);
    expect((await http().get(`/api/sales/invoices/${invoiceId}`).set(auth(cashier.token))).body.open_amount).toBe('236.00');
  });

  it('nuk kreditohet më shumë se sa është faturuar, as përmes dy kërkesave paralele', async () => {
    const over = await http().post(`/api/sales/invoices/${invoiceId}/credit-note-requests`).set(auth(cashier.token)).send({ idempotencyKey: key(), restock: false, reason: 'Tentativë mbi sasinë', lines: [{ lineNo: 1, qty: '3' }] });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('OVER_CREDIT');
    // Dy kërkesa për 2 copë secila, kur kanë mbetur vetëm 2: të dyja pranohen si kërkesa, por vetëm njëra mund të aprovohet.
    const a = await http().post(`/api/sales/invoices/${invoiceId}/credit-note-requests`).set(auth(cashier.token)).send({ idempotencyKey: key(), restock: false, reason: 'Kërkesa e parë', lines: [{ lineNo: 1, qty: '2' }] });
    const b = await http().post(`/api/sales/invoices/${invoiceId}/credit-note-requests`).set(auth(cashier.token)).send({ idempotencyKey: key(), restock: false, reason: 'Kërkesa e dytë', lines: [{ lineNo: 1, qty: '2' }] });
    expect((await decide(salesMgr.token, a.body.id)).body.status).toBe('APPROVED');
    const second = await decide(salesMgr.token, b.body.id);
    expect(second.body.code).toBe('OVER_CREDIT');
    expect((await http().get(`/api/sales/invoices/${invoiceId}`).set(auth(cashier.token))).body.open_amount).toBe('0.00');
  });

  it('notat e kreditit janë të pandryshueshme dhe databaza vetë e ndalon kreditimin e tepërt', async () => {
    await expect(pool.query('UPDATE credit_note SET gross = 1, net = 1, vat = 0')).rejects.toThrow(/FINANCIAL_DOCUMENT_IMMUTABLE/);
    const cn = await pool.query<{ id: string }>('SELECT id FROM credit_note ORDER BY id LIMIT 1');
    await expect(pool.query('INSERT INTO credit_note_line(credit_note_id, invoice_id, invoice_line_no, qty, net, vat) VALUES ($1, $2, 1, 1, 100, 18) ON CONFLICT DO NOTHING', [cn.rows[0]?.id, invoiceId])).rejects.toThrow(/OVER_CREDIT/);
    const nos = await pool.query<{ n: string; mx: string }>('SELECT count(*) AS n, max(credit_no) AS mx FROM credit_note');
    expect(nos.rows[0]?.mx).toBe(nos.rows[0]?.n);
  });

  it('shitësi nuk kërkon dot notë krediti', async () => {
    const res = await http().post(`/api/sales/invoices/${invoiceId}/credit-note-requests`).set(auth(seller.token)).send({ idempotencyKey: key(), restock: false, reason: 'Pa leje', lines: [{ lineNo: 1, qty: '1' }] });
    expect(res.status).toBe(403);
  });
});

describe('Detyrimet dhe pagesat ndaj furnitorëve', () => {
  let poId: number;
  beforeAll(async () => {
    poId = (await http().post('/api/purchasing/orders').set(auth(buyer.token)).send({ branchId: PZ, warehouseId: WPZ, supplierId, idempotencyKey: key(), lines: [{ sku: 'TEST-WC-01', qty: '10', unitCost: '45.00' }] })).body.id;
    await http().post(`/api/purchasing/orders/${poId}/submit`).set(auth(buyer.token)).send({});
    await http().post(`/api/purchasing/orders/${poId}/receipts`).set(auth(keeper.token)).send({ documentRef: 'CMR', idempotencyKey: key(), lines: [{ lineNo: 1, qty: '10' }] });
  });

  it('fatura që përputhet krijon detyrim; ajo e bllokuar jo', async () => {
    const before = await tb();
    const bad = await http().post(`/api/purchasing/orders/${poId}/invoices`).set(auth(ap.token)).send({ invoiceNo: 'F-BLL', invoiceDate: today, lines: [{ lineNo: 1, qty: '10', unitCost: '50.00' }] });
    expect(bad.body.status).toBe('DISCREPANCY');
    expect((await tb()).bal('T-2000')).toBe(before.bal('T-2000'));
    const ok = await http().post(`/api/purchasing/orders/${poId}/invoices`).set(auth(ap.token)).send({ invoiceNo: 'F-001', invoiceDate: today, lines: [{ lineNo: 1, qty: '10', unitCost: '45.00' }] });
    expect(ok.body.status).toBe('MATCHED');
    const after = await tb();
    expect(after.bal('T-2000') - before.bal('T-2000')).toBeCloseTo(-450, 2);
    expect(after.bal('T-1400') - before.bal('T-1400')).toBeCloseTo(450, 2);
    const bal = (await http().get(`/api/purchasing/suppliers/${supplierId}/balance`).set(auth(ap.token))).body;
    expect(bal.openTotal).toBe('450.00');
  });

  it('pagesa kërkon aprovim nga financa; banka ulet vetëm pas aprovimit', async () => {
    const before = await tb();
    const req = await http().post(`/api/purchasing/suppliers/${supplierId}/payment-requests`).set(auth(ap.token)).send({ branchId: PZ, amount: '300.00', reference: 'TRX-77', reason: 'Pagesë e pjesshme e faturës F-001', idempotencyKey: key() });
    expect(req.status).toBe(201);
    expect((await tb()).bal('T-1100')).toBe(before.bal('T-1100'));
    expect((await decide(ap.token, req.body.id)).status).toBe(403);
    expect((await decide(finance.token, req.body.id)).body.status).toBe('APPROVED');
    const after = await tb();
    expect(after.bal('T-1100') - before.bal('T-1100')).toBeCloseTo(-300, 2);
    expect(after.bal('T-2000') - before.bal('T-2000')).toBeCloseTo(300, 2);
    expect((await http().get(`/api/purchasing/suppliers/${supplierId}/balance`).set(auth(ap.token))).body.openTotal).toBe('150.00');
  });

  it('nuk paguhet më shumë se detyrimi; blerësi nuk kërkon dot pagesë', async () => {
    const over = await http().post(`/api/purchasing/suppliers/${supplierId}/payment-requests`).set(auth(ap.token)).send({ branchId: PZ, amount: '150.01', reason: 'Mbi detyrimin', idempotencyKey: key() });
    expect(over.body.code).toBe('PAYMENT_EXCEEDS_PAYABLE');
    const byBuyer = await http().post(`/api/purchasing/suppliers/${supplierId}/payment-requests`).set(auth(buyer.token)).send({ branchId: PZ, amount: '10.00', reason: 'Pa leje', idempotencyKey: key() });
    expect(byBuyer.status).toBe(403);
    // Dy kërkesa për të njëjtën mbetje: e dyta dështon në aprovim.
    const a = await http().post(`/api/purchasing/suppliers/${supplierId}/payment-requests`).set(auth(ap.token)).send({ branchId: PZ, amount: '150.00', reason: 'Mbyllja e faturës', idempotencyKey: key() });
    const b = await http().post(`/api/purchasing/suppliers/${supplierId}/payment-requests`).set(auth(ap.token)).send({ branchId: PZ, amount: '150.00', reason: 'Dyfishim', idempotencyKey: key() });
    expect((await decide(finance.token, a.body.id)).body.status).toBe('APPROVED');
    expect((await decide(finance.token, b.body.id)).body.code).toBe('PAYMENT_EXCEEDS_PAYABLE');
    expect((await tb()).bal('T-2000')).toBeCloseTo(0, 2);
    await expect(pool.query('UPDATE supplier_payment SET amount = 1')).rejects.toThrow(/FINANCIAL_DOCUMENT_IMMUTABLE/);
  });
});

describe('Raportet', () => {
  it('shitjet sipas degës: faturat minus notat e kreditit', async () => {
    const r = (await http().get(`/api/reports/sales?from=${today}&to=${today}`).set(auth(acct.token))).body;
    const pz = r.rows.find((x: { branch: string }) => x.branch === 'PZ');
    expect(pz).toMatchObject({ invoices: 1, invoiced_net: '400.00', credit_notes: 3, credited_net: '400.00', net_sales: '0.00', gross_sales: '0.00' });
    expect(r.rows.find((x: { branch: string }) => x.branch === 'PR')).toMatchObject({ invoices: 0, net_sales: '0' });
  });

  it('borxhet e klientëve sipas vjetërsisë dhe detyrimet ndaj furnitorëve', async () => {
    // Një faturë e re me kredi, e papaguar: 2 × 100 + 18 % = 236.
    const o = await http().post('/api/sales/orders').set(auth(seller.token)).send({ branchId: PZ, warehouseId: WPZ, customerId: cust, onCredit: true, idempotencyKey: key(), lines: [{ sku: 'TEST-WC-01', qty: '2' }] });
    await http().post(`/api/sales/orders/${o.body.id}/confirm`).set(auth(seller.token)).send({});
    await http().post(`/api/sales/orders/${o.body.id}/deliveries`).set(auth(keeper.token)).send({ documentRef: 'FD', idempotencyKey: key(), lines: [{ lineNo: 1, qty: '2' }] });
    await http().post(`/api/sales/orders/${o.body.id}/invoices`).set(auth(cashier.token)).send({ idempotencyKey: key() });
    const rec = (await http().get('/api/reports/receivables').set(auth(acct.token))).body;
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ code: 'KL-KTHIM', total: '236.00', not_due: '236.00', d1_30: null });
    expect((await http().get('/api/reports/payables').set(auth(acct.token))).body).toEqual([]);
  });

  it('lëvizjet e stokut përputhen me dokumentet', async () => {
    const r = (await http().get(`/api/reports/stock-movements?from=${today}&to=${today}&warehouseId=${WPZ}`).set(auth(acct.token))).body;
    expect(r).toHaveLength(1);
    // Hyrje: 20 fillestare + 10 nga blerja; dalje: 4 + 2 të shitura; 1 e kthyer në stok.
    expect(r[0]).toMatchObject({ sku: 'TEST-WC-01', received: '30.0000', dispatched: '6.0000', returned: '1.0000' });
    expect(await stockWc()).toBe(25);
  });

  it('pa lejen e raporteve nuk shihen; libri mbetet i balancuar dhe auditi i paprekur', async () => {
    expect((await http().get(`/api/reports/sales?from=${today}&to=${today}`).set(auth(seller.token))).status).toBe(403);
    expect((await http().get('/api/reports/receivables').set(auth(cashier.token))).status).toBe(403);
    const { t, bal } = await tb();
    expect(t.totalDebit).toBe(t.totalCredit);
    const open = await pool.query<{ s: string }>('SELECT COALESCE(sum(open_amount), 0)::text AS s FROM customer_open_invoice');
    expect(bal('T-1200')).toBeCloseTo(Number(open.rows[0]?.s), 2);
    expect((await pool.query<{ b: string | null }>('SELECT audit_log_verify() AS b')).rows[0]?.b).toBeNull();
  });
});
