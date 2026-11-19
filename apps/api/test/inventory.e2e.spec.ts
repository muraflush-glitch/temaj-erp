import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp, freshDatabase, userWithRole } from './helpers';

let pool: Pool;
let app: INestApplication;
let keeperPz: { id: number; token: string };
let keeperPr: { id: number; token: string };
let manager: { id: number; token: string };
let catalog: { id: number; token: string };
let WPZ: number; let WPR: number;
let seq = 0;
const key = () => `inv-test-${++seq}`;
const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const LOT_A = { lotCode: 'L-2030-01', shade: 'A12', caliber: '9' };
const LOT_B = { lotCode: 'L-2030-02', shade: 'B07', caliber: '9' };

beforeAll(async () => {
  pool = await freshDatabase();
  app = await createApp();
  const w = await pool.query<{ id: string; code: string }>('SELECT id, code FROM warehouse');
  WPZ = Number(w.rows.find((r) => r.code === 'PZ-MAIN')?.id); WPR = Number(w.rows.find((r) => r.code === 'PR-MAIN')?.id);
  keeperPz = await userWithRole(app, pool, 'magazinier.pz@temaj.test', 'WAREHOUSE_KEEPER', 'PZ');
  keeperPr = await userWithRole(app, pool, 'magazinier.pr@temaj.test', 'WAREHOUSE_KEEPER', 'PR');
  manager = await userWithRole(app, pool, 'menaxher.mag@temaj.test', 'WAREHOUSE_MANAGER', null, true);
  catalog = await userWithRole(app, pool, 'katalog@temaj.test', 'CATALOG_MANAGER', null);
});
afterAll(async () => { await app.close(); await pool.end(); });

const receive = (t: string, wh: number, sku: string, qty: string, lot?: object, k = key()) =>
  http().post('/api/inventory/receipts').set(auth(t)).send({ warehouseId: wh, sku, qty, lot, documentRef: 'FLETEHYRJE-TEST', idempotencyKey: k });
const dispatch = (t: string, wh: number, sku: string, qty: string, lot?: object) =>
  http().post('/api/inventory/dispatches').set(auth(t)).send({ warehouseId: wh, sku, qty, lot, documentRef: 'FLETEDALJE-TEST', idempotencyKey: key() });
const stock = async (t: string, wh: number) => (await http().get(`/api/inventory/warehouses/${wh}/stock`).set(auth(t))).body as
  { sku: string; lot_code: string | null; shade: string | null; on_hand: string; full_boxes: string | null; loose_pieces: string | null }[];
const onHand = async (t: string, wh: number, sku: string, lotCode?: string) =>
  (await stock(t, wh)).find((r) => r.sku === sku && (lotCode === undefined || r.lot_code === lotCode))?.on_hand ?? '0';

describe('Hyrjet dhe paketimi', () => {
  it('hyrja e pllakave me lot rrit stokun dhe shfaq kutitë', async () => {
    const res = await receive(keeperPz.token, WPZ, 'TEST-PLL-6060', '14.40', LOT_A); // 10 kuti × 1.44 m²
    expect(res.status).toBe(201);
    const s = await stock(keeperPz.token, WPZ);
    expect(s).toEqual([expect.objectContaining({ sku: 'TEST-PLL-6060', lot_code: 'L-2030-01', shade: 'A12', on_hand: '14.4000', full_boxes: '10', loose_pieces: '0' })]);
  });

  it('pllaka pa lot (nuancë/kalibër) refuzohet', async () => {
    const res = await receive(keeperPz.token, WPZ, 'TEST-PLL-6060', '1.44');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('LOT_REQUIRED');
  });

  it('sasia që nuk është kuti e plotë refuzohet për produktin pa kuti të hapura', async () => {
    const res = await receive(keeperPz.token, WPZ, 'TEST-PLL-6060', '1.00', LOT_A);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_QUANTITY_STEP');
    const piece = await dispatch(keeperPz.token, WPZ, 'TEST-PLL-6060', '0.36', LOT_A); // një copë
    expect(piece.body.code).toBe('INVALID_QUANTITY_STEP');
  });

  it('produkti me kuti të hapura lejon copë, por jo pjesë cope', async () => {
    expect((await receive(keeperPz.token, WPZ, 'TEST-PLL-3060', '1.62', LOT_A)).status).toBe(201); // 9 copë = 1 kuti + 1 copë
    const row = (await stock(keeperPz.token, WPZ)).find((r) => r.sku === 'TEST-PLL-3060');
    expect(row).toMatchObject({ on_hand: '1.6200', full_boxes: '1', loose_pieces: '1' });
    expect((await receive(keeperPz.token, WPZ, 'TEST-PLL-3060', '0.10', LOT_A)).body.code).toBe('INVALID_QUANTITY_STEP');
  });

  it('produkti me copë nuk pranon lot dhe as sasi me presje', async () => {
    expect((await receive(keeperPz.token, WPZ, 'TEST-WC-01', '5')).status).toBe(201);
    expect((await receive(keeperPz.token, WPZ, 'TEST-WC-01', '1', LOT_A)).body.code).toBe('LOT_NOT_ALLOWED');
    expect((await receive(keeperPz.token, WPZ, 'TEST-WC-01', '1.5')).body.code).toBe('INVALID_QUANTITY_STEP');
  });

  it('idempotenca: e njëjta hyrje e dërguar dy herë numërohet një herë', async () => {
    const before = await onHand(keeperPz.token, WPZ, 'TEST-WC-01');
    const a = await receive(keeperPz.token, WPZ, 'TEST-WC-01', '2', undefined, 'dup-receipt-01');
    const b = await receive(keeperPz.token, WPZ, 'TEST-WC-01', '2', undefined, 'dup-receipt-01');
    expect(b.body).toEqual({ id: a.body.id, created: false });
    expect(Number(await onHand(keeperPz.token, WPZ, 'TEST-WC-01'))).toBe(Number(before) + 2);
  });

  it('nuancat e ndryshme mbahen të ndara', async () => {
    await receive(keeperPz.token, WPZ, 'TEST-PLL-6060', '2.88', LOT_B);
    expect(await onHand(keeperPz.token, WPZ, 'TEST-PLL-6060', 'L-2030-01')).toBe('14.4000');
    expect(await onHand(keeperPz.token, WPZ, 'TEST-PLL-6060', 'L-2030-02')).toBe('2.8800');
  });
});

