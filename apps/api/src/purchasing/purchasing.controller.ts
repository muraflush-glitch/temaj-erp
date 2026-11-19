import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/request';
import { PurchasingService } from './purchasing.service';

const Num = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/);
const Key = z.string().min(8).max(100);
const Id = z.number().int().positive();
const Sku = z.string().regex(/^[A-Z0-9._-]{2,40}$/);
const Lot = z.object({ lotCode: z.string().min(1).max(60), shade: z.string().max(30).optional(), caliber: z.string().max(30).optional() });

const SupplierDto = z.object({ code: z.string().regex(/^[A-Z0-9-]{2,30}$/), name: z.string().min(2).max(200), country: z.string().max(60).optional() });
const OrderDto = z.object({ branchId: Id, warehouseId: Id, supplierId: Id, note: z.string().max(500).optional(), idempotencyKey: Key,
  lines: z.array(z.object({ sku: Sku, qty: Num, unitCost: Num })).min(1).max(300) });
const SubmitDto = z.object({ reason: z.string().max(500).optional() });
const ReceiveDto = z.object({ documentRef: z.string().min(1).max(100), idempotencyKey: Key,
  lines: z.array(z.object({ lineNo: z.number().int().positive(), qty: Num, lot: Lot.optional() })).min(1).max(300) });
const InvoiceDto = z.object({ invoiceNo: z.string().min(1).max(60), invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(z.object({ lineNo: z.number().int().positive(), qty: Num, unitCost: Num })).min(1).max(300) });
const CancelDto = z.object({ reason: z.string().min(5).max(500) });

@Controller('purchasing')
export class PurchasingController {
  constructor(private readonly svc: PurchasingService) {}

  @Get('suppliers')
  suppliers(@CurrentUser() u: AuthUser) { return this.svc.suppliers(u); }

  @Post('suppliers')
  createSupplier(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.svc.createSupplier(u, SupplierDto.parse(b)); }

  @Get('orders')
  list(@CurrentUser() u: AuthUser) { return this.svc.listOrders(u); }

  @Post('orders')
  create(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.svc.createOrder(u, OrderDto.parse(b)); }

  @Get('orders/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.svc.getOrder(u, id); }

  @Post('orders/:id/submit')
  @HttpCode(200)
  submit(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) { return this.svc.submit(u, id, SubmitDto.parse(b ?? {}).reason); }

  @Post('orders/:id/receipts')
  receive(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) { return this.svc.receive(u, id, ReceiveDto.parse(b)); }

  @Post('orders/:id/invoices')
  invoice(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) { return this.svc.enterInvoice(u, id, InvoiceDto.parse(b)); }

  @Post('orders/:id/cancel')
  @HttpCode(204)
  async cancel(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: unknown): Promise<void> { await this.svc.cancel(u, id, CancelDto.parse(b).reason); }
}
