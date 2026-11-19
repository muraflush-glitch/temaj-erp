import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { assertNoProvisionalPolicies } from '../src/billing/billing.service';
import { createApp, freshDatabase, userWithRole } from './helpers';

type U = { id: number; token: string };
let pool: Pool; let app: INestApplication;
let seller: U; let salesMgr: U; let keeper: U; let cashier: U; let acct: U;
let PZ: number; let WPZ: number; let cashCust: number; let creditCust: number;
let seq = 0;
const key = () => `bill-test-${++seq}`;
const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  pool = await freshDatabase();
  app = await createApp();
  PZ = Number((await pool.query<{ id: string }>(`SELECT id FROM branch WHERE code = 'PZ'`)).rows[0]?.id);
  WPZ = Number((await pool.query<{ id: string }>(`SELECT id FROM warehouse WHERE code = 'PZ-MAIN'`)).rows[0]?.id);
  seller = await userWithRole(app, pool, 'shites@temaj.test', 'SALESPERSON', 'PZ');
  salesMgr = await userWithRole(app, pool, 'menaxher@temaj.test', 'SALES_MANAGER', null, true);
  keeper = await userWithRole(app, pool, 'magazinier@temaj.test', 'WAREHOUSE_KEEPER', 'PZ');
  cashier = await userWithRole(app, pool, 'arketar@temaj.test', 'CASHIER', 'PZ');
  acct = await userWithRole(app, pool, 'kontabilist@temaj.test', 'ACCOUNTANT', null);
  const reg = await pool.query<{ id: string }>(`SELECT id FROM cash_register WHERE code = 'ARKA-PZ'`);
  const opened = await http().post(`/api/cash/registers/${reg.rows[0]?.id}/open`).set(auth(cashier.token));
  if (opened.status !== 201) throw new Error(JSON.stringify(opened.body));
  await http().post('/api/inventory/receipts').set(auth(keeper.token)).send({ warehouseId: WPZ, sku: 'TEST-WC-01', qty: '50', documentRef: 'HYRJE', idempotencyKey: key() });
  await http().post('/api/sales/prices').set(auth(salesMgr.token)).send({ sku: 'TEST-WC-01', validFrom: '2020-01-01', unitPrice: '99.99' });
  cashCust = (await http().post('/api/sales/customers').set(auth(seller.token)).send({ code: 'KL-CASH', name: 'Klient me para në dorë', kind: 'PERSON' })).body.id;
  creditCust = (await http().post('/api/sales/customers').set(auth(salesMgr.token)).send({ code: 'KL-KREDI', name: 'Firmë me kredi', kind: 'COMPANY', creditLimit: '500', paymentTermDays: 30 })).body.id;
});
afterAll(async () => { await app.close(); await pool.end(); });

