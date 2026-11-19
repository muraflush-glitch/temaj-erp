import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/request';
import { BillingService } from './billing.service';

const Key = z.string().min(8).max(100);
const Method = z.enum(['CASH', 'BANK']);
const InvoiceDto = z.object({ idempotencyKey: Key, payment: z.object({ method: Method, reference: z.string().max(100).optional() }).optional() });
const PaymentDto = z.object({ branchId: z.number().int().positive(), method: Method, amount: z.string().regex(/^\d{1,15}(\.\d{1,2})?$/), reference: z.string().max(100).optional(), idempotencyKey: Key });

@Controller('sales')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('invoices')
  invoices(@CurrentUser() u: AuthUser) { return this.billing.invoices(u); }

  @Post('orders/:id/invoices')
  invoice(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) { return this.billing.invoiceOrder(u, id, InvoiceDto.parse(b)); }

  @Post('customers/:id/payments')
  pay(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) { return this.billing.receivePayment(u, id, PaymentDto.parse(b)); }

  @Get('customers/:id/balance')
  balance(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.billing.customerBalance(u, id); }
}
