import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, forbidden } from '../common/errors';
import { AuthedRequest, IS_PUBLIC, REQUIRED_PERMISSION } from '../common/request';
import { AuthService } from './auth.service';
import { PermissionService } from './permission.service';

/** Mbrojtje globale: çdo endpoint kërkon sesion të vlefshëm, përveç atyre @Public. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService, private readonly perms: PermissionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['authorization'];
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new DomainError('UNAUTHENTICATED', 'Duhet të hyni në sistem', 401);
    const user = await this.auth.resolveSession(token);
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Sesioni ka skaduar ose është revokuar', 401);
    req.user = user;
    const required = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_PERMISSION, targets);
    if (required && !(await this.perms.has(user.id, required))) throw forbidden();
    return true;
  }
}
