import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp, freshDatabase, userWithRole } from './helpers';

type U = { id: number; token: string };
let pool: Pool; let app: INestApplication;
let buyer: U; let approver: U; let keeper: U; let keeperPr: U; let ap: U;
let PZ: number; let WPZ: number; let supplierId: number;
let seq = 0;
const key = () => `purch-test-${++seq}`;
const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const LOT = { lotCode: 'IMP-2030-01', shade: 'C03', caliber: '8' };

beforeAll(async () => {
  pool = await freshDatabase();
  app = await createApp();
  PZ = Number((await pool.query<{ id: string }>(`SELECT id FROM branch WHERE code = 'PZ'`)).rows[0]?.id);
  WPZ = Number((await pool.query<{ id: string }>(`SELECT id FROM warehouse WHERE code = 'PZ-MAIN'`)).rows[0]?.id);
  buyer = await userWithRole(app, pool, 'bleres@temaj.test', 'PURCHASER', 'PZ');
  approver = await userWithRole(app, pool, 'aprovues.blerje@temaj.test', 'PURCHASE_APPROVER', null, true);
  keeper = await userWithRole(app, pool, 'magazinier@temaj.test', 'WAREHOUSE_KEEPER', 'PZ');
  keeperPr = await userWithRole(app, pool, 'magazinier.pr@temaj.test', 'WAREHOUSE_KEEPER', 'PR');
  ap = await userWithRole(app, pool, 'financa@temaj.test', 'AP_CLERK', null);
  supplierId = (await http().post('/api/purchasing/suppliers').set(auth(buyer.token)).send({ code: 'FUR-TEST-1', name: 'Furnitor Testues', country: 'Itali' })).body.id;
});
afterAll(async () => { await app.close(); await pool.end(); });

const po = (lines: object[]) => http().post('/api/purchasing/orders').set(auth(buyer.token)).send({ branchId: PZ, warehouseId: WPZ, supplierId, idempotencyKey: key(), lines });
const submit = (id: number, reason?: string) => http().post(`/api/purchasing/orders/${id}/submit`).set(auth(buyer.token)).send({ reason });
const receive = (t: string, id: number, lines: object[], k = key()) => http().post(`/api/purchasing/orders/${id}/receipts`).set(auth(t)).send({ documentRef: 'CMR-TEST', idempotencyKey: k, lines });
const invoice = (id: number, invoiceNo: string, lines: object[]) => http().post(`/api/purchasing/orders/${id}/invoices`).set(auth(ap.token)).send({ invoiceNo, invoiceDate: '2030-01-10', lines });
const getPo = async (id: number) => (await http().get(`/api/purchasing/orders/${id}`).set(auth(buyer.token))).body;
const onHand = async (sku: string) => ((await http().get(`/api/inventory/warehouses/${WPZ}/stock`).set(auth(keeper.token))).body as { sku: string; on_hand: string }[])
  .filter((r) => r.sku === sku).reduce((s, r) => s + Number(r.on_hand), 0);

