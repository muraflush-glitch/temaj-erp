import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/request';
import { ApprovalsService } from './approvals.service';

const DecideDto = z.object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().max(1000).optional() });

@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('pending')
  pending(@CurrentUser() user: AuthUser) { return this.approvals.pendingFor(user); }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) { return this.approvals.mine(user); }

  @Post(':id/decide')
  @HttpCode(200)
  decide(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const dto = DecideDto.parse(body);
    return this.approvals.decide(user, id, dto.decision, dto.comment);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.approvals.cancel(user, id);
  }
}