/** Krijon, konfirmon dhe dorëzon një porosi WC; kthen ID-në. */
async function deliveredOrder(customerId: number, qty: string, onCredit = false, deliverQty = qty): Promise<number> {
  const o = await http().post('/api/sales/orders').set(auth(seller.token)).send({ branchId: PZ, warehouseId: WPZ, customerId, onCredit, idempotencyKey: key(), lines: [{ sku: 'TEST-WC-01', qty }] });
  const c = await http().post(`/api/sales/orders/${o.body.id}/confirm`).set(auth(seller.token)).send({});
  if (c.body.status !== 'CONFIRMED') throw new Error(JSON.stringify(c.body));
  const d = await http().post(`/api/sales/orders/${o.body.id}/deliveries`).set(auth(keeper.token)).send({ documentRef: 'FD-TEST', idempotencyKey: key(), lines: [{ lineNo: 1, qty: deliverQty }] });
  if (d.status !== 201) throw new Error(JSON.stringify(d.body));
  return o.body.id;
}
const invoice = (t: string, orderId: number, payment?: object, k = key()) => http().post(`/api/sales/orders/${orderId}/invoices`).set(auth(t)).send({ idempotencyKey: k, payment });
const tb = async () => {
  const today = (await pool.query<{ d: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0]?.d;
  const t = (await http().get(`/api/ledger/trial-balance?asOf=${today}`).set(auth(acct.token))).body as { accounts: { code: string; balance: string }[]; totalDebit: string; totalCredit: string };
  return { bal: (code: string) => Number(t.accounts.find((a) => a.code === code)?.balance ?? 0), t };
};
const balance = async (customerId: number) => (await http().get(`/api/sales/customers/${customerId}/balance`).set(auth(cashier.token))).body;

describe('Fatura me pagesë në dorëzim', () => {
  let orderId: number;
  beforeAll(async () => { orderId = await deliveredOrder(cashCust, '3'); });

  it('pa arkëtim nuk lëshohet', async () => {
    const res = await invoice(cashier.token, orderId);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PAYMENT_REQUIRED');
  });

  it('lëshohet me arkëtim: TVSH-ja llogaritet, libri regjistrohet dhe arka rritet saktësisht sa pagesa', async () => {
    const before = await tb();
    const res = await invoice(cashier.token, orderId, { method: 'CASH' }, 'invoice-key-0001');
    expect(res.status).toBe(201);
    // 3 × 99.99 = 299.97 neto; TVSH 18 % = 53.99 (53.9946 e rrumbullakuar); bruto 353.96
    expect(res.body).toMatchObject({ invoiceNo: 1, gross: '353.96', created: true });
    const after = await tb();
    expect(after.bal('T-1000') - before.bal('T-1000')).toBeCloseTo(353.96, 2);     // arka: + bruto
    expect(after.bal('T-4000') - before.bal('T-4000')).toBeCloseTo(-299.97, 2);    // të ardhura: neto
    expect(after.bal('T-2400') - before.bal('T-2400')).toBeCloseTo(-53.99, 2);     // TVSH e llogaritur
    expect(after.bal('T-1200')).toBeCloseTo(before.bal('T-1200'), 2);              // klienti nuk mbetet borxh
    expect(after.t.totalDebit).toBe(after.t.totalCredit);
    expect((await balance(cashCust)).openTotal).toBe('0.00');
  });

  it('e njëjta kërkesë e dërguar dy herë nuk krijon dy fatura as dy arkëtime', async () => {
    const before = await tb();
    const res = await invoice(cashier.token, orderId, { method: 'CASH' }, 'invoice-key-0001');
    expect(res.body).toMatchObject({ invoiceNo: 1, created: false });
    expect((await tb()).bal('T-1000')).toBe(before.bal('T-1000'));
  });

  it('i njëjti mall nuk faturohet dy herë', async () => {
    const res = await invoice(cashier.token, orderId, { method: 'CASH' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOTHING_TO_INVOICE');
  });

  it('faturohet vetëm malli i dorëzuar', async () => {
    const id = await deliveredOrder(cashCust, '4', false, '1'); // porositur 4, dorëzuar 1
    const res = await invoice(cashier.token, id, { method: 'BANK', reference: 'TRX-1' });
    expect(res.body.gross).toBe('117.99'); // 1 × 99.99 + 18 %
    await expect(pool.query('UPDATE sales_order_line SET qty_invoiced = qty WHERE order_id = $1', [id])).rejects.toThrow(/sales_line_invoiced_le_delivered/);
  });

  it('shitësi dhe magazinieri nuk lëshojnë fatura', async () => {
    const id = await deliveredOrder(cashCust, '1');
    expect((await invoice(seller.token, id, { method: 'CASH' })).status).toBe(403);
    expect((await invoice(keeper.token, id, { method: 'CASH' })).status).toBe(403);
  });

  it('faturat janë të pandryshueshme, me numra pa boshllëqe, dhe asnjëra nuk shënohet si fiskale', async () => {
    await expect(pool.query('UPDATE sales_invoice SET gross = 1, net = 1, vat = 0')).rejects.toThrow(/FINANCIAL_DOCUMENT_IMMUTABLE/);
    await expect(pool.query('DELETE FROM sales_invoice')).rejects.toThrow(/FINANCIAL_DOCUMENT_IMMUTABLE/);
    const n = await pool.query<{ n: string; mx: string; fisc: string; prov: string }>(
      `SELECT count(*) AS n, max(invoice_no) AS mx, count(*) FILTER (WHERE is_fiscalized) AS fisc, count(*) FILTER (WHERE is_provisional_tax) AS prov FROM sales_invoice`);
    expect(n.rows[0]?.mx).toBe(n.rows[0]?.n);
    expect(n.rows[0]?.fisc).toBe('0');
    expect(n.rows[0]?.prov).toBe(n.rows[0]?.n);   // të gjitha të shënuara si të llogaritura me rregulla provizore
  });
});

describe('Shitja me kredi dhe arkëtimet', () => {
  let orderId: number;

  it('fatura me kredi nuk kërkon arkëtim; klienti mbetet borxh me afat pagese', async () => {
    orderId = await deliveredOrder(creditCust, '2', true);
    const before = await tb();
    const res = await invoice(cashier.token, orderId);
    expect(res.body.gross).toBe('235.98'); // 199.98 + 36.00
    const after = await tb();
    expect(after.bal('T-1200') - before.bal('T-1200')).toBeCloseTo(235.98, 2);
    expect(after.bal('T-1000')).toBe(before.bal('T-1000'));   // arka NUK rritet pa arkëtim real
    const b = await balance(creditCust);
    expect(b.openTotal).toBe('235.98');
    expect(b.openInvoices).toHaveLength(1);
    const due = await pool.query<{ d: number }>(`SELECT due_date - invoice_date AS d FROM sales_invoice WHERE id = $1`, [res.body.id]);
    expect(due.rows[0]?.d).toBe(30);
  });

  it('arkëtimi i pjesshëm e ul borxhin; arka rritet vetëm sa paratë e marra', async () => {
    const before = await tb();
    const res = await http().post(`/api/sales/customers/${creditCust}/payments`).set(auth(cashier.token)).send({ branchId: PZ, method: 'CASH', amount: '100.00', idempotencyKey: 'payment-key-0001' });
    expect(res.body).toMatchObject({ allocated: '100.00', advance: '0.00', created: true });
    const after = await tb();
    expect(after.bal('T-1000') - before.bal('T-1000')).toBeCloseTo(100, 2);
    expect((await balance(creditCust)).openTotal).toBe('135.98');
    const again = await http().post(`/api/sales/customers/${creditCust}/payments`).set(auth(cashier.token)).send({ branchId: PZ, method: 'CASH', amount: '100.00', idempotencyKey: 'payment-key-0001' });
    expect(again.body.created).toBe(false);
    expect((await balance(creditCust)).openTotal).toBe('135.98');
  });

  it('pagesa më e madhe se borxhi: teprica mbetet avans i klientit, jo e ardhur', async () => {
    const before = await tb();
    const res = await http().post(`/api/sales/customers/${creditCust}/payments`).set(auth(cashier.token)).send({ branchId: PZ, method: 'BANK', amount: '200.00', reference: 'TRX-9', idempotencyKey: key() });
    expect(res.body).toMatchObject({ allocated: '135.98', advance: '64.02' });
    const after = await tb();
    expect(after.bal('T-1100') - before.bal('T-1100')).toBeCloseTo(200, 2);
    expect(after.bal('T-2300') - before.bal('T-2300')).toBeCloseTo(-64.02, 2);
    expect(after.bal('T-4000')).toBe(before.bal('T-4000'));
    const b = await balance(creditCust);
    expect(b).toMatchObject({ openTotal: '0.00', unappliedAdvances: '64.02' });
  });

  it('databaza nuk lejon që një faturë të paguhet më shumë se vlera e saj', async () => {
    const inv = await pool.query<{ id: string }>('SELECT id FROM sales_invoice WHERE customer_id = $1', [creditCust]);
    const pay = await pool.query<{ id: string }>('SELECT id FROM customer_payment WHERE customer_id = $1 ORDER BY id DESC LIMIT 1', [creditCust]);
    await expect(pool.query('INSERT INTO payment_allocation(payment_id, invoice_id, amount) VALUES ($1, $2, 50)', [pay.rows[0]?.id, inv.rows[0]?.id])).rejects.toThrow(/OVER_ALLOCATION/);
    await expect(pool.query('UPDATE customer_payment SET amount = 1')).rejects.toThrow(/FINANCIAL_DOCUMENT_IMMUTABLE/);
  });

  it('porosia me kredi mbi limitin e klientit kërkon aprovim', async () => {
    // Limiti 500 €; porosi 5 × 99.99 × 1.18 = 589.94 €
    const o = await http().post('/api/sales/orders').set(auth(seller.token)).send({ branchId: PZ, warehouseId: WPZ, customerId: creditCust, onCredit: true, idempotencyKey: key(), lines: [{ sku: 'TEST-WC-01', qty: '5' }] });
    const c = await http().post(`/api/sales/orders/${o.body.id}/confirm`).set(auth(seller.token)).send({ reason: 'Klient i besueshëm, pagesa e sigurt' });
    expect(c.body).toMatchObject({ status: 'PENDING_APPROVAL', exceptions: ['CREDIT_LIMIT_EXCEEDED'] });
    // E njëjta porosi me pagesë në dorëzim nuk e prek limitin.
    const cash = await http().post('/api/sales/orders').set(auth(seller.token)).send({ branchId: PZ, warehouseId: WPZ, customerId: creditCust, idempotencyKey: key(), lines: [{ sku: 'TEST-WC-01', qty: '5' }] });
    expect((await http().post(`/api/sales/orders/${cash.body.id}/confirm`).set(auth(seller.token)).send({})).body.status).toBe('CONFIRMED');
  });

  it('klienti me kredi brenda limitit konfirmohet pa aprovim', async () => {
    const o = await http().post('/api/sales/orders').set(auth(seller.token)).send({ branchId: PZ, warehouseId: WPZ, customerId: creditCust, onCredit: true, idempotencyKey: key(), lines: [{ sku: 'TEST-WC-01', qty: '1' }] });
    expect((await http().post(`/api/sales/orders/${o.body.id}/confirm`).set(auth(seller.token)).send({})).body.status).toBe('CONFIRMED');
  });
});

describe('Mbrojtjet e përgjithshme', () => {
  it('libri kryesor mbetet i balancuar dhe çdo faturë e arkëtim ka regjistrimin e vet të postuar', async () => {
    const { t } = await tb();
    expect(t.totalDebit).toBe(t.totalCredit);
    const orphan = await pool.query(
      `SELECT 1 FROM sales_invoice i JOIN journal_entry e ON e.id = i.journal_entry_id WHERE e.status <> 'POSTED'
       UNION ALL SELECT 1 FROM customer_payment p JOIN journal_entry e ON e.id = p.journal_entry_id WHERE e.status <> 'POSTED'`);
    expect(orphan.rowCount).toBe(0);
    // Borxhi i klientëve në libër = shuma e faturave të hapura.
    const ar = (await tb()).bal('T-1200');
    const open = await pool.query<{ s: string }>('SELECT COALESCE(sum(open_amount), 0)::text AS s FROM customer_open_invoice');
    expect(ar).toBeCloseTo(Number(open.rows[0]?.s), 2);
  });

  it('në periudhë të mbyllur nuk lëshohet faturë', async () => {
    const id = await deliveredOrder(cashCust, '1');
    await pool.query(`UPDATE fiscal_period SET status = 'CLOSED', closed_by = $1 WHERE CURRENT_DATE BETWEEN start_date AND end_date`, [acct.id]);
    const res = await invoice(cashier.token, id, { method: 'CASH' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PERIOD_CLOSED');
    expect((await pool.query('SELECT 1 FROM sales_invoice WHERE order_id = $1', [id])).rowCount).toBe(0);
  });

  it('Production refuzon të niset me rregulla provizore', async () => {
    await expect(assertNoProvisionalPolicies(pool)).rejects.toThrow(/Production i bllokuar/);
  });

  it('audit trail i paprekur', async () => {
    const a = await pool.query<{ action: string }>(`SELECT DISTINCT action FROM audit_log WHERE action IN ('sales.invoice_issued', 'payment.received')`);
    expect(a.rowCount).toBe(2);
    expect((await pool.query<{ b: string | null }>('SELECT audit_log_verify() AS b')).rows[0]?.b).toBeNull();
  });
});
