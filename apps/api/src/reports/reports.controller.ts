import { Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import { PermissionService } from '../auth/permission.service';
import { forbidden } from '../common/errors';
import { AuthUser, CurrentUser } from '../common/request';
import { DB } from '../database/database.module';
import { Db } from '../database/db';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Range = z.object({ from: DateStr, to: DateStr });
const StockRange = Range.extend({ warehouseId: z.coerce.number().int().positive().optional() });

/** Raportet lexojnë vetëm dokumente të regjistruara (fatura, nota krediti, arkëtime, lëvizje stoku). Kërkojnë lejen e raporteve për gjithë kompaninë. */
@Controller('reports')
export class ReportsController {
  constructor(@Inject(DB) private readonly db: Db, private readonly perms: PermissionService) {}

  private async guard(u: AuthUser): Promise<void> {
    if (!(await this.perms.has(u.id, 'reports.read', 'global'))) throw forbidden();
  }

  /** Shitjet sipas degës: faturat minus notat e kreditit në periudhë. */
  @Get('sales')
  async sales(@CurrentUser() u: AuthUser, @Query() q: unknown) {
    await this.guard(u);
    const { from, to } = Range.parse(q);
    const res = await this.db.query(
      `SELECT b.code AS branch, b.name AS branch_name,
              COALESCE(i.n, 0)::int AS invoices, COALESCE(i.net, 0)::text AS invoiced_net, COALESCE(i.vat, 0)::text AS invoiced_vat, COALESCE(i.gross, 0)::text AS invoiced_gross,
              COALESCE(c.n, 0)::int AS credit_notes, COALESCE(c.net, 0)::text AS credited_net, COALESCE(c.gross, 0)::text AS credited_gross,
              (COALESCE(i.net, 0) - COALESCE(c.net, 0))::text AS net_sales, (COALESCE(i.gross, 0) - COALESCE(c.gross, 0))::text AS gross_sales
         FROM branch b
         LEFT JOIN (SELECT branch_id, count(*) AS n, sum(net) AS net, sum(vat) AS vat, sum(gross) AS gross FROM sales_invoice WHERE invoice_date BETWEEN $1::date AND $2::date GROUP BY branch_id) i ON i.branch_id = b.id
         LEFT JOIN (SELECT branch_id, count(*) AS n, sum(net) AS net, sum(gross) AS gross FROM credit_note WHERE credit_date BETWEEN $1::date AND $2::date GROUP BY branch_id) c ON c.branch_id = b.id
        ORDER BY b.code`, [from, to]);
    return { from, to, rows: res.rows, note: 'Vlerat përdorin TVSH provizore. Fitimi nuk llogaritet: stoku nuk ka ende vlerë.' };
  }

  /** Borxhet e klientëve sipas vjetërsisë (ditë pas afatit të pagesës). */
  @Get('receivables')
  async receivables(@CurrentUser() u: AuthUser) {
    await this.guard(u);
    const res = await this.db.query(
      `SELECT c.code, c.name, c.credit_limit::text,
              sum(o.open_amount)::text AS total,
              sum(o.open_amount) FILTER (WHERE o.open_amount > 0 AND CURRENT_DATE <= o.due_date)::text AS not_due,
              sum(o.open_amount) FILTER (WHERE o.open_amount > 0 AND CURRENT_DATE - o.due_date BETWEEN 1 AND 30)::text AS d1_30,
              sum(o.open_amount) FILTER (WHERE o.open_amount > 0 AND CURRENT_DATE - o.due_date BETWEEN 31 AND 60)::text AS d31_60,
              sum(o.open_amount) FILTER (WHERE o.open_amount > 0 AND CURRENT_DATE - o.due_date BETWEEN 61 AND 90)::text AS d61_90,
              sum(o.open_amount) FILTER (WHERE o.open_amount > 0 AND CURRENT_DATE - o.due_date > 90)::text AS d90_plus,
              sum(o.open_amount) FILTER (WHERE o.open_amount < 0)::text AS owed_to_customer
         FROM customer_open_invoice o JOIN customer c ON c.id = o.customer_id
        WHERE o.open_amount <> 0 GROUP BY c.id ORDER BY sum(o.open_amount) DESC`);
    return res.rows;
  }

  @Get('payables')
  async payables(@CurrentUser() u: AuthUser) {
    await this.guard(u);
    const res = await this.db.query(
      `SELECT s.code, s.name, count(*)::int AS invoices, sum(o.open_amount)::text AS total, to_char(min(o.invoice_date), 'YYYY-MM-DD') AS oldest_invoice
         FROM supplier_open_invoice o JOIN supplier s ON s.id = o.supplier_id WHERE o.open_amount > 0 GROUP BY s.id ORDER BY sum(o.open_amount) DESC`);
    return res.rows;
  }

  /** Lëvizjet e stokut në periudhë, sipas produktit dhe llojit të lëvizjes. */
  @Get('stock-movements')
  async stockMovements(@CurrentUser() u: AuthUser, @Query() q: unknown) {
    await this.guard(u);
    const { from, to, warehouseId } = StockRange.parse(q);
    const res = await this.db.query(
      `SELECT w.code AS warehouse, p.sku, p.name, p.base_uom,
              COALESCE(sum(m.qty) FILTER (WHERE m.type::text = 'RECEIPT'), 0)::text AS received,
              COALESCE(sum(m.qty) FILTER (WHERE m.type::text = 'DISPATCH'), 0)::text AS dispatched,
              COALESCE(sum(m.qty) FILTER (WHERE m.type::text = 'CUSTOMER_RETURN'), 0)::text AS returned,
              COALESCE(sum(m.qty) FILTER (WHERE m.type::text = 'TRANSFER_IN'), 0)::text AS transfer_in,
              COALESCE(sum(m.qty) FILTER (WHERE m.type::text = 'TRANSFER_OUT'), 0)::text AS transfer_out,
              (COALESCE(sum(m.qty) FILTER (WHERE m.type::text = 'ADJUSTMENT_IN'), 0) - COALESCE(sum(m.qty) FILTER (WHERE m.type::text = 'ADJUSTMENT_OUT'), 0))::text AS adjustments
         FROM stock_movement m JOIN product p ON p.id = m.product_id JOIN warehouse w ON w.id = m.warehouse_id
        WHERE m.created_at::date BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR m.warehouse_id = $3)
        GROUP BY w.code, p.id ORDER BY w.code, p.sku`, [from, to, warehouseId ?? null]);
    return res.rows;
  }
}
