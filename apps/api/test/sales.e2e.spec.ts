import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp, freshDatabase, userWithRole } from './helpers';

type U = { id: number; token: string };
let pool: Pool; let app: INestApplication;
let seller: U; let sellerPr: U; let salesMgr: U; let keeper: U; let catalog: U;
let PZ: number; let WPZ: number; let WPR: number; let custId: number;
let seq = 0;
const key = () => `sales-test-${++seq}`;
const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const LOT_A = { lotCode: 'L-01', shade: 'A12', caliber: '9' };
const LOT_B = { lotCode: 'L-02', shade: 'B07', caliber: '9' };

beforeAll(async () => {
  pool = await freshDatabase();
  app = await createApp();
  PZ = Number((await pool.query<{ id: string }>(`SELECT id FROM branch WHERE code = 'PZ'`)).rows[0]?.id);
  const w = await pool.query<{ id: string; code: string }>('SELECT id, code FROM warehouse');
  WPZ = Number(w.rows.find((r) => r.code === 'PZ-MAIN')?.id); WPR = Number(w.rows.find((r) => r.code === 'PR-MAIN')?.id);
  seller = await userWithRole(app, pool, 'shites.pz@temaj.test', 'SALESPERSON', 'PZ');
  sellerPr = await userWithRole(app, pool, 'shites.pr@temaj.test', 'SALESPERSON', 'PR');
  salesMgr = await userWithRole(app, pool, 'menaxher.shitje@temaj.test', 'SALES_MANAGER', null, true);
  keeper = await userWithRole(app, pool, 'magazinier@temaj.test', 'WAREHOUSE_KEEPER', 'PZ');
  catalog = await userWithRole(app, pool, 'katalog@temaj.test', 'CATALOG_MANAGER', null);
  // Stok fillestar: 10 kuti (14.40 m²) nuanca A, 5 kuti (7.20 m²) nuanca B, 4 WC.
  const rec = (sku: string, qty: string, lot?: object) => http().post('/api/inventory/receipts').set(auth(keeper.token))
    .send({ warehouseId: WPZ, sku, qty, lot, documentRef: 'HYRJE-FILLESTARE', idempotencyKey: key() });
  await rec('TEST-PLL-6060', '14.40', LOT_A); await rec('TEST-PLL-6060', '7.20', LOT_B); await rec('TEST-WC-01', '4');
  for (const [sku, price] of [['TEST-PLL-6060', '12.50'], ['TEST-WC-01', '80.00']]) {
    const r = await http().post('/api/sales/prices').set(auth(salesMgr.token)).send({ sku, validFrom: '2020-01-01', unitPrice: price });
    if (r.status !== 204) throw new Error(JSON.stringify(r.body));
  }
  const c = await http().post('/api/sales/customers').set(auth(seller.token)).send({ code: 'KL-TEST-1', name: 'Klient Testues', kind: 'PERSON' });
  custId = c.body.id;
});
afterAll(async () => { await app.close(); await pool.end(); });

const order = async (t: string, lines: object[], extra: object = {}) =>
  http().post('/api/sales/orders').set(auth(t)).send({ branchId: PZ, warehouseId: WPZ, customerId: custId, idempotencyKey: key(), lines, ...extra });
const confirm = (t: string, id: number, reason?: string) => http().post(`/api/sales/orders/${id}/confirm`).set(auth(t)).send({ reason });
const deliver = (t: string, id: number, lines: object[], k = key()) =>
  http().post(`/api/sales/orders/${id}/deliveries`).set(auth(t)).send({ documentRef: 'FLETEDERGESE-TEST', idempotencyKey: k, lines });
const bal = async (sku: string, lotCode?: string) => {
  const rows = (await http().get(`/api/inventory/warehouses/${WPZ}/stock`).set(auth(keeper.token))).body as { sku: string; lot_code: string | null; on_hand: string; reserved: string; available: string }[];
  const r = rows.find((x) => x.sku === sku && (lotCode === undefined || x.lot_code === lotCode));
  return r ? { on_hand: r.on_hand, reserved: r.reserved, available: r.available } : { on_hand: '0', reserved: '0', available: '0' };
};

