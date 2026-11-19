import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/request';
import { InventoryService } from './inventory.service';

const Qty = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/);
const Key = z.string().min(8).max(100);
const Sku = z.string().regex(/^[A-Z0-9._-]{2,40}$/);
const Id = z.number().int().positive();
const Lot = z.object({ lotCode: z.string().min(1).max(60), shade: z.string().max(30).optional(), caliber: z.string().max(30).optional() });
const DocRef = z.string().min(1).max(100);

const ProductDto = z.object({
  sku: Sku, name: z.string().min(2).max(200), baseUom: z.enum(['M2', 'PIECE']),
  piecesPerBox: z.number().int().positive().optional(), m2PerPiece: z.string().regex(/^\d{1,5}(\.\d{1,6})?$/).optional(),
  allowPartialBox: z.boolean(), tracksLot: z.boolean(),
});
const MoveDto = z.object({ warehouseId: Id, sku: Sku, lot: Lot.optional(), qty: Qty, documentRef: DocRef, idempotencyKey: Key });
const AdjustDto = z.object({ warehouseId: Id, sku: Sku, lotId: Id.optional(), direction: z.enum(['IN', 'OUT']), qty: Qty, reason: z.string().min(5).max(500), idempotencyKey: Key });
const TransferDto = z.object({
  fromWarehouseId: Id, toWarehouseId: Id, documentRef: DocRef, idempotencyKey: Key,
  lines: z.array(z.object({ sku: Sku, lot: Lot.optional(), qty: Qty })).min(1).max(200),
});
const ReceiveDto = z.object({ lines: z.array(z.object({ lineNo: z.number().int().positive(), qtyReceived: Qty })).min(1).max(200) });

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inv: InventoryService) {}

  @Get('products')
  products(@CurrentUser() u: AuthUser) { return this.inv.products(u); }

  @Post('products')
  createProduct(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.inv.createProduct(u, ProductDto.parse(b)); }

  @Get('warehouses/:id/stock')
  stock(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.inv.balances(u, id); }

  @Post('receipts')
  receive(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.inv.receive(u, MoveDto.parse(b)); }

  @Post('dispatches')
  dispatch(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.inv.dispatch(u, MoveDto.parse(b)); }

  @Post('adjustment-requests')
  adjust(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.inv.requestAdjustment(u, AdjustDto.parse(b)); }

  @Get('transfers')
  transfers(@CurrentUser() u: AuthUser) { return this.inv.transfers(u); }

  @Post('transfers')
  transferDispatch(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.inv.transferDispatch(u, TransferDto.parse(b)); }

  @Post('transfers/:id/receive')
  @HttpCode(200)
  transferReceive(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) {
    return this.inv.transferReceive(u, id, ReceiveDto.parse(b).lines);
  }
}