describe('Pa stok negativ', () => {
  it('dalja më e madhe se stoku refuzohet dhe stoku nuk ndryshon', async () => {
    const res = await dispatch(keeperPz.token, WPZ, 'TEST-PLL-6060', '4.32', LOT_B); // ka vetëm 2.88
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(keeperPz.token, WPZ, 'TEST-PLL-6060', 'L-2030-02')).toBe('2.8800');
  });

  it('stoku i një nuance nuk mbulon daljen e një nuance tjetër', async () => {
    const res = await dispatch(keeperPz.token, WPZ, 'TEST-PLL-6060', '1.44', { lotCode: 'L-2030-01', shade: 'Z99', caliber: '9' });
    expect(res.status).toBe(404);
  });

  it('20 dalje paralele mbi 7 copë: saktësisht 7 kalojnë, stoku përfundon zero', async () => {
    const start = Number(await onHand(keeperPz.token, WPZ, 'TEST-WC-01'));
    expect(start).toBe(7);
    const results = await Promise.all(Array.from({ length: 20 }, () => dispatch(keeperPz.token, WPZ, 'TEST-WC-01', '1')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(7);
    expect(results.filter((r) => r.body.code === 'INSUFFICIENT_STOCK')).toHaveLength(13);
    expect(await onHand(keeperPz.token, WPZ, 'TEST-WC-01')).toBe('0');
  });

  it('gjendja nuk ndryshohet drejtpërdrejt në databazë, vetëm përmes lëvizjeve', async () => {
    await expect(pool.query('UPDATE stock_balance SET on_hand = 999')).rejects.toThrow(/STOCK_BALANCE_ONLY_VIA_MOVEMENT/);
    await expect(pool.query('DELETE FROM stock_balance')).rejects.toThrow(/STOCK_BALANCE_ONLY_VIA_MOVEMENT/);
  });

  it('lëvizjet nuk ndryshohen dhe nuk fshihen', async () => {
    await expect(pool.query('UPDATE stock_movement SET qty = 1')).rejects.toThrow(/STOCK_MOVEMENT_IMMUTABLE/);
    await expect(pool.query('DELETE FROM stock_movement')).rejects.toThrow(/STOCK_MOVEMENT_IMMUTABLE/);
  });

  it('lëvizja pa dokument refuzohet', async () => {
    const res = await http().post('/api/inventory/receipts').set(auth(keeperPz.token)).send({ warehouseId: WPZ, sku: 'TEST-WC-01', qty: '1', documentRef: '', idempotencyKey: key() });
    expect(res.status).toBe(400);
  });

  it('gjendja është gjithmonë e barabartë me shumën e lëvizjeve', async () => {
    const r = await pool.query(
      `SELECT 1 FROM stock_balance b
        WHERE b.on_hand <> (SELECT COALESCE(sum(CASE WHEN m.type IN ('RECEIPT', 'ADJUSTMENT_IN', 'TRANSFER_IN') THEN m.qty ELSE -m.qty END), 0)
                              FROM stock_movement m WHERE m.warehouse_id = b.warehouse_id AND m.product_id = b.product_id AND COALESCE(m.lot_id, 0) = COALESCE(b.lot_id, 0))`);
    expect(r.rowCount).toBe(0);
  });

  it('paketimi i produktit me lëvizje nuk ndryshohet', async () => {
    await expect(pool.query(`UPDATE product SET pieces_per_box = 5 WHERE sku = 'TEST-PLL-6060'`)).rejects.toThrow(/PRODUCT_PACKAGING_LOCKED/);
  });
});

describe('Lejet sipas degës', () => {
  it('magazinieri i Prishtinës nuk prek dhe nuk sheh magazinën e Prizrenit', async () => {
    expect((await receive(keeperPr.token, WPZ, 'TEST-WC-01', '1')).status).toBe(403);
    expect((await dispatch(keeperPr.token, WPZ, 'TEST-WC-01', '1')).status).toBe(403);
    expect((await http().get(`/api/inventory/warehouses/${WPZ}/stock`).set(auth(keeperPr.token))).status).toBe(403);
  });

  it('vetëm menaxheri i katalogut krijon produkte; m² kërkon paketimin', async () => {
    const p = { sku: 'TEST-NEW-01', name: 'Produkt i ri (test)', baseUom: 'PIECE', allowPartialBox: false, tracksLot: false };
    expect((await http().post('/api/inventory/products').set(auth(keeperPz.token)).send(p)).status).toBe(403);
    expect((await http().post('/api/inventory/products').set(auth(catalog.token)).send(p)).status).toBe(201);
    const noPack = await http().post('/api/inventory/products').set(auth(catalog.token)).send({ sku: 'TEST-NEW-02', name: 'Pllakë pa paketim', baseUom: 'M2', allowPartialBox: false, tracksLot: true });
    expect(noPack.status).toBe(400);
  });
});

describe('Transferet mes degëve', () => {
  let transferId: number;

  it('dërgimi e ul stokun në Prizren; Prishtina nuk e sheh mallin derisa ta pranojë', async () => {
    const res = await http().post('/api/inventory/transfers').set(auth(keeperPz.token)).send({
      fromWarehouseId: WPZ, toWarehouseId: WPR, documentRef: 'TRANSFER-TEST-1', idempotencyKey: key(),
      lines: [{ sku: 'TEST-PLL-6060', lot: LOT_A, qty: '7.20' }] }); // 5 kuti
    expect(res.status).toBe(201);
    transferId = res.body.id;
    expect(await onHand(keeperPz.token, WPZ, 'TEST-PLL-6060', 'L-2030-01')).toBe('7.2000');
    expect(await stock(keeperPr.token, WPR)).toEqual([]);
    const list = await http().get('/api/inventory/transfers').set(auth(keeperPr.token));
    expect(list.body[0]).toMatchObject({ id: String(transferId), status: 'IN_TRANSIT', from_warehouse: 'PZ-MAIN', to_warehouse: 'PR-MAIN' });
  });

  it('dërguesi nuk e konfirmon dot vetë pranimin, as dikush nga dega dërguese', async () => {
    const res = await http().post(`/api/inventory/transfers/${transferId}/receive`).set(auth(keeperPz.token)).send({ lines: [{ lineNo: 1, qtyReceived: '7.20' }] });
    expect(res.status).toBe(403);
  });

  it('nuk pranohet më shumë se sa është dërguar', async () => {
    const res = await http().post(`/api/inventory/transfers/${transferId}/receive`).set(auth(keeperPr.token)).send({ lines: [{ lineNo: 1, qtyReceived: '8.64' }] });
    expect(res.body.code).toBe('RECEIVED_MORE_THAN_DISPATCHED');
  });

  it('pranimi i plotë nga dega pranuese e fut mallin në Prishtinë me të njëjtin lot', async () => {
    const res = await http().post(`/api/inventory/transfers/${transferId}/receive`).set(auth(keeperPr.token)).send({ lines: [{ lineNo: 1, qtyReceived: '7.20' }] });
    expect(res.body).toEqual({ status: 'RECEIVED' });
    expect((await stock(keeperPr.token, WPR))[0]).toMatchObject({ sku: 'TEST-PLL-6060', lot_code: 'L-2030-01', shade: 'A12', on_hand: '7.2000' });
  });

  it('pranimi i dytë refuzohet', async () => {
    const res = await http().post(`/api/inventory/transfers/${transferId}/receive`).set(auth(keeperPr.token)).send({ lines: [{ lineNo: 1, qtyReceived: '7.20' }] });
    expect(res.status).toBe(409);
  });

  it('transferi me më shumë se stoku refuzohet i tëri', async () => {
    const res = await http().post('/api/inventory/transfers').set(auth(keeperPz.token)).send({
      fromWarehouseId: WPZ, toWarehouseId: WPR, documentRef: 'TRANSFER-TEST-2', idempotencyKey: key(),
      lines: [{ sku: 'TEST-PLL-6060', lot: LOT_B, qty: '1.44' }, { sku: 'TEST-PLL-6060', lot: LOT_A, qty: '72.00' }] });
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(keeperPz.token, WPZ, 'TEST-PLL-6060', 'L-2030-02')).toBe('2.8800'); // rreshti i parë u kthye mbrapsht
  });

  it('pranimi me mungesë shënohet si diferencë për hetim; mungesa nuk hyn askund', async () => {
    const t = await http().post('/api/inventory/transfers').set(auth(keeperPz.token)).send({
      fromWarehouseId: WPZ, toWarehouseId: WPR, documentRef: 'TRANSFER-TEST-3', idempotencyKey: key(),
      lines: [{ sku: 'TEST-PLL-6060', lot: LOT_B, qty: '2.88' }] });
    const res = await http().post(`/api/inventory/transfers/${t.body.id}/receive`).set(auth(keeperPr.token)).send({ lines: [{ lineNo: 1, qtyReceived: '1.44' }] });
    expect(res.body).toEqual({ status: 'DISCREPANCY' });
    expect(await onHand(keeperPr.token, WPR, 'TEST-PLL-6060', 'L-2030-02')).toBe('1.4400');
    expect(await onHand(keeperPz.token, WPZ, 'TEST-PLL-6060', 'L-2030-02')).toBe('0');
    const missing = await pool.query<{ q: string }>(`SELECT (qty_dispatched - qty_received)::text AS q FROM stock_transfer_line WHERE transfer_id = $1`, [t.body.id]);
    expect(missing.rows[0]?.q).toBe('1.4400');
  });
});

