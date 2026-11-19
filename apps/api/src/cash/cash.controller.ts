import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/request';
import { CashService } from './cash.service';

const Money = z.string().regex(/^\d{1,15}(\.\d{1,2})?$/);
const CloseDto = z.object({ counted: Money, bankDeposit: Money.default('0'), reason: z.string().max(500).optional() });

@Controller('cash')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get('registers')
  registers(@CurrentUser() u: AuthUser) { return this.cash.registers(u); }

  @Get('registers/:id/sessions')
  history(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.cash.history(u, id); }

  @Post('registers/:id/open')
  open(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.cash.open(u, id); }

  @Post('sessions/:id/close')
  @HttpCode(200)
  close(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) { return this.cash.close(u, id, CloseDto.parse(b)); }
}
