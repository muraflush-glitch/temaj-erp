import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/request';
import { AccessService } from './access.service';

const CreateUserDto = z.object({ email: z.string().email(), displayName: z.string().min(2).max(120), password: z.string().min(12).max(200) });
const GrantDto = z.object({
  userId: z.number().int().positive(),
  roleCode: z.string().regex(/^[A-Z_]{2,40}$/),
  branchId: z.number().int().positive().nullable(),
  validUntil: z.string().datetime().optional(),
  reason: z.string().min(5).max(500),
  idempotencyKey: z.string().min(8).max(100),
});
const ReasonDto = z.object({ reason: z.string().min(5).max(500) });

@Controller('access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('users')
  users(@CurrentUser() user: AuthUser) { return this.access.listUsers(user); }

  @Post('users')
  createUser(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.access.createUser(user, CreateUserDto.parse(body)); }

  @Post('users/:id/deactivate')
  @HttpCode(204)
  async deactivate(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown): Promise<void> {
    await this.access.deactivateUser(user, id, ReasonDto.parse(body).reason);
  }

  @Post('role-grants')
  requestGrant(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.access.requestRoleGrant(user, GrantDto.parse(body)); }

  @Post('user-roles/:id/revoke')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown): Promise<void> {
    await this.access.revokeRole(user, id, ReasonDto.parse(body).reason);
  }
}
