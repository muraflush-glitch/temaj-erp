import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { ZodError } from 'zod';

/** Gabim biznesi me kod të qëndrueshëm (për UI dhe teste) dhe mesazh në shqip. */
export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
  }
}

export const forbidden = (msg = 'Nuk keni leje për këtë veprim') => new DomainError('FORBIDDEN', msg, 403);
export const notFound = (what: string) => new DomainError('NOT_FOUND', `${what} nuk u gjet`, 404);

const PG_MESSAGES: Record<string, [string, string, number]> = {
  SELF_APPROVAL_FORBIDDEN: ['SELF_APPROVAL_FORBIDDEN', 'Nuk mund ta aprovoni kërkesën tuaj', 403],
  APPROVAL_NOT_PENDING: ['APPROVAL_NOT_PENDING', 'Kërkesa nuk është më në pritje', 409],
  APPROVAL_DECISION_IMMUTABLE: ['IMMUTABLE', 'Vendimi nuk mund të ndryshohet', 409],
  AUDIT_LOG_APPEND_ONLY: ['IMMUTABLE', 'Audit trail nuk mund të ndryshohet', 409],
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof DomainError) {
      res.status(err.status).json({ code: err.code, message: err.message });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ code: 'VALIDATION', message: 'Të dhëna të pavlefshme', issues: err.issues });
      return;
    }
    if (err instanceof HttpException) {
      res.status(err.getStatus()).json({ code: 'HTTP', message: err.message });
      return;
    }
    const pgMsg = (err as { message?: string }).message ?? '';
    const mapped = PG_MESSAGES[pgMsg];
    if (mapped) {
      res.status(mapped[2]).json({ code: mapped[0], message: mapped[1] });
      return;
    }
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ code: 'CONFLICT', message: 'Regjistrimi ekziston tashmë' });
      return;
    }
    console.error(err);
    res.status(500).json({ code: 'INTERNAL', message: 'Gabim i brendshëm' });
  }
}
