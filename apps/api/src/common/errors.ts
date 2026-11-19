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
  JOURNAL_ENTRY_IMMUTABLE: ['IMMUTABLE', 'Regjistrimi i postuar nuk mund të ndryshohet; përdorni kthimin', 409],
  UNBALANCED_ENTRY: ['UNBALANCED_ENTRY', 'Regjistrimi nuk është i balancuar: debia duhet të jetë e barabartë me kredinë', 422],
  NO_FISCAL_PERIOD: ['NO_FISCAL_PERIOD', 'Nuk ka periudhë fiskale për këtë datë', 422],
  PERIOD_CLOSED: ['PERIOD_CLOSED', 'Periudha është e mbyllur', 409],
  PERIOD_HAS_DRAFTS: ['PERIOD_HAS_DRAFTS', 'Periudha ka regjistrime të papostuara; postojini ose fshijini para mbylljes', 409],
  INVALID_ACCOUNT: ['INVALID_ACCOUNT', 'Një llogari është joaktive ose nuk lejon regjistrime', 422],
  INVALID_BRANCH: ['INVALID_BRANCH', 'Dega nuk i përket këtij subjekti ligjor', 422],
  INSUFFICIENT_STOCK: ['INSUFFICIENT_STOCK', 'Nuk ka stok të mjaftueshëm; stoku fizik nuk mund të bëhet negativ', 409],
  INVALID_QUANTITY_STEP: ['INVALID_QUANTITY_STEP', 'Sasia nuk përputhet me paketimin e produktit (kuti të plota)', 422],
  LOT_REQUIRED: ['LOT_REQUIRED', 'Ky produkt kërkon lot (nuancë/kalibër)', 422],
  LOT_NOT_ALLOWED: ['LOT_NOT_ALLOWED', 'Ky produkt nuk ndiqet me lot', 422],
  LOT_PRODUCT_MISMATCH: ['LOT_PRODUCT_MISMATCH', 'Loti nuk i përket këtij produkti', 422],
  PRODUCT_INACTIVE: ['PRODUCT_INACTIVE', 'Produkti është joaktiv', 422],
  STOCK_MOVEMENT_IMMUTABLE: ['IMMUTABLE', 'Lëvizjet e stokut nuk ndryshohen; bëni një lëvizje korrigjuese', 409],
  PRODUCT_PACKAGING_LOCKED: ['PRODUCT_PACKAGING_LOCKED', 'Paketimi nuk ndryshohet pasi produkti ka lëvizje stoku', 409],
  STOCK_RESERVED: ['STOCK_RESERVED', 'Malli është i rezervuar për porosi të klientëve dhe nuk mund të dalë', 409],
  INSUFFICIENT_AVAILABLE_STOCK: ['INSUFFICIENT_AVAILABLE_STOCK', 'Nuk ka stok të lirë të mjaftueshëm për ta rezervuar këtë porosi', 409],
  SALES_ORDER_LOCKED: ['IMMUTABLE', 'Porosia e konfirmuar nuk mund të ndryshohet', 409],
  PURCHASE_ORDER_LOCKED: ['IMMUTABLE', 'Porosia e blerjes nuk mund të ndryshohet pas dërgimit', 409],
  PURCHASE_DOCUMENT_IMMUTABLE: ['IMMUTABLE', 'Pranimet dhe faturat e regjistruara nuk ndryshohen', 409],
  FINANCIAL_DOCUMENT_IMMUTABLE: ['IMMUTABLE', 'Faturat dhe arkëtimet e regjistruara nuk ndryshohen', 409],
  OVER_ALLOCATION: ['OVER_ALLOCATION', 'Pagesa e shpërndarë e kalon vlerën e faturës ose të pagesës', 422],
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
