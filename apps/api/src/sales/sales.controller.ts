import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/request';
import { SalesService } from './sales.service';

const Num = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/);
const Pct = z.string().regex(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/);
const Key = z.string().min(8).max(100);
const Id = z.number().int().positive();
const Sku = z.string().regex(/^[A-Z0-9._-]{2,40}$/);
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CustomerDto = z.object({
  code: z.string().regex(/^[A-Z0-9-]{2,30}$/), name: z.string().min(2).max(200), kind: z.enum(['PERSON', 'COMPANY']),
  phone: z.string().max(40).optional(), email: z.string().email().optional(), creditLimit: Num.optional(), paymentTermDays: z.number().int().min(0).max(365).optional(),
});
const PriceDto = z.object({ sku: Sku, validFrom: DateStr, unitPrice: Num });
const OrderDto = z.object({
  branchId: Id, warehouseId: Id, customerId: Id, onCredit: z.boolean().optional(), note: z.string().max(500).optional(), idempotencyKey: Key,
  lines: z.array(z.object({
    sku: Sku, qty: Num, unitPrice: Num.optional(), discountPct: Pct.optional(),
    lot: z.object({ lotCode: z.string().min(1).max(60), shade: z.string().max(30).optional(), caliber: z.string().max(30).optional() }).optional(),
  })).min(1).max(200),
});
const ConfirmDto = z.object({ reason: z.string().max(500).optional() });
const DeliverDto = z.object({ documentRef: z.string().min(1).max(100), idempotencyKey: Key, lines: z.array(z.object({ lineNo: z.number().int().positive(), qty: Num })).min(1).max(200) });
const CancelDto = z.object({ reason: z.string().min(5).max(500) });

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('customers')
  customers(@CurrentUser() u: AuthUser) { return this.sales.customers(u); }

  @Post('customers')
  createCustomer(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.sales.createCustomer(u, CustomerDto.parse(b)); }

  @Get('prices')
  prices(@CurrentUser() u: AuthUser) { return this.sales.prices(u); }

  @Post('prices')
  @HttpCode(204)
  async setPrice(@CurrentUser() u: AuthUser, @Body() b: unknown): Promise<void> { await this.sales.setPrice(u, PriceDto.parse(b)); }

  @Get('orders')
  list(@CurrentUser() u: AuthUser) { return this.sales.listOrders(u); }

  @Post('orders')
  create(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.sales.createOrder(u, OrderDto.parse(b)); }

  @Get('orders/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.sales.getOrder(u, id); }

  @Post('orders/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) { return this.sales.confirm(u, id, ConfirmDto.parse(b ?? {})); }

  @Post('orders/:id/deliveries')
  deliver(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) { return this.sales.deliver(u, id, DeliverDto.parse(b)); }

  @Post('orders/:id/cancel')
  @HttpCode(204)
  async cancel(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: unknown): Promise<void> { await this.sales.cancel(u, id, CancelDto.parse(b).reason); }
}
