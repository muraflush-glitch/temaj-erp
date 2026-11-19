import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from '../auth/permission.service';
import { DomainError, forbidden, notFound } from '../common/errors';
import { AuthUser } from '../common/request';
import { DB } from '../database/database.module';
import { Db, one, Tx, withTransaction } from '../database/db';

export const STOCK_ADJUST = 'stock.adjust';
const QTY = /^\d{1,15}(\.\d{1,4})?$/;

export interface LotInput { lotCode: string; shade?: string; caliber?: string }
export interface MoveInput { warehouseId: number; sku: string; lot?: LotInput; qty: string; documentRef: string; idempotencyKey: string }
export interface ProductInput { sku: string; name: string; baseUom: 'M2' | 'PIECE'; piecesPerBox?: number; m2PerPiece?: string; allowPartialBox: boolean; tracksLot: boolean }

/**
 * Stoku fizik (vetëm sasi). Sasitë janë string dhjetorë në njësinë bazë të produktit.
 * Mbrojtjet kryesore (pa stok negativ, paketimi, loti, pandryshueshmëria) janë në databazë (migrimi 004).
 */
@Injectable()
export class InventoryService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly perms: PermissionService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    // Korrigjimet e stokut (inventarizim, dëmtime) kalojnë gjithmonë përmes aprovimit.
    this.approvals.register(STOCK_ADJUST, {
      requestPermission: 'stock.adjust.request',
      validate: async (tx, payload, branchId) => {
        const wh = await this.warehouse(tx, Number(payload['warehouseId']));
        if (wh.branchId !== branchId) throw new DomainError('VALIDATION', 'Magazina nuk i përket kësaj dege');
        const p = await this.product(tx, String(payload['sku']));
        if (p.tracksLot && payload['lotId'] == null) throw new DomainError('LOT_REQUIRED', 'Ky produkt kërkon lot (nuancë/kalibër)', 422);
      },
      execute: async (tx, req) => {
        const pl = req.payload;
        const p = await this.product(tx, String(pl['sku']));
        const type = pl['direction'] === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
        await tx.query(
          `INSERT INTO stock_movement(type, warehouse_id, product_id, lot_id, qty, document_ref, reason, created_by, idempotency_key)
           VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9)`,
          [type, Number(pl['warehouseId']), p.id, pl['lotId'] ?? null, String(pl['qty']), `APROVIM-${req.id}`, req.reason, req.requested_by, `approval:${req.id}`]);
        await this.audit.record(tx, { actorUserId: Number(req.requested_by), action: 'stock.adjusted', entityType: 'product', entityId: p.id,
          branchId: req.branch_id == null ? null : Number(req.branch_id), details: { type, qty: pl['qty'], warehouseId: pl['warehouseId'], approvalRequestId: Number(req.id) } });
      },
    });
  }

  private async warehouse(q: Db | Tx, id: number): Promise<{ id: number; branchId: number }> {
    const w = await one<{ id: string; branch_id: string }>(q, 'SELECT id, branch_id FROM warehouse WHERE id = $1 AND is_active', [id]);
    if (!w) throw notFound('Magazina');
    return { id: Number(w.id), branchId: Number(w.branch_id) };
  }

  private async product(q: Db | Tx, sku: string): Promise<{ id: number; tracksLot: boolean }> {
    const p = await one<{ id: string; tracks_lot: boolean }>(q, 'SELECT id, tracks_lot FROM product WHERE sku = $1', [sku]);
    if (!p) throw notFound(`Produkti ${sku}`);
    return { id: Number(p.id), tracksLot: p.tracks_lot };
  }

  private qty(v: string): string {
    if (!QTY.test(v) || /^0+(\.0+)?$/.test(v)) throw new DomainError('VALIDATION', 'Sasia duhet të jetë numër dhjetor pozitiv');
    return v;
  }

  private async lotId(tx: Tx, productId: number, tracksLot: boolean, lot: LotInput | undefined, create: boolean): Promise<number | null> {
    if (!tracksLot) {
      if (lot) throw new DomainError('LOT_NOT_ALLOWED', 'Ky produkt nuk ndiqet me lot', 422);
      return null;
    }
    if (!lot) throw new DomainError('LOT_REQUIRED', 'Ky produkt kërkon lot (nuancë/kalibër)', 422);
    const args = [productId, lot.lotCode, lot.shade ?? '', lot.caliber ?? ''];
    if (create) {
      await tx.query('INSERT INTO stock_lot(product_id, lot_code, shade, caliber) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', args);
    }
    const r = await one<{ id: string }>(tx, 'SELECT id FROM stock_lot WHERE product_id = $1 AND lot_code = $2 AND shade = $3 AND caliber = $4', args);
    if (!r) throw notFound('Loti');
    return Number(r.id);
  }

  async createProduct(actor: AuthUser, input: ProductInput): Promise<{ id: number }> {
    if (!(await this.perms.has(actor.id, 'catalog.manage', 'global'))) throw forbidden();
    if (input.baseUom === 'M2' && (!input.m2PerPiece || !input.piecesPerBox)) {
      throw new DomainError('VALIDATION', 'Produktet në m² kërkojnë m² për copë dhe copë për kuti, sipas paketimit real');
    }
    return withTransaction(this.db, async (tx) => {
      const r = await one<{ id: string }>(tx,
        `INSERT INTO product(sku, name, base_uom, pieces_per_box, m2_per_piece, allow_partial_box, tracks_lot)
         VALUES ($1, $2, $3, $4, $5::numeric, $6, $7) RETURNING id`,
        [input.sku, input.name, input.baseUom, input.piecesPerBox ?? null, input.m2PerPiece ?? null, input.allowPartialBox, input.tracksLot]);
      const id = Number(r?.id);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'product.created', entityType: 'product', entityId: id, details: { sku: input.sku } });
      return { id };
    });
  }

  private async move(actor: AuthUser, type: 'RECEIPT' | 'DISPATCH', permission: string, input: MoveInput): Promise<{ id: number; created: boolean }> {
    const qty = this.qty(input.qty);
    return withTransaction(this.db, async (tx) => {
      const dup = await one<{ id: string }>(tx, 'SELECT id FROM stock_movement WHERE created_by = $1 AND idempotency_key = $2', [actor.id, input.idempotencyKey]);
      if (dup) return { id: Number(dup.id), created: false };
      const wh = await this.warehouse(tx, input.warehouseId);
      if (!(await this.perms.has(actor.id, permission, wh.branchId, tx))) throw forbidden();
      const p = await this.product(tx, input.sku);
      const lotId = await this.lotId(tx, p.id, p.tracksLot, input.lot, type === 'RECEIPT');
      const r = await one<{ id: string }>(tx,
        `INSERT INTO stock_movement(type, warehouse_id, product_id, lot_id, qty, document_ref, created_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8) RETURNING id`,
        [type, wh.id, p.id, lotId, qty, input.documentRef, actor.id, input.idempotencyKey]);
      const id = Number(r?.id);
      await this.audit.record(tx, { actorUserId: actor.id, action: type === 'RECEIPT' ? 'stock.received' : 'stock.dispatched', entityType: 'stock_movement',
        entityId: id, branchId: wh.branchId, details: { sku: input.sku, qty, documentRef: input.documentRef } });
      return { id, created: true };
    });
  }

  receive(actor: AuthUser, input: MoveInput) { return this.move(actor, 'RECEIPT', 'stock.receive', input); }
  /** Stoku fizik ulet në momentin e daljes reale, me dokument. */
  dispatch(actor: AuthUser, input: MoveInput) { return this.move(actor, 'DISPATCH', 'stock.dispatch', input); }

  async requestAdjustment(actor: AuthUser, input: { warehouseId: number; sku: string; lotId?: number; direction: 'IN' | 'OUT'; qty: string; reason: string; idempotencyKey: string }) {
    const wh = await this.warehouse(this.db, input.warehouseId);
    return this.approvals.request(actor, {
      actionCode: STOCK_ADJUST, branchId: wh.branchId, amount: '0', reason: input.reason, idempotencyKey: input.idempotencyKey,
      payload: { warehouseId: input.warehouseId, sku: input.sku, lotId: input.lotId ?? null, direction: input.direction, qty: this.qty(input.qty) },
    });
  }

  /** Dega dërguese: malli del nga magazina dhe kalon "në rrugë". */
  async transferDispatch(actor: AuthUser, input: { fromWarehouseId: number; toWarehouseId: number; documentRef: string; idempotencyKey: string; lines: { sku: string; lot?: LotInput; qty: string }[] }): Promise<{ id: number; created: boolean }> {
    return withTransaction(this.db, async (tx) => {
      const dup = await one<{ id: string }>(tx, 'SELECT id FROM stock_transfer WHERE dispatched_by = $1 AND idempotency_key = $2', [actor.id, input.idempotencyKey]);
      if (dup) return { id: Number(dup.id), created: false };
      const from = await this.warehouse(tx, input.fromWarehouseId);
      await this.warehouse(tx, input.toWarehouseId);
      if (!(await this.perms.has(actor.id, 'stock.transfer.dispatch', from.branchId, tx))) throw forbidden();
      const t = await one<{ id: string }>(tx,
        `INSERT INTO stock_transfer(from_warehouse_id, to_warehouse_id, document_ref, dispatched_by, idempotency_key) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [input.fromWarehouseId, input.toWarehouseId, input.documentRef, actor.id, input.idempotencyKey]);
      const id = Number(t?.id);
      let no = 0;
      for (const l of input.lines) {
        const qty = this.qty(l.qty);
        const p = await this.product(tx, l.sku);
        const lotId = await this.lotId(tx, p.id, p.tracksLot, l.lot, false);
        no++;
        await tx.query('INSERT INTO stock_transfer_line(transfer_id, line_no, product_id, lot_id, qty_dispatched) VALUES ($1, $2, $3, $4, $5::numeric)', [id, no, p.id, lotId, qty]);
        await tx.query(
          `INSERT INTO stock_movement(type, warehouse_id, product_id, lot_id, qty, document_ref, transfer_id, created_by, idempotency_key)
           VALUES ('TRANSFER_OUT', $1, $2, $3, $4::numeric, $5, $6, $7, $8)`,
          [from.id, p.id, lotId, qty, input.documentRef, id, actor.id, `transfer:${id}:out:${no}`]);
      }
      await this.audit.record(tx, { actorUserId: actor.id, action: 'stock.transfer_dispatched', entityType: 'stock_transfer', entityId: id, branchId: from.branchId, details: { lines: no, documentRef: input.documentRef } });
      return { id, created: true };
    });
  }

  /** Dega pranuese konfirmon sasitë e ardhura. Diferenca nuk humbet në heshtje: transferi shënohet për hetim. */
  async transferReceive(actor: AuthUser, transferId: number, lines: { lineNo: number; qtyReceived: string }[]): Promise<{ status: string }> {
    return withTransaction(this.db, async (tx) => {
      const t = await one<{ status: string; to_warehouse_id: string; dispatched_by: string; document_ref: string }>(tx,
        'SELECT status, to_warehouse_id, dispatched_by, document_ref FROM stock_transfer WHERE id = $1 FOR UPDATE', [transferId]);
      if (!t) throw notFound('Transferi');
      if (t.status !== 'IN_TRANSIT') throw new DomainError('TRANSFER_NOT_IN_TRANSIT', 'Transferi është pranuar tashmë', 409);
      if (Number(t.dispatched_by) === actor.id) throw new DomainError('SAME_PARTY', 'Pranimin duhet ta konfirmojë një person tjetër nga dërguesi', 403);
      const to = await this.warehouse(tx, Number(t.to_warehouse_id));
      if (!(await this.perms.has(actor.id, 'stock.transfer.receive', to.branchId, tx))) throw forbidden();
      const tl = await tx.query<{ line_no: number; product_id: string; lot_id: string | null; qty_dispatched: string }>(
        'SELECT line_no, product_id, lot_id, qty_dispatched::text FROM stock_transfer_line WHERE transfer_id = $1 ORDER BY line_no', [transferId]);
      const got = new Map(lines.map((l) => [l.lineNo, l.qtyReceived]));
      if (got.size !== tl.rows.length || tl.rows.some((r) => !got.has(r.line_no))) throw new DomainError('VALIDATION', 'Duhet të konfirmoni çdo rresht të transferit');
      let discrepancy = false;
      for (const r of tl.rows) {
        const q = got.get(r.line_no) as string;
        if (!QTY.test(q)) throw new DomainError('VALIDATION', 'Sasi e pavlefshme');
        const cmp = await one<{ more: boolean; less: boolean; zero: boolean }>(tx,
          'SELECT $1::numeric > $2::numeric AS more, $1::numeric < $2::numeric AS less, $1::numeric = 0 AS zero', [q, r.qty_dispatched]);
        if (cmp?.more) throw new DomainError('RECEIVED_MORE_THAN_DISPATCHED', 'Sasia e pranuar nuk mund të jetë më e madhe se e dërguara', 422);
        if (cmp?.less) discrepancy = true;
        await tx.query('UPDATE stock_transfer_line SET qty_received = $3::numeric WHERE transfer_id = $1 AND line_no = $2', [transferId, r.line_no, q]);
        if (!cmp?.zero) {
          await tx.query(
            `INSERT INTO stock_movement(type, warehouse_id, product_id, lot_id, qty, document_ref, transfer_id, created_by, idempotency_key)
             VALUES ('TRANSFER_IN', $1, $2, $3, $4::numeric, $5, $6, $7, $8)`,
            [to.id, r.product_id, r.lot_id, q, t.document_ref, transferId, actor.id, `transfer:${transferId}:in:${r.line_no}`]);
        }
      }
      const status = discrepancy ? 'DISCREPANCY' : 'RECEIVED';
      await tx.query('UPDATE stock_transfer SET status = $2, received_by = $3, received_at = now() WHERE id = $1', [transferId, status, actor.id]);
      await this.audit.record(tx, { actorUserId: actor.id, action: discrepancy ? 'stock.transfer_discrepancy' : 'stock.transfer_received',
        entityType: 'stock_transfer', entityId: transferId, branchId: to.branchId, details: { status } });
      return { status };
    });
  }

  /** Gjendja sipas magazinës, me shndërrim në kuti dhe copë sipas paketimit të produktit. */
  async balances(actor: AuthUser, warehouseId: number) {
    const wh = await this.warehouse(this.db, warehouseId);
    if (!(await this.perms.has(actor.id, 'stock.read', wh.branchId))) throw forbidden();
    const res = await this.db.query(
      `SELECT p.sku, p.name, p.base_uom, l.lot_code, l.shade, l.caliber, b.on_hand::text,
              CASE WHEN p.base_uom = 'M2' THEN trunc(b.on_hand / (p.m2_per_piece * p.pieces_per_box))
                   WHEN p.pieces_per_box IS NOT NULL THEN trunc(b.on_hand / p.pieces_per_box) END::text AS full_boxes,
              CASE WHEN p.base_uom = 'M2' THEN round(mod(b.on_hand, p.m2_per_piece * p.pieces_per_box) / p.m2_per_piece)
                   WHEN p.pieces_per_box IS NOT NULL THEN mod(b.on_hand, p.pieces_per_box) END::text AS loose_pieces
         FROM stock_balance b JOIN product p ON p.id = b.product_id LEFT JOIN stock_lot l ON l.id = b.lot_id
        WHERE b.warehouse_id = $1 AND b.on_hand > 0 ORDER BY p.sku, l.lot_code, l.shade, l.caliber`, [warehouseId]);
    return res.rows;
  }

  async transfers(actor: AuthUser) {
    if (!(await this.perms.has(actor.id, 'stock.read', 'any'))) throw forbidden();
    const res = await this.db.query(
      `SELECT t.id, t.status, t.document_ref, t.dispatched_at, t.received_at, wf.code AS from_warehouse, wt.code AS to_warehouse,
              (SELECT json_agg(json_build_object('lineNo', l.line_no, 'sku', p.sku, 'qtyDispatched', l.qty_dispatched::text, 'qtyReceived', l.qty_received::text) ORDER BY l.line_no)
                 FROM stock_transfer_line l JOIN product p ON p.id = l.product_id WHERE l.transfer_id = t.id) AS lines
         FROM stock_transfer t JOIN warehouse wf ON wf.id = t.from_warehouse_id JOIN warehouse wt ON wt.id = t.to_warehouse_id
        WHERE EXISTS (SELECT 1 FROM user_role ur JOIN role_permission rp ON rp.role_id = ur.role_id AND rp.permission_code = 'stock.read'
                       WHERE ur.user_id = $1 AND ur.revoked_at IS NULL AND (ur.valid_until IS NULL OR ur.valid_until > now())
                         AND (ur.branch_id IS NULL OR ur.branch_id IN (wf.branch_id, wt.branch_id)))
        ORDER BY t.id DESC LIMIT 200`, [actor.id]);
    return res.rows;
  }

  async products(actor: AuthUser) {
    if (!(await this.perms.has(actor.id, 'stock.read', 'any'))) throw forbidden();
    const res = await this.db.query(
      `SELECT sku, name, base_uom, pieces_per_box, m2_per_piece::text, allow_partial_box, tracks_lot, is_active, product_qty_step(product)::text AS qty_step FROM product ORDER BY sku`);
    return res.rows;
  }
}