describe('Korrigjimet e stokut me aprovim', () => {
  it('magazinieri vetëm kërkon; stoku ndryshon pasi aprovon menaxheri me 2FA', async () => {
    const before = await onHand(keeperPz.token, WPZ, 'TEST-PLL-3060');
    const lot = await pool.query<{ id: string }>(`SELECT l.id FROM stock_lot l JOIN product p ON p.id = l.product_id WHERE p.sku = 'TEST-PLL-3060'`);
    const req = await http().post('/api/inventory/adjustment-requests').set(auth(keeperPz.token)).send({
      warehouseId: WPZ, sku: 'TEST-PLL-3060', lotId: Number(lot.rows[0]?.id), direction: 'OUT', qty: '0.18', reason: 'Një copë e thyer gjatë inventarit', idempotencyKey: key() });
    expect(req.status).toBe(201);
    expect(await onHand(keeperPz.token, WPZ, 'TEST-PLL-3060')).toBe(before);
    const dec = await http().post(`/api/approvals/${req.body.id}/decide`).set(auth(manager.token)).send({ decision: 'APPROVE' });
    expect(dec.body.status).toBe('APPROVED');
    expect(await onHand(keeperPz.token, WPZ, 'TEST-PLL-3060')).toBe('1.4400');
  });

  it('korrigjimi që do ta bënte stokun negativ dështon edhe pas aprovimit', async () => {
    const req = await http().post('/api/inventory/adjustment-requests').set(auth(keeperPz.token)).send({
      warehouseId: WPZ, sku: 'TEST-WC-01', direction: 'OUT', qty: '3', reason: 'Korrigjim i pamundur', idempotencyKey: key() });
    const dec = await http().post(`/api/approvals/${req.body.id}/decide`).set(auth(manager.token)).send({ decision: 'APPROVE' });
    expect(dec.body.code).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(keeperPz.token, WPZ, 'TEST-WC-01')).toBe('0');
  });

  it('audit trail i ka veprimet e stokut dhe zinxhiri është i paprekur', async () => {
    const a = await pool.query<{ action: string }>(`SELECT DISTINCT action FROM audit_log WHERE action LIKE 'stock.%' OR action LIKE 'product.%'`);
    expect(a.rows.map((r) => r.action).sort()).toEqual(['product.created', 'stock.adjusted', 'stock.dispatched', 'stock.received', 'stock.transfer_discrepancy', 'stock.transfer_dispatched', 'stock.transfer_received']);
    expect((await pool.query<{ b: string | null }>('SELECT audit_log_verify() AS b')).rows[0]?.b).toBeNull();
  });
});
