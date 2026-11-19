import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from '../auth/permission.service';
import { DomainError, forbidden, notFound } from '../common/errors';
import { AuthUser } from '../common/request';
import { DB } from '../database/database.module';
import { Db, one, Tx, withTransaction } from '../database/db';

export const ORDER_EXCEPTION = 'sales.order_exception';
const NUM = /^\d{1,15}(\.\d{1,4})?$/;

export interface OrderLineInput { sku: string; lot?: { lotCode: string; shade?: string; caliber?: string }; qty: string; unitPrice?: string; discountPct?: string }
export interface OrderInput { branchId: number; warehouseId: number; customerId: number; note?: string; idempotencyKey: string; lines: OrderLineInput[] }

/**
 * Shitjet (prototip): ofertë → porosi e konfirmuar me rezervim stoku → dorëzime (edhe të pjesshme).
 * Çmimet janë neto. Faturimi, TVSH-ja, fiskalizimi, arkëtimet dhe regjistrimet kontabël nuk janë këtu:
 * presin rregullat e miratuara nga kontabilisti.
 */
@Injectable()
export class SalesService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly perms: PermissionService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    this.approvals.register(ORDER_EXCEPTION, {
      requestPermission: 'sales.order.confirm',
      execute: async (tx, req) => {
        const orderId = Number(req.payload['orderId']);
        const o = await one<{ status: string }>(tx, 'SELECT status FROM sales_order WHERE id = $1 FOR UPDATE', [orderId]);
        if (o?.status !== 'PENDING_APPROVAL') throw new DomainError('ORDER_STATE', 'Porosia nuk është në pritje të aprovimit', 409);
        await this.confirmInTx(tx, Number(req.requested_by), orderId, Number(req.id));
      },
      onClosedWithoutApproval: async (tx, req) => {
        await tx.query(`UPDATE sales_order SET status = 'DRAFT' WHERE id = $1 AND status = 'PENDING_APPROVAL'`, [Number(req.payload['orderId'])]);
      },
    });
  }

  private async can(q: Db | Tx, userId: number, permission: string, branchId: number): Promise<void> {
    if (!(await this.perms.has(userId, permission, branchId, q))) throw forbidden();
  }

  async createCustomer(actor: AuthUser, input: { code: string; name: string; kind: 'PERSON' | 'COMPANY'; phone?: string; email?: string; creditLimit?: string; paymentTermDays?: number }): Promise<{ id: number }> {
    if (!(await this.perms.has(actor.id, 'customers.manage', 'any'))) throw forbidden();
    // Limiti i kreditit është vendim financiar: vetëm kush ka lejen e veçantë mund ta vendosë mbi zero.
    const limit = input.creditLimit ?? '0';
    if (!/^0+(\.0+)?$/.test(limit) && !(await this.perms.has(actor.id, 'customers.credit.manage', 'any'))) {
      throw forbidden('Nuk keni të drejtë të vendosni limit krediti');
    }
    return withTransaction(this.db, async (tx) => {
      const r = await one<{ id: string }>(tx,
        `INSERT INTO customer(code, name, kind, phone, email, credit_limit, payment_term_days, created_by) VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8) RETURNING id`,
        [input.code, input.name, input.kind, input.phone ?? null, input.email ?? null, limit, input.paymentTermDays ?? 0, actor.id]);
      const id = Number(r?.id);
      // Të dhënat personale nuk kopjohen në audit; vetëm kodi.
      await this.audit.record(tx, { actorUserId: actor.id, action: 'customer.created', entityType: 'customer', entityId: id, details: { code: input.code } });
      return { id };
    });
  }

  async customers(actor: AuthUser) {
    if (!(await this.perms.has(actor.id, 'customers.read', 'any'))) throw forbidden();
    const res = await this.db.query('SELECT id, code, name, kind, phone, email, credit_limit::text, payment_term_days, is_active FROM customer ORDER BY name');
    return res.rows;
  }

  async setPrice(actor: AuthUser, input: { sku: string; validFrom: string; unitPrice: string }): Promise<void> {
    if (!(await this.perms.has(actor.id, 'pricing.manage', 'global'))) throw forbidden();
    await withTransaction(this.db, async (tx) => {
      const p = await one<{ id: string }>(tx, 'SELECT id FROM product WHERE sku = $1', [input.sku]);
      if (!p) throw notFound(`Produkti ${input.sku}`);
      // Një çmim i vendosur nuk mbishkruhet: ndryshimi bëhet me datë të re efektive.
      await tx.query('INSERT INTO product_price(product_id, valid_from, unit_price, set_by) VALUES ($1, $2::date, $3::numeric, $4)', [p.id, input.validFrom, input.unitPrice, actor.id]);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'price.set', entityType: 'product', entityId: p.id, details: { validFrom: input.validFrom, unitPrice: input.unitPrice } });
    });
  }

  async createOrder(actor: AuthUser, input: OrderInput): Promise<{ id: number; created: boolean }> {
    return withTransaction(this.db, async (tx) => {
      const dup = await one<{ id: string }>(tx, 'SELECT id FROM sales_order WHERE created_by = $1 AND idempotency_key = $2', [actor.id, input.idempotencyKey]);
      if (dup) return { id: Number(dup.id), created: false };
      await this.can(tx, actor.id, 'sales.order.create', input.branchId);
      const wh = await one(tx, 'SELECT 1 FROM warehouse WHERE id = $1 AND branch_id = $2 AND is_active', [input.warehouseId, input.branchId]);
      if (!wh) throw new DomainError('VALIDATION', 'Magazina nuk i përket kësaj dege');
      const cust = await one(tx, 'SELECT 1 FROM customer WHERE id = $1 AND is_active', [input.customerId]);
      if (!cust) throw notFound('Klienti');
      const o = await one<{ id: string }>(tx,
        `INSERT INTO sales_order(branch_id, warehouse_id, customer_id, note, created_by, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [input.branchId, input.warehouseId, input.customerId, input.note ?? null, actor.id, input.idempotencyKey]);
      const id = Number(o?.id);
      let no = 0;
      for (const l of input.lines) {
        if (!NUM.test(l.qty) || /^0+(\.0+)?$/.test(l.qty)) throw new DomainError('VALIDATION', 'Sasia duhet të jetë numër dhjetor pozitiv');
        const p = await one<{ id: string; tracks_lot: boolean; step_ok: boolean; list_price: string | null }>(tx,
          `SELECT p.id, p.tracks_lot, (product_qty_step(p) IS NULL OR mod($2::numeric, product_qty_step(p)) = 0) AS step_ok,
                  (SELECT unit_price::text FROM product_price pp WHERE pp.product_id = p.id AND pp.valid_from <= CURRENT_DATE ORDER BY pp.valid_from DESC LIMIT 1) AS list_price
             FROM product p WHERE p.sku = $1 AND p.is_active`, [l.sku, l.qty]);
        if (!p) throw notFound(`Produkti ${l.sku}`);
        if (!p.step_ok) throw new DomainError('INVALID_QUANTITY_STEP', `Sasia e ${l.sku} nuk përputhet me paketimin (kuti të plota)`, 422);
        if (p.list_price == null) throw new DomainError('NO_PRICE', `Produkti ${l.sku} nuk ka çmim në listë`, 422);
        let lotId: string | null = null;
        if (p.tracks_lot) {
          if (!l.lot) throw new DomainError('LOT_REQUIRED', `Për ${l.sku} duhet zgjedhur loti (nuanca/kalibri)`, 422);
          const lot = await one<{ id: string }>(tx, 'SELECT id FROM stock_lot WHERE product_id = $1 AND lot_code = $2 AND shade = $3 AND caliber = $4',
            [p.id, l.lot.lotCode, l.lot.shade ?? '', l.lot.caliber ?? '']);
          if (!lot) throw notFound('Loti');
          lotId = lot.id;
        } else if (l.lot) throw new DomainError('LOT_NOT_ALLOWED', `${l.sku} nuk ndiqet me lot`, 422);
        await tx.query(
          `INSERT INTO sales_order_line(order_id, line_no, product_id, lot_id, qty, list_price, unit_price, discount_pct)
           VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8::numeric)`,
          [id, ++no, p.id, lotId, l.qty, p.list_price, l.unitPrice ?? p.list_price, l.discountPct ?? '0']);
      }
      await this.audit.record(tx, { actorUserId: actor.id, action: 'sales.order_drafted', entityType: 'sales_order', entityId: id, branchId: input.branchId, details: { lines: no } });
      return { id, created: true };
    });
  }

  /** Përjashtimet që kërkojnë aprovim: zbritje mbi limitin e rolit, çmim ndryshe nga lista, përzierje nuancash/kalibrash. */
  private async exceptions(tx: Tx, userId: number, orderId: number, branchId: number): Promise<string[]> {
    const r = await one<{ over_discount: boolean; price_override: boolean; shade_mix: boolean }>(tx,
      `SELECT
         (SELECT COALESCE(max(l.discount_pct), 0) FROM sales_order_line l WHERE l.order_id = $1)
           > (SELECT COALESCE(max(d.max_pct), 0) FROM user_role ur JOIN discount_limit d ON d.role_id = ur.role_id
               WHERE ur.user_id = $2 AND ur.revoked_at IS NULL AND (ur.valid_until IS NULL OR ur.valid_until > now())
                 AND (ur.branch_id IS NULL OR ur.branch_id = $3)) AS over_discount,
         EXISTS (SELECT 1 FROM sales_order_line l WHERE l.order_id = $1 AND l.unit_price <> l.list_price) AS price_override,
         EXISTS (SELECT 1 FROM sales_order_line l JOIN stock_lot s ON s.id = l.lot_id WHERE l.order_id = $1
                  GROUP BY l.product_id HAVING count(DISTINCT (s.shade, s.caliber)) > 1) AS shade_mix`,
      [orderId, userId, branchId]);
    const out: string[] = [];
    if (r?.over_discount) out.push('DISCOUNT_OVER_LIMIT');
    if (r?.price_override) out.push('PRICE_OVERRIDE');
    if (r?.shade_mix) out.push('SHADE_CALIBER_MIX');
    return out;
  }

  private async total(q: Db | Tx, orderId: number): Promise<string> {
    const r = await one<{ t: string }>(q, 'SELECT COALESCE(sum(sales_line_net(l)), 0)::text AS t FROM sales_order_line l WHERE l.order_id = $1', [orderId]);
    return r?.t ?? '0';
  }

  async confirm(actor: AuthUser, orderId: number, input: { reason?: string }): Promise<{ status: string; exceptions: string[]; approvalRequestId?: number }> {
    return withTransaction(this.db, async (tx) => {
      const o = await one<{ status: string; branch_id: string }>(tx, 'SELECT status, branch_id FROM sales_order WHERE id = $1 FOR UPDATE', [orderId]);
      if (!o) throw notFound('Porosia');
      if (o.status !== 'DRAFT') throw new DomainError('ORDER_STATE', 'Vetëm oferta (draft) mund të konfirmohet', 409);
      const branchId = Number(o.branch_id);
      await this.can(tx, actor.id, 'sales.order.confirm', branchId);
      const exceptions = await this.exceptions(tx, actor.id, orderId, branchId);
      if (exceptions.length === 0) {
        await this.confirmInTx(tx, actor.id, orderId, null);
        return { status: 'CONFIRMED', exceptions };
      }
      if (!input.reason || input.reason.trim().length < 5) {
        throw new DomainError('REASON_REQUIRED', `Porosia ka përjashtime (${exceptions.join(', ')}); duhet arsyetim për aprovim`, 422);
      }
      const req = await this.approvals.requestInTx(tx, actor, {
        actionCode: ORDER_EXCEPTION, branchId, amount: await this.total(tx, orderId), reason: input.reason,
        idempotencyKey: `sales-order-exception:${orderId}:${Date.now()}`, payload: { orderId, exceptions },
      });
      await tx.query(`UPDATE sales_order SET status = 'PENDING_APPROVAL', approval_request_id = $2 WHERE id = $1`, [orderId, req.id]);
      return { status: 'PENDING_APPROVAL', exceptions, approvalRequestId: req.id };
    });
  }

  /** Konfirmimi e rezervon stokun për çdo rresht; nëse një rresht nuk ka mall të lirë, dështon e gjithë porosia. */
  private async confirmInTx(tx: Tx, userId: number, orderId: number, approvalRequestId: number | null): Promise<void> {
    await tx.query(
      `INSERT INTO stock_reservation(order_id, line_no, warehouse_id, product_id, lot_id, qty)
       SELECT l.order_id, l.line_no, o.warehouse_id, l.product_id, l.lot_id, l.qty
         FROM sales_order_line l JOIN sales_order o ON o.id = l.order_id WHERE l.order_id = $1 ORDER BY l.line_no`, [orderId]);
    const r = await one<{ branch_id: string }>(tx, `UPDATE sales_order SET status = 'CONFIRMED', confirmed_at = now() WHERE id = $1 RETURNING branch_id`, [orderId]);
    await this.audit.record(tx, { actorUserId: userId, action: 'sales.order_confirmed', entityType: 'sales_order', entityId: orderId,
      branchId: Number(r?.branch_id), details: { approvalRequestId } });
  }

  /** Dorëzimi real: liron rezervimin dhe ul stokun fizik në të njëjtin transaksion, me dokument. */
  async deliver(actor: AuthUser, orderId: number, input: { documentRef: string; idempotencyKey: string; lines: { lineNo: number; qty: string }[] }): Promise<{ status: string; created: boolean }> {
    return withTransaction(this.db, async (tx) => {
      const o = await one<{ status: string; branch_id: string; warehouse_id: string }>(tx, 'SELECT status, branch_id, warehouse_id FROM sales_order WHERE id = $1 FOR UPDATE', [orderId]);
      if (!o) throw notFound('Porosia');
      const dup = await one(tx, 'SELECT 1 FROM stock_movement WHERE created_by = $1 AND idempotency_key LIKE $2 LIMIT 1', [actor.id, `${input.idempotencyKey}:%`]);
      if (dup) return { status: o.status, created: false };
      if (!['CONFIRMED', 'PARTIALLY_DELIVERED'].includes(o.status)) throw new DomainError('ORDER_STATE', 'Dorëzohet vetëm porosia e konfirmuar', 409);
      const branchId = Number(o.branch_id);
      await this.can(tx, actor.id, 'sales.deliver', branchId);
      for (const l of input.lines) {
        if (!NUM.test(l.qty) || /^0+(\.0+)?$/.test(l.qty)) throw new DomainError('VALIDATION', 'Sasia duhet të jetë numër dhjetor pozitiv');
        const line = await one<{ product_id: string; lot_id: string | null; ok: boolean }>(tx,
          'SELECT product_id, lot_id, (qty - qty_delivered >= $3::numeric) AS ok FROM sales_order_line WHERE order_id = $1 AND line_no = $2', [orderId, l.lineNo, l.qty]);
        if (!line) throw notFound(`Rreshti ${l.lineNo}`);
        if (!line.ok) throw new DomainError('OVER_DELIVERY', 'Sasia e dorëzuar nuk mund ta kalojë sasinë e porositur', 422);
        await tx.query('UPDATE stock_reservation SET qty = qty - $3::numeric WHERE order_id = $1 AND line_no = $2', [orderId, l.lineNo, l.qty]);
        await tx.query(
          `INSERT INTO stock_movement(type, warehouse_id, product_id, lot_id, qty, document_ref, reason, created_by, idempotency_key)
           VALUES ('DISPATCH', $1, $2, $3, $4::numeric, $5, $6, $7, $8)`,
          [o.warehouse_id, line.product_id, line.lot_id, l.qty, input.documentRef, `Porosia #${orderId}`, actor.id, `${input.idempotencyKey}:${l.lineNo}`]);
        await tx.query('UPDATE sales_order_line SET qty_delivered = qty_delivered + $3::numeric WHERE order_id = $1 AND line_no = $2', [orderId, l.lineNo, l.qty]);
      }
      const open = await one<{ n: string }>(tx, 'SELECT count(*) AS n FROM sales_order_line WHERE order_id = $1 AND qty_delivered < qty', [orderId]);
      const status = Number(open?.n) === 0 ? 'DELIVERED' : 'PARTIALLY_DELIVERED';
      await tx.query('UPDATE sales_order SET status = $2 WHERE id = $1', [orderId, status]);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'sales.order_delivered', entityType: 'sales_order', entityId: orderId, branchId,
        details: { status, documentRef: input.documentRef, lines: input.lines } });
      return { status, created: true };
    });
  }

  async cancel(actor: AuthUser, orderId: number, reason: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const o = await one<{ status: string; branch_id: string }>(tx, 'SELECT status, branch_id FROM sales_order WHERE id = $1 FOR UPDATE', [orderId]);
      if (!o) throw notFound('Porosia');
      if (!['DRAFT', 'CONFIRMED'].includes(o.status)) throw new DomainError('ORDER_STATE', 'Anulohet vetëm oferta ose porosia e konfirmuar pa asnjë dorëzim', 409);
      await this.can(tx, actor.id, 'sales.order.confirm', Number(o.branch_id));
      await tx.query('DELETE FROM stock_reservation WHERE order_id = $1', [orderId]);   // lirohet malli
      await tx.query(`UPDATE sales_order SET status = 'CANCELLED' WHERE id = $1`, [orderId]);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'sales.order_cancelled', entityType: 'sales_order', entityId: orderId, branchId: Number(o.branch_id), details: { reason } });
    });
  }

  async getOrder(actor: AuthUser, orderId: number) {
    const o = await one<{ branch_id: string }>(this.db,
      `SELECT o.id, o.branch_id, o.warehouse_id, o.status, to_char(o.order_date, 'YYYY-MM-DD') AS order_date, o.note, o.approval_request_id,
              c.code AS customer_code, c.name AS customer_name
         FROM sales_order o JOIN customer c ON c.id = o.customer_id WHERE o.id = $1`, [orderId]);
    if (!o) throw notFound('Porosia');
    await this.can(this.db, actor.id, 'sales.read', Number(o.branch_id));
    const lines = await this.db.query(
      `SELECT l.line_no, p.sku, p.name, s.lot_code, s.shade, s.caliber, l.qty::text, l.list_price::text, l.unit_price::text, l.discount_pct::text,
              l.qty_delivered::text, sales_line_net(l)::text AS net
         FROM sales_order_line l JOIN product p ON p.id = l.product_id LEFT JOIN stock_lot s ON s.id = l.lot_id WHERE l.order_id = $1 ORDER BY l.line_no`, [orderId]);
    return { ...o, lines: lines.rows, totalNet: await this.total(this.db, orderId), taxNote: 'Neto, pa TVSH. Trajtimi i TVSH-së pret miratim.' };
  }

  async listOrders(actor: AuthUser) {
    const res = await this.db.query(
      `SELECT o.id, o.status, to_char(o.order_date, 'YYYY-MM-DD') AS order_date, b.code AS branch, c.name AS customer_name,
              (SELECT COALESCE(sum(sales_line_net(l)), 0)::text FROM sales_order_line l WHERE l.order_id = o.id) AS total_net
         FROM sales_order o JOIN branch b ON b.id = o.branch_id JOIN customer c ON c.id = o.customer_id
        WHERE EXISTS (SELECT 1 FROM user_role ur JOIN role_permission rp ON rp.role_id = ur.role_id AND rp.permission_code = 'sales.read'
                       WHERE ur.user_id = $1 AND ur.revoked_at IS NULL AND (ur.valid_until IS NULL OR ur.valid_until > now())
                         AND (ur.branch_id IS NULL OR ur.branch_id = o.branch_id))
        ORDER BY o.id DESC LIMIT 200`, [actor.id]);
    return res.rows;
  }
}