describe('Porosia e blerjes dhe aprovimi', () => {
  it('nën prag aprovohet menjëherë', async () => {
    const id = (await po([{ sku: 'TEST-WC-01', qty: '10', unitCost: '45.00' }])).body.id; // 450 €
    expect((await submit(id)).body).toEqual({ status: 'APPROVED' });
  });

  it('mbi prag kërkon arsyetim dhe aprovues tjetër me 2FA; malli nuk pranohet para aprovimit', async () => {
    const id = (await po([{ sku: 'TEST-PLL-6060', qty: '144.00', unitCost: '7.50' }])).body.id; // 1080 €
    expect((await submit(id)).body.code).toBe('REASON_REQUIRED');
    const s = await submit(id, 'Furnizim për sezonin');
    expect(s.body.status).toBe('PENDING_APPROVAL');
    expect((await receive(keeper.token, id, [{ lineNo: 1, qty: '14.40', lot: LOT }])).status).toBe(409);
    expect((await http().post(`/api/approvals/${s.body.approvalRequestId}/decide`).set(auth(buyer.token)).send({ decision: 'APPROVE' })).status).toBe(403);
    const dec = await http().post(`/api/approvals/${s.body.approvalRequestId}/decide`).set(auth(approver.token)).send({ decision: 'APPROVE' });
    expect(dec.body.status).toBe('APPROVED');
    expect((await getPo(id)).status).toBe('APPROVED');
  });

  it('refuzimi e kthen porosinë në draft', async () => {
    const id = (await po([{ sku: 'TEST-WC-01', qty: '100', unitCost: '45.00' }])).body.id;
    const s = await submit(id, 'Porosi e madhe');
    await http().post(`/api/approvals/${s.body.approvalRequestId}/decide`).set(auth(approver.token)).send({ decision: 'REJECT' });
    expect((await getPo(id)).status).toBe('DRAFT');
  });

  it('porosia e dërguar nuk ndryshohet, as drejtpërdrejt në databazë', async () => {
    const id = (await po([{ sku: 'TEST-WC-01', qty: '2', unitCost: '45.00' }])).body.id;
    await submit(id);
    await expect(pool.query('UPDATE purchase_order_line SET unit_cost = 1 WHERE po_id = $1', [id])).rejects.toThrow(/PURCHASE_ORDER_LOCKED/);
    await expect(pool.query('UPDATE purchase_order_line SET qty = 999 WHERE po_id = $1', [id])).rejects.toThrow(/PURCHASE_ORDER_LOCKED/);
    await expect(pool.query('DELETE FROM purchase_order WHERE id = $1', [id])).rejects.toThrow(/PURCHASE_ORDER_LOCKED/);
  });

  it('valuta e huaj nuk pranohet ende', async () => {
    await expect(pool.query(`UPDATE purchase_order SET currency = 'USD' WHERE status = 'DRAFT'`)).rejects.toThrow(/currency/);
  });
});

describe('Pranimi i mallit', () => {
  let id: number;
  beforeAll(async () => {
    id = (await po([{ sku: 'TEST-PLL-6060', qty: '28.80', unitCost: '7.50' }, { sku: 'TEST-WC-01', qty: '6', unitCost: '45.00' }])).body.id; // 216 + 270
    await submit(id);
  });

  it('pranimi i pjesshëm hyn në stok me lot dhe e shënon porosinë si të pranuar pjesërisht', async () => {
    const before = await onHand('TEST-PLL-6060');
    const res = await receive(keeper.token, id, [{ lineNo: 1, qty: '14.40', lot: LOT }], 'receipt-key-0001');
    expect(res.body).toMatchObject({ status: 'PARTIALLY_RECEIVED', created: true });
    expect(await onHand('TEST-PLL-6060')).toBeCloseTo(before + 14.4, 4);
    const lines = (await getPo(id)).lines;
    expect(lines[0]).toMatchObject({ qty_received: '14.4000', qty_invoiced: '0.0000' });
  });

  it('i njëjti pranim i dërguar dy herë nuk hyn dy herë në stok', async () => {
    const before = await onHand('TEST-PLL-6060');
    const res = await receive(keeper.token, id, [{ lineNo: 1, qty: '14.40', lot: LOT }], 'receipt-key-0001');
    expect(res.body.created).toBe(false);
    expect(await onHand('TEST-PLL-6060')).toBe(before);
  });

  it('nuk pranohet më shumë se sa është porositur, pa lot, ose nga dega tjetër', async () => {
    expect((await receive(keeper.token, id, [{ lineNo: 1, qty: '28.80', lot: LOT }])).body.code).toBe('OVER_RECEIPT'); // kanë mbetur 14.40
    expect((await receive(keeper.token, id, [{ lineNo: 1, qty: '1.44' }])).body.code).toBe('LOT_REQUIRED');
    expect((await receive(keeperPr.token, id, [{ lineNo: 2, qty: '1' }])).status).toBe(403);
    expect((await receive(buyer.token, id, [{ lineNo: 2, qty: '1' }])).status).toBe(403); // blerësi nuk pranon mallin e vet
  });

  it('pranimi i fundit e mbyll porosinë', async () => {
    const res = await receive(keeper.token, id, [{ lineNo: 1, qty: '14.40', lot: LOT }, { lineNo: 2, qty: '6' }]);
    expect(res.body.status).toBe('RECEIVED');
    expect(await onHand('TEST-WC-01')).toBe(6);
  });

  it('pranimet janë të pandryshueshme dhe lidhen me lëvizjet e stokut', async () => {
    await expect(pool.query('UPDATE goods_receipt_line SET qty = 1')).rejects.toThrow(/PURCHASE_DOCUMENT_IMMUTABLE/);
    const r = await pool.query(`SELECT 1 FROM goods_receipt_line g JOIN stock_movement m ON m.id = g.movement_id WHERE m.type <> 'RECEIPT' OR m.qty <> g.qty`);
    expect(r.rowCount).toBe(0);
  });
});

