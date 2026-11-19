import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../common/request';
import { AuthService } from './auth.service';
import { PermissionService } from './permission.service';

const LoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  totp: z.string().regex(/^\d{6}$/).optional(),
});
const CodeDto = z.object({ code: z.string().regex(/^\d{6}$/) });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly perms: PermissionService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request) {
    const dto = LoginDto.parse(body);
    // req.ip respekton 'trust proxy' (vendoset në main.ts sipas TRUST_PROXY për load balancer-in).
    return this.auth.login(dto.email, dto.password, dto.totp, req.ip ?? '0.0.0.0');
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logout(user);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { ...(await this.auth.me(user)), permissions: await this.perms.listForUser(user.id) };
  }

  @Post('mfa/setup')
  async mfaSetup(@CurrentUser() user: AuthUser) {
    return this.auth.mfaSetup(user);
  }

  @Post('mfa/enable')
  @HttpCode(204)
  async mfaEnable(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<void> {
    await this.auth.mfaEnable(user, CodeDto.parse(body).code);
  }
}
