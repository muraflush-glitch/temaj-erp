import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from '../auth/permission.service';
import { DomainError, forbidden, notFound } from '../common/errors';
import { AuthUser } from '../common/request';
import { DB } from '../database/database.module';
import { Db, one, Tx, withTransaction } from '../database/db';

export const APPROVE_PO = 'purchase.approve_po';
const NUM = /^\d{1,15}(\.\d{1,4})?$/;
const positive = (s: string): boolean => NUM.test(s) && !/^0+(\.0+)?$/.test(s);

/**
 * Blerjet (prototip): porosi blerjeje me aprovim mbi prag → pranime të pjesshme që hyjnë në stok →
 * fatura e furnitorit me përputhje tripalëshe. Pa pagesa, pa kosto importi, pa kontabilizim.
 */
@Injectable()
export class PurchasingService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly perms: PermissionService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    this.approvals.register(APPROVE_PO, {
      requestPermission: 'purchase.order.create',
      execute: async (tx, req) => {
        const poId = Number(req.payload['poId']);
        const r = await tx.query(`UPDATE purchase_order SET status = 'APPROVED', approved_at = now() WHERE id = $1 AND status = 'PENDING_APPROVAL'`, [poId]);
        if (!r.rowCount) throw new DomainError('ORDER_STATE', 'Porosia e blerjes nuk është në pritje të aprovimit', 409);
        await this.audit.record(tx, { actorUserId: Number(req.requested_by), action: 'purchase.order_approved', entityType: 'purchase_order', entityId: poId,
          branchId: req.branch_id == null ? null : Number(req.branch_id), details: { approvalRequestId: Number(req.id) } });
      },
      onClosedWithoutApproval: async (tx, req) => {
        await tx.query(`UPDATE purchase_order SET status = 'DRAFT' WHERE id = $1 AND status = 'PENDING_APPROVAL'`, [Number(req.payload['poId'])]);
      },
    });
  }

  private async can(q: Db | Tx, userId: number, permission: string, branchId: number): Promise<void> {
    if (!(await this.perms.has(userId, permission, branchId, q))) throw forbidden();
  }

  async createSupplier(actor: AuthUser, input: { code: string; name: string; country?: string }): Promise<{ id: number }> {
    if (!(await this.perms.has(actor.id, 'suppliers.manage', 'any'))) throw forbidden();
    return withTransaction(this.db, async (tx) => {
      const r = await one<{ id: string }>(tx, 'INSERT INTO supplier(code, name, country, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [input.code, input.name, input.country ?? null, actor.id]);
      const id = Number(r?.id);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'supplier.created', entityType: 'supplier', entityId: id, details: { code: input.code } });
      return { id };
    });
  }

  async suppliers(actor: AuthUser) {
    if (!(await this.perms.has(actor.id, 'purchase.read', 'any'))) throw forbidden();
    return (await this.db.query('SELECT id, code, name, country, is_active FROM supplier ORDER BY name')).rows;
  }

  async createOrder(actor: AuthUser, input: { branchId: number; warehouseId: number; supplierId: number; note?: string; idempotencyKey: string; lines: { sku: string; qty: string; unitCost: string }[] }): Promise<{ id: number; created: boolean }> {
    return withTransaction(this.db, async (tx) => {
      const dup = await one<{ id: string }>(tx, 'SELECT id FROM purchase_order WHERE created_by = $1 AND idempotency_key = $2', [actor.id, input.idempotencyKey]);
      if (dup) return { id: Number(dup.id), created: false };
      await this.can(tx, actor.id, 'purchase.order.create', input.branchId);
      if (!(await one(tx, 'SELECT 1 FROM warehouse WHERE id = $1 AND branch_id = $2 AND is_active', [input.warehouseId, input.branchId]))) throw new DomainError('VALIDATION', 'Magazina nuk i përket kësaj dege');
      if (!(await one(tx, 'SELECT 1 FROM supplier WHERE id = $1 AND is_active', [input.supplierId]))) throw notFound('Furnitori');
      const o = await one<{ id: string }>(tx,
        'INSERT INTO purchase_order(branch_id, warehouse_id, supplier_id, note, created_by, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [input.branchId, input.warehouseId, input.supplierId, input.note ?? null, actor.id, input.idempotencyKey]);
      const id = Number(o?.id);
      let no = 0;
      for (const l of input.lines) {
        if (!positive(l.qty) || !NUM.test(l.unitCost)) throw new DomainError('VALIDATION', 'Sasia dhe kostoja duhet të jenë numra dhjetorë');
        const p = await one<{ id: string; step_ok: boolean }>(tx,
          `SELECT p.id, (product_qty_step(p) IS NULL OR mod($2::numeric, product_qty_step(p)) = 0) AS step_ok FROM product p WHERE p.sku = $1 AND p.is_active`, [l.sku, l.qty]);
        if (!p) throw notFound(`Produkti ${l.sku}`);
        if (!p.step_ok) throw new DomainError('INVALID_QUANTITY_STEP', `Sasia e ${l.sku} nuk përputhet me paketimin`, 422);
        await tx.query('INSERT INTO purchase_order_line(po_id, line_no, product_id, qty, unit_cost) VALUES ($1, $2, $3, $4::numeric, $5::numeric)', [id, ++no, p.id, l.qty, l.unitCost]);
      }
      await this.audit.record(tx, { actorUserId: actor.id, action: 'purchase.order_drafted', entityType: 'purchase_order', entityId: id, branchId: input.branchId, details: { lines: no } });
      return { id, created: true };
    });
  }

  private async total(q: Db | Tx, poId: number): Promise<string> {
    const r = await one<{ t: string }>(q, 'SELECT COALESCE(sum(round(qty * unit_cost, 4)), 0)::text AS t FROM purchase_order_line WHERE po_id = $1', [poId]);
    return r?.t ?? '0';
  }

  /** Dërgimi: nën pragun e politikës aprovohet menjëherë; mbi prag kalon te aprovuesi (DEC-G50-01). */
  async submit(actor: AuthUser, poId: number, reason?: string): Promise<{ status: string; approvalRequestId?: number }> {
    return withTransaction(this.db, async (tx) => {
      const o = await one<{ status: string; branch_id: string }>(tx, 'SELECT status, branch_id FROM purchase_order WHERE id = $1 FOR UPDATE', [poId]);
      if (!o) throw notFound('Porosia e blerjes');
      if (o.status !== 'DRAFT') throw new DomainError('ORDER_STATE', 'Vetëm drafti mund të dërgohet', 409);
      const branchId = Number(o.branch_id);
      await this.can(tx, actor.id, 'purchase.order.create', branchId);
      const total = await this.total(tx, poId);
      if (!(await this.approvals.policyApplies(tx, APPROVE_PO, total, branchId))) {
        await tx.query(`UPDATE purchase_order SET status = 'APPROVED', approved_at = now() WHERE id = $1`, [poId]);
        await this.audit.record(tx, { actorUserId: actor.id, action: 'purchase.order_approved', entityType: 'purchase_order', entityId: poId, branchId, details: { belowThreshold: true, total } });
        return { status: 'APPROVED' };
      }
      if (!reason || reason.trim().length < 5) throw new DomainError('REASON_REQUIRED', 'Porosia kalon pragun e aprovimit; duhet arsyetim', 422);
      const req = await this.approvals.requestInTx(tx, actor, { actionCode: APPROVE_PO, branchId, amount: total, reason, idempotencyKey: `po:${poId}:${Date.now()}`, payload: { poId } });
      await tx.query(`UPDATE purchase_order SET status = 'PENDING_APPROVAL', approval_request_id = $2 WHERE id = $1`, [poId, req.id]);
      return { status: 'PENDING_APPROVAL', approvalRequestId: req.id };
    });
  }

  /** Pranimi i mallit kundrejt porosisë: hyn në stok me lot dhe dokument; i pjesshëm lejohet, mbi porosinë jo. */
  async receive(actor: AuthUser, poId: number, input: { documentRef: string; idempotencyKey: string; lines: { lineNo: number; qty: string; lot?: { lotCode: string; shade?: string; caliber?: string } }[] }): Promise<{ id: number; status: string; created: boolean }> {
    return withTransaction(this.db, async (tx) => {
      const o = await one<{ status: string; branch_id: string; warehouse_id: string }>(tx, 'SELECT status, branch_id, warehouse_id FROM purchase_order WHERE id = $1 FOR UPDATE', [poId]);
      if (!o) throw notFound('Porosia e blerjes');
      const dup = await one<{ id: string }>(tx, 'SELECT id FROM goods_receipt WHERE received_by = $1 AND idempotency_key = $2', [actor.id, input.idempotencyKey]);
      if (dup) return { id: Number(dup.id), status: o.status, created: false };
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(o.status)) throw new DomainError('ORDER_STATE', 'Malli pranohet vetëm për porosi të aprovuara', 409);
      const branchId = Number(o.branch_id);
      await this.can(tx, actor.id, 'stock.receive', branchId);
      const g = await one<{ id: string }>(tx, 'INSERT INTO goods_receipt(po_id, document_ref, received_by, idempotency_key) VALUES ($1, $2, $3, $4) RETURNING id', [poId, input.documentRef, actor.id, input.idempotencyKey]);
      const receiptId = Number(g?.id);
      let n = 0;
      for (const l of input.lines) {
        if (!positive(l.qty)) throw new DomainError('VALIDATION', 'Sasia duhet të jetë numër dhjetor pozitiv');
        const line = await one<{ product_id: string; tracks_lot: boolean; ok: boolean }>(tx,
          `SELECT l.product_id, p.tracks_lot, (l.qty - l.qty_received >= $3::numeric) AS ok
             FROM purchase_order_line l JOIN product p ON p.id = l.product_id WHERE l.po_id = $1 AND l.line_no = $2`, [poId, l.lineNo, l.qty]);
        if (!line) throw notFound(`Rreshti ${l.lineNo}`);
        if (!line.ok) throw new DomainError('OVER_RECEIPT', 'Sasia e pranuar nuk mund ta kalojë sasinë e porositur', 422);
        let lotId: string | null = null;
        if (line.tracks_lot) {
          if (!l.lot) throw new DomainError('LOT_REQUIRED', 'Ky produkt kërkon lot (nuancë/kalibër) në pranim', 422);
          const args = [line.product_id, l.lot.lotCode, l.lot.shade ?? '', l.lot.caliber ?? ''];
          await tx.query('INSERT INTO stock_lot(product_id, lot_code, shade, caliber) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', args);
          lotId = (await one<{ id: string }>(tx, 'SELECT id FROM stock_lot WHERE product_id = $1 AND lot_code = $2 AND shade = $3 AND caliber = $4', args))?.id ?? null;
        } else if (l.lot) throw new DomainError('LOT_NOT_ALLOWED', 'Ky produkt nuk ndiqet me lot', 422);
        const m = await one<{ id: string }>(tx,
          `INSERT INTO stock_movement(type, warehouse_id, product_id, lot_id, qty, document_ref, reason, created_by, idempotency_key)
           VALUES ('RECEIPT', $1, $2, $3, $4::numeric, $5, $6, $7, $8) RETURNING id`,
          [o.warehouse_id, line.product_id, lotId, l.qty, input.documentRef, `Porosia e blerjes #${poId}`, actor.id, `gr:${receiptId}:${++n}`]);
        await tx.query('INSERT INTO goods_receipt_line(receipt_id, po_line_no, lot_id, qty, movement_id) VALUES ($1, $2, $3, $4::numeric, $5)', [receiptId, l.lineNo, lotId, l.qty, m?.id]);
        await tx.query('UPDATE purchase_order_line SET qty_received = qty_received + $3::numeric WHERE po_id = $1 AND line_no = $2', [poId, l.lineNo, l.qty]);
      }
      const open = await one<{ n: string }>(tx, 'SELECT count(*) AS n FROM purchase_order_line WHERE po_id = $1 AND qty_received < qty', [poId]);
      const status = Number(open?.n) === 0 ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      await tx.query('UPDATE purchase_order SET status = $2 WHERE id = $1', [poId, status]);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'purchase.goods_received', entityType: 'purchase_order', entityId: poId, branchId, details: { receiptId, status, documentRef: input.documentRef } });
      return { id: receiptId, status, created: true };
    });
  }

  /**
   * Fatura e furnitorit me përputhje tripalëshe. Fatura që përputhet shënohet MATCHED dhe rrit sasinë e faturuar;
   * ajo që nuk përputhet ruhet si DISCREPANCY (e bllokuar) me listën e mospërputhjeve, pa prekur porosinë.
   */
  async enterInvoice(actor: AuthUser, poId: number, input: { invoiceNo: string; invoiceDate: string; lines: { lineNo: number; qty: string; unitCost: string }[] }): Promise<{ id: number; status: string; discrepancies: object[] }> {
    return withTransaction(this.db, async (tx) => {
      const o = await one<{ branch_id: string; supplier_id: string; status: string }>(tx, 'SELECT branch_id, supplier_id, status FROM purchase_order WHERE id = $1 FOR UPDATE', [poId]);
      if (!o) throw notFound('Porosia e blerjes');
      const branchId = Number(o.branch_id);
      await this.can(tx, actor.id, 'purchase.invoice.enter', branchId);
      if (['DRAFT', 'PENDING_APPROVAL', 'CANCELLED'].includes(o.status)) throw new DomainError('ORDER_STATE', 'Fatura regjistrohet vetëm për porosi të aprovuara', 409);
      if (await one(tx, 'SELECT 1 FROM supplier_invoice WHERE supplier_id = $1 AND invoice_no = $2', [o.supplier_id, input.invoiceNo])) {
        throw new DomainError('DUPLICATE_INVOICE', 'Kjo faturë e furnitorit është regjistruar tashmë', 409);
      }
      const discrepancies: object[] = [];
      for (const l of input.lines) {
        if (!positive(l.qty) || !NUM.test(l.unitCost)) throw new DomainError('VALIDATION', 'Sasia dhe kostoja duhet të jenë numra dhjetorë');
        const c = await one<{ qty_over: boolean; price_diff: boolean; po_cost: string; open_qty: string }>(tx,
          `SELECT ($3::numeric > qty_received - qty_invoiced) AS qty_over, ($4::numeric <> unit_cost) AS price_diff,
                  unit_cost::text AS po_cost, (qty_received - qty_invoiced)::text AS open_qty
             FROM purchase_order_line WHERE po_id = $1 AND line_no = $2`, [poId, l.lineNo, l.qty, l.unitCost]);
        if (!c) { discrepancies.push({ lineNo: l.lineNo, type: 'LINE_NOT_ON_ORDER' }); continue; }
        if (c.qty_over) discrepancies.push({ lineNo: l.lineNo, type: 'QTY_EXCEEDS_RECEIVED', invoiced: l.qty, receivedNotInvoiced: c.open_qty });
        if (c.price_diff) discrepancies.push({ lineNo: l.lineNo, type: 'PRICE_MISMATCH', invoiced: l.unitCost, ordered: c.po_cost });
      }
      const status = discrepancies.length === 0 ? 'MATCHED' : 'DISCREPANCY';
      const inv = await one<{ id: string }>(tx,
        `INSERT INTO supplier_invoice(po_id, supplier_id, invoice_no, invoice_date, status, discrepancies, entered_by) VALUES ($1, $2, $3, $4::date, $5, $6, $7) RETURNING id`,
        [poId, o.supplier_id, input.invoiceNo, input.invoiceDate, status, JSON.stringify(discrepancies), actor.id]);
      const id = Number(inv?.id);
      for (const l of input.lines) {
        await tx.query('INSERT INTO supplier_invoice_line(invoice_id, po_line_no, qty, unit_cost) VALUES ($1, $2, $3::numeric, $4::numeric)', [id, l.lineNo, l.qty, l.unitCost]);
        if (status === 'MATCHED') {
          await tx.query('UPDATE purchase_order_line SET qty_invoiced = qty_invoiced + $3::numeric WHERE po_id = $1 AND line_no = $2', [poId, l.lineNo, l.qty]);
        }
      }
      await this.audit.record(tx, { actorUserId: actor.id, action: status === 'MATCHED' ? 'purchase.invoice_matched' : 'purchase.invoice_discrepancy',
        entityType: 'supplier_invoice', entityId: id, branchId, details: { poId, invoiceNo: input.invoiceNo, discrepancies } });
      return { id, status, discrepancies };
    });
  }

  async cancel(actor: AuthUser, poId: number, reason: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const o = await one<{ status: string; branch_id: string }>(tx, 'SELECT status, branch_id FROM purchase_order WHERE id = $1 FOR UPDATE', [poId]);
      if (!o) throw notFound('Porosia e blerjes');
      if (!['DRAFT', 'APPROVED'].includes(o.status)) throw new DomainError('ORDER_STATE', 'Anulohet vetëm drafti ose porosia e aprovuar pa asnjë pranim', 409);
      await this.can(tx, actor.id, 'purchase.order.create', Number(o.branch_id));
      await tx.query(`UPDATE purchase_order SET status = 'CANCELLED' WHERE id = $1`, [poId]);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'purchase.order_cancelled', entityType: 'purchase_order', entityId: poId, branchId: Number(o.branch_id), details: { reason } });
    });
  }

  async getOrder(actor: AuthUser, poId: number) {
    const o = await one<{ branch_id: string }>(this.db,
      `SELECT o.id, o.branch_id, o.warehouse_id, o.status, o.currency, o.note, o.approval_request_id, s.code AS supplier_code, s.name AS supplier_name
         FROM purchase_order o JOIN supplier s ON s.id = o.supplier_id WHERE o.id = $1`, [poId]);
    if (!o) throw notFound('Porosia e blerjes');
    await this.can(this.db, actor.id, 'purchase.read', Number(o.branch_id));
    const lines = await this.db.query(
      `SELECT l.line_no, p.sku, p.name, p.tracks_lot, l.qty::text, l.unit_cost::text, l.qty_received::text, l.qty_invoiced::text, round(l.qty * l.unit_cost, 4)::text AS total
         FROM purchase_order_line l JOIN product p ON p.id = l.product_id WHERE l.po_id = $1 ORDER BY l.line_no`, [poId]);
    const invoices = await this.db.query(`SELECT id, invoice_no, to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date, status, discrepancies FROM supplier_invoice WHERE po_id = $1 ORDER BY id`, [poId]);
    return { ...o, lines: lines.rows, invoices: invoices.rows, total: await this.total(this.db, poId) };
  }

  async listOrders(actor: AuthUser) {
    const res = await this.db.query(
      `SELECT o.id, o.status, b.code AS branch, s.name AS supplier_name, to_char(o.created_at, 'YYYY-MM-DD') AS created,
              (SELECT COALESCE(sum(round(qty * unit_cost, 4)), 0)::text FROM purchase_order_line WHERE po_id = o.id) AS total
         FROM purchase_order o JOIN branch b ON b.id = o.branch_id JOIN supplier s ON s.id = o.supplier_id
        WHERE EXISTS (SELECT 1 FROM user_role ur JOIN role_permission rp ON rp.role_id = ur.role_id AND rp.permission_code = 'purchase.read'
                       WHERE ur.user_id = $1 AND ur.revoked_at IS NULL AND (ur.valid_until IS NULL OR ur.valid_until > now())
                         AND (ur.branch_id IS NULL OR ur.branch_id = o.branch_id))
        ORDER BY o.id DESC LIMIT 200`, [actor.id]);
    return res.rows;
  }
}