describe('Fatura e furnitorit — përputhja tripalëshe', () => {
  let id: number;
  beforeAll(async () => {
    id = (await po([{ sku: 'TEST-WC-01', qty: '10', unitCost: '45.00' }])).body.id;
    await submit(id);
    await receive(keeper.token, id, [{ lineNo: 1, qty: '4' }]); // pranuar vetëm 4 nga 10
  });

  it('fatura për më shumë se malli i pranuar bllokohet si mospërputhje', async () => {
    const res = await invoice(id, 'INV-001', [{ lineNo: 1, qty: '10', unitCost: '45.00' }]);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DISCREPANCY');
    expect(res.body.discrepancies).toEqual([{ lineNo: 1, type: 'QTY_EXCEEDS_RECEIVED', invoiced: '10', receivedNotInvoiced: '4.0000' }]);
    expect((await getPo(id)).lines[0].qty_invoiced).toBe('0.0000');
  });

  it('fatura me çmim ndryshe nga porosia bllokohet si mospërputhje', async () => {
    const res = await invoice(id, 'INV-002', [{ lineNo: 1, qty: '4', unitCost: '46.00' }]);
    expect(res.body.discrepancies).toEqual([{ lineNo: 1, type: 'PRICE_MISMATCH', invoiced: '46.00', ordered: '45.0000' }]);
  });

  it('fatura që përputhet me porosinë dhe pranimin pranohet', async () => {
    const res = await invoice(id, 'INV-003', [{ lineNo: 1, qty: '4', unitCost: '45.00' }]);
    expect(res.body).toMatchObject({ status: 'MATCHED', discrepancies: [] });
    expect((await getPo(id)).lines[0].qty_invoiced).toBe('4.0000');
  });

  it('i njëjti mall nuk faturohet dy herë', async () => {
    const res = await invoice(id, 'INV-004', [{ lineNo: 1, qty: '1', unitCost: '45.00' }]);
    expect(res.body.status).toBe('DISCREPANCY'); // gjithë malli i pranuar është faturuar tashmë
    const dup = await invoice(id, 'INV-003', [{ lineNo: 1, qty: '4', unitCost: '45.00' }]);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_INVOICE');
  });

  it('blerësi dhe magazinieri nuk regjistrojnë fatura; financa nuk pranon mall', async () => {
    const body = { invoiceNo: 'INV-X', invoiceDate: '2030-01-10', lines: [{ lineNo: 1, qty: '1', unitCost: '45.00' }] };
    expect((await http().post(`/api/purchasing/orders/${id}/invoices`).set(auth(buyer.token)).send(body)).status).toBe(403);
    expect((await http().post(`/api/purchasing/orders/${id}/invoices`).set(auth(keeper.token)).send(body)).status).toBe(403);
    expect((await receive(ap.token, id, [{ lineNo: 1, qty: '1' }])).status).toBe(403);
  });

  it('faturat e regjistruara nuk ndryshohen; audit trail është i plotë dhe i paprekur', async () => {
    await expect(pool.query(`UPDATE supplier_invoice SET status = 'MATCHED', discrepancies = '[]'`)).rejects.toThrow(/PURCHASE_DOCUMENT_IMMUTABLE/);
    const a = await pool.query<{ action: string }>(`SELECT DISTINCT action FROM audit_log WHERE action LIKE 'purchase.%' OR action = 'supplier.created'`);
    expect(a.rows.map((r) => r.action).sort()).toEqual(['purchase.goods_received', 'purchase.invoice_discrepancy', 'purchase.invoice_matched', 'purchase.order_approved', 'purchase.order_drafted', 'supplier.created']);
    expect((await pool.query<{ b: string | null }>('SELECT audit_log_verify() AS b')).rows[0]?.b).toBeNull();
  });
});
