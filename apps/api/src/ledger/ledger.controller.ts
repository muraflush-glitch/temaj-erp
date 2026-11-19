import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/request';
import { LedgerService } from './ledger.service';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), 'Datë e pavlefshme');
const Amount = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/);
const Key = z.string().min(8).max(100);

const DraftDto = z.object({
  legalEntityCode: z.string().max(20).optional(),
  entryDate: DateStr,
  description: z.string().min(3).max(500),
  idempotencyKey: Key,
  lines: z.array(z.object({
    accountCode: z.string().min(1).max(20),
    branchId: z.number().int().positive().nullable(),
    debit: Amount,
    credit: Amount,
    description: z.string().max(300).optional(),
  })).min(2).max(200),
});
const ReverseDto = z.object({ entryDate: DateStr, reason: z.string().min(5).max(300), idempotencyKey: Key });
const CloseDto = z.object({ reason: z.string().min(5).max(500), idempotencyKey: Key });
const TbDto = z.object({ asOf: DateStr, branchId: z.coerce.number().int().positive().optional(), legalEntityCode: z.string().max(20).optional() });
const ListDto = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('accounts')
  accounts(@CurrentUser() u: AuthUser) { return this.ledger.accounts(u); }

  @Get('periods')
  periods(@CurrentUser() u: AuthUser) { return this.ledger.periods(u); }

  @Post('periods/:id/close-request')
  requestClose(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const dto = CloseDto.parse(body);
    return this.ledger.requestPeriodClose(u, id, dto.reason, dto.idempotencyKey);
  }

  @Get('trial-balance')
  trialBalance(@CurrentUser() u: AuthUser, @Query() q: unknown) {
    const dto = TbDto.parse(q);
    return this.ledger.trialBalance(u, dto.asOf, dto.branchId, dto.legalEntityCode);
  }

  @Get('entries')
  list(@CurrentUser() u: AuthUser, @Query() q: unknown) { return this.ledger.listEntries(u, ListDto.parse(q).limit); }

  @Post('entries')
  create(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.ledger.createDraft(u, DraftDto.parse(body)); }

  @Get('entries/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.ledger.getEntry(u, id); }

  @Delete('entries/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<void> { await this.ledger.deleteDraft(u, id); }

  @Post('entries/:id/post')
  @HttpCode(200)
  post(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.ledger.post(u, id); }

  @Post('entries/:id/reverse')
  reverse(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.ledger.reverse(u, id, ReverseDto.parse(body));
  }
}
