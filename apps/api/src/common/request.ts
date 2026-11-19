import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export interface AuthUser { id: number; sessionId: number; mfaPassed: boolean }
export interface AuthedRequest { user?: AuthUser; headers: Record<string, string | string[] | undefined> }

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_PERMISSION = 'requiredPermission';
/** Kërkon që përdoruesi ta ketë lejen në së paku një degë; kontrollet sipas degës bëhen në shërbim. */
export const RequirePermission = (code: string) => SetMetadata(REQUIRED_PERMISSION, code);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new Error('Përdoruesi mungon në kërkesë');
  return req.user;
});