describe('Oferta dhe konfirmimi', () => {
  let id: number;

  it('oferta merr çmimin e listës dhe nuk rezervon stok', async () => {
    const res = await order(seller.token, [{ sku: 'TEST-PLL-6060', lot: LOT_A, qty: '2.88', discountPct: '5' }, { sku: 'TEST-WC-01', qty: '1' }]);
    expect(res.status).toBe(201);
    id = res.body.id;
    const o = (await http().get(`/api/sales/orders/${id}`).set(auth(seller.token))).body;
    expect(o.status).toBe('DRAFT');
    expect(o.lines.map((l: { sku: string; unit_price: string; net: string }) => [l.sku, l.unit_price, l.net])).toEqual([
      ['TEST-PLL-6060', '12.5000', '34.2000'],   // 2.88 × 12.50 × 0.95
      ['TEST-WC-01', '80.0000', '80.0000'],
    ]);
    expect(o.totalNet).toBe('114.2000');
    expect((await bal('TEST-PLL-6060', 'L-01')).reserved).toBe('0.0000');
  });

  it('konfirmimi brenda limiteve e rezervon stokun pa aprovim', async () => {
    const res = await confirm(seller.token, id);
    expect(res.body).toEqual({ status: 'CONFIRMED', exceptions: [] });
    expect(await bal('TEST-PLL-6060', 'L-01')).toEqual({ on_hand: '14.4000', reserved: '2.8800', available: '11.5200' });
    expect((await bal('TEST-WC-01')).reserved).toBe('1.0000');
  });

  it('porosia e konfirmuar nuk ndryshohet, as drejtpërdrejt në databazë', async () => {
    await expect(pool.query('UPDATE sales_order_line SET unit_price = 1 WHERE order_id = $1', [id])).rejects.toThrow(/SALES_ORDER_LOCKED/);
    await expect(pool.query('UPDATE sales_order_line SET qty = 99 WHERE order_id = $1', [id])).rejects.toThrow(/SALES_ORDER_LOCKED/);
    await expect(pool.query('DELETE FROM sales_order_line WHERE order_id = $1', [id])).rejects.toThrow(/SALES_ORDER_LOCKED/);
    await expect(pool.query('DELETE FROM sales_order WHERE id = $1', [id])).rejects.toThrow(/SALES_ORDER_LOCKED/);
  });

  it('malli i rezervuar nuk del për dikë tjetër', async () => {
    // WC: 4 në stok, 1 e rezervuar → vetëm 3 të lira.
    const res = await http().post('/api/inventory/dispatches').set(auth(keeper.token)).send({ warehouseId: WPZ, sku: 'TEST-WC-01', qty: '4', documentRef: 'DALJE-DIREKTE', idempotencyKey: key() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STOCK_RESERVED');
    const transfer = await http().post('/api/inventory/transfers').set(auth(keeper.token)).send({
      fromWarehouseId: WPZ, toWarehouseId: WPR, documentRef: 'TR-TEST', idempotencyKey: key(), lines: [{ sku: 'TEST-WC-01', qty: '4' }] });
    expect(transfer.body.code).toBe('STOCK_RESERVED');
  });

  it('nuk rezervohet më shumë se stoku i lirë', async () => {
    const o = await order(seller.token, [{ sku: 'TEST-WC-01', qty: '4' }]); // të lira vetëm 3
    const res = await confirm(seller.token, o.body.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
    expect((await bal('TEST-WC-01')).reserved).toBe('1.0000');
    expect((await http().get(`/api/sales/orders/${o.body.id}`).set(auth(seller.token))).body.status).toBe('DRAFT');
  });

  it('10 porosi paralele për 3 WC të lira: saktësisht 3 konfirmohen', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) ids.push((await order(seller.token, [{ sku: 'TEST-WC-01', qty: '1' }])).body.id);
    const results = await Promise.all(ids.map((i) => confirm(seller.token, i)));
    expect(results.filter((r) => r.body.status === 'CONFIRMED')).toHaveLength(3);
    expect(results.filter((r) => r.body.code === 'INSUFFICIENT_AVAILABLE_STOCK')).toHaveLength(7);
    expect(await bal('TEST-WC-01')).toEqual({ on_hand: '4.0000', reserved: '4.0000', available: '0.0000' });
  });

  it('oferta pa kuti të plota, pa lot ose pa çmim refuzohet', async () => {
    expect((await order(seller.token, [{ sku: 'TEST-PLL-6060', lot: LOT_A, qty: '1.00' }])).body.code).toBe('INVALID_QUANTITY_STEP');
    expect((await order(seller.token, [{ sku: 'TEST-PLL-6060', qty: '1.44' }])).body.code).toBe('LOT_REQUIRED');
    expect((await order(seller.token, [{ sku: 'TEST-PLL-3060', lot: LOT_A, qty: '0.18' }])).body.code).toBe('NO_PRICE');
  });
});

describe('Dorëzimet', () => {
  let id: number;
  beforeAll(async () => {
    id = (await order(seller.token, [{ sku: 'TEST-PLL-6060', lot: LOT_A, qty: '5.76' }])).body.id; // 4 kuti
    await confirm(seller.token, id);
  });

  it('shitësi nuk dorëzon; dorëzon magazinieri', async () => {
    expect((await deliver(seller.token, id, [{ lineNo: 1, qty: '1.44' }])).status).toBe(403);
  });

  it('dorëzimi i pjesshëm ul stokun fizik dhe rezervimin bashkë', async () => {
    const before = await bal('TEST-PLL-6060', 'L-01');
    const res = await deliver(keeper.token, id, [{ lineNo: 1, qty: '2.88' }], 'delivery-key-0001');
    expect(res.body).toEqual({ status: 'PARTIALLY_DELIVERED', created: true });
    const after = await bal('TEST-PLL-6060', 'L-01');
    expect(Number(after.on_hand)).toBeCloseTo(Number(before.on_hand) - 2.88, 4);
    expect(Number(after.reserved)).toBeCloseTo(Number(before.reserved) - 2.88, 4);
    expect(after.available).toBe(before.available);   // malli i lirë për të tjerët nuk ndryshon
  });

  it('i njëjti dorëzim i dërguar dy herë nuk e ul stokun dy herë', async () => {
    const before = await bal('TEST-PLL-6060', 'L-01');
    const res = await deliver(keeper.token, id, [{ lineNo: 1, qty: '2.88' }], 'delivery-key-0001');
    expect(res.body.created).toBe(false);
    expect(await bal('TEST-PLL-6060', 'L-01')).toEqual(before);
  });

  it('nuk dorëzohet më shumë se sa është porositur', async () => {
    const res = await deliver(keeper.token, id, [{ lineNo: 1, qty: '4.32' }]); // kanë mbetur 2.88
    expect(res.body.code).toBe('OVER_DELIVERY');
  });

  it('dorëzimi i fundit e mbyll porosinë; pas kësaj asgjë nuk ndryshon', async () => {
    const res = await deliver(keeper.token, id, [{ lineNo: 1, qty: '2.88' }]);
    expect(res.body.status).toBe('DELIVERED');
    expect((await deliver(keeper.token, id, [{ lineNo: 1, qty: '1.44' }])).status).toBe(409);
    const r = await pool.query('SELECT qty FROM stock_reservation WHERE order_id = $1', [id]);
    expect(r.rows[0]?.qty).toBe('0.0000');
  });

  it('porosia e anuluar e liron mallin; porosia me dorëzime nuk anulohet', async () => {
    const o = (await order(seller.token, [{ sku: 'TEST-PLL-6060', lot: LOT_B, qty: '1.44' }])).body.id;
    await confirm(seller.token, o);
    expect((await bal('TEST-PLL-6060', 'L-02')).reserved).toBe('1.4400');
    expect((await http().post(`/api/sales/orders/${o}/cancel`).set(auth(seller.token)).send({ reason: 'Klienti u tërhoq' })).status).toBe(204);
    expect((await bal('TEST-PLL-6060', 'L-02')).reserved).toBe('0.0000');
    expect((await http().post(`/api/sales/orders/${id}/cancel`).set(auth(seller.token)).send({ reason: 'Tentativë pas dorëzimit' })).status).toBe(409);
  });

  it('rezervimet në gjendje përputhen gjithmonë me rreshtat e rezervimit', async () => {
    const r = await pool.query(
      `SELECT 1 FROM stock_balance b WHERE b.reserved <> (SELECT COALESCE(sum(r.qty), 0) FROM stock_reservation r
         WHERE r.warehouse_id = b.warehouse_id AND r.product_id = b.product_id AND COALESCE(r.lot_id, 0) = COALESCE(b.lot_id, 0))`);
    expect(r.rowCount).toBe(0);
  });
});

describe('Përjashtimet me aprovim', () => {
  it('zbritja mbi limitin e shitësit kërkon arsyetim dhe aprovim; stoku rezervohet vetëm pas aprovimit', async () => {
    const o = (await order(seller.token, [{ sku: 'TEST-PLL-6060', lot: LOT_B, qty: '1.44', discountPct: '12' }])).body.id;
    const noReason = await confirm(seller.token, o);
    expect(noReason.body.code).toBe('REASON_REQUIRED');
    const res = await confirm(seller.token, o, 'Klient i rregullt, sasi e madhe');
    expect(res.body).toMatchObject({ status: 'PENDING_APPROVAL', exceptions: ['DISCOUNT_OVER_LIMIT'] });
    expect((await bal('TEST-PLL-6060', 'L-02')).reserved).toBe('0.0000');
    const self = await http().post(`/api/approvals/${res.body.approvalRequestId}/decide`).set(auth(seller.token)).send({ decision: 'APPROVE' });
    expect(self.status).toBe(403);
    const dec = await http().post(`/api/approvals/${res.body.approvalRequestId}/decide`).set(auth(salesMgr.token)).send({ decision: 'APPROVE' });
    expect(dec.body.status).toBe('APPROVED');
    expect((await http().get(`/api/sales/orders/${o}`).set(auth(seller.token))).body.status).toBe('CONFIRMED');
    expect((await bal('TEST-PLL-6060', 'L-02')).reserved).toBe('1.4400');
  });

  it('çmimi i ndryshuar me dorë kërkon aprovim; refuzimi e kthen porosinë në ofertë', async () => {
    const o = (await order(seller.token, [{ sku: 'TEST-PLL-6060', lot: LOT_B, qty: '1.44', unitPrice: '9.00' }])).body.id;
    const res = await confirm(seller.token, o, 'Çmim i veçantë i kërkuar nga klienti');
    expect(res.body.exceptions).toEqual(['PRICE_OVERRIDE']);
    const dec = await http().post(`/api/approvals/${res.body.approvalRequestId}/decide`).set(auth(salesMgr.token)).send({ decision: 'REJECT', comment: 'Jo nën listë' });
    expect(dec.body.status).toBe('REJECTED');
    expect((await http().get(`/api/sales/orders/${o}`).set(auth(seller.token))).body.status).toBe('DRAFT');
  });

  it('përzierja e nuancave të të njëjtit produkt bllokohet pa aprovim', async () => {
    const o = (await order(seller.token, [{ sku: 'TEST-PLL-6060', lot: LOT_A, qty: '1.44' }, { sku: 'TEST-PLL-6060', lot: LOT_B, qty: '1.44' }])).body.id;
    const res = await confirm(seller.token, o);
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('SHADE_CALIBER_MIX');
    const withReason = await confirm(seller.token, o, 'Klienti e pranon përzierjen për dy dhoma të ndara');
    expect(withReason.body).toMatchObject({ status: 'PENDING_APPROVAL', exceptions: ['SHADE_CALIBER_MIX'] });
  });
});

describe('Lejet', () => {
  it('shitësi i Prishtinës nuk krijon dhe nuk sheh porosi të Prizrenit', async () => {
    expect((await order(sellerPr.token, [{ sku: 'TEST-WC-01', qty: '1' }])).status).toBe(403);
    const mine = await http().get('/api/sales/orders').set(auth(sellerPr.token));
    expect(mine.body).toEqual([]);
    const first = (await http().get('/api/sales/orders').set(auth(seller.token))).body[0];
    expect((await http().get(`/api/sales/orders/${first.id}`).set(auth(sellerPr.token))).status).toBe(403);
  });

  it('shitësi nuk vendos çmime liste as limit krediti', async () => {
    expect((await http().post('/api/sales/prices').set(auth(seller.token)).send({ sku: 'TEST-WC-01', validFrom: '2030-01-01', unitPrice: '1' })).status).toBe(403);
    const c = await http().post('/api/sales/customers').set(auth(seller.token)).send({ code: 'KL-TEST-2', name: 'Klient me kredi', kind: 'COMPANY', creditLimit: '5000' });
    expect(c.status).toBe(403);
    expect((await http().get('/api/sales/customers').set(auth(catalog.token))).status).toBe(403);
  });

  it('çmimi i vendosur nuk mbishkruhet; ndryshimi kërkon datë të re', async () => {
    const dup = await http().post('/api/sales/prices').set(auth(salesMgr.token)).send({ sku: 'TEST-WC-01', validFrom: '2020-01-01', unitPrice: '1' });
    expect(dup.status).toBe(409);
  });

  it('audit trail i ka veprimet e shitjes dhe zinxhiri është i paprekur', async () => {
    const a = await pool.query<{ action: string }>(`SELECT DISTINCT action FROM audit_log WHERE action LIKE 'sales.%' OR action IN ('customer.created', 'price.set')`);
    expect(a.rows.map((r) => r.action).sort()).toEqual(['customer.created', 'price.set', 'sales.order_cancelled', 'sales.order_confirmed', 'sales.order_delivered', 'sales.order_drafted']);
    expect((await pool.query<{ b: string | null }>('SELECT audit_log_verify() AS b')).rows[0]?.b).toBeNull();
    const pii = await pool.query(`SELECT 1 FROM audit_log WHERE strpos(details::text, 'Klient Testues') > 0`);
    expect(pii.rowCount).toBe(0);
  });
});
