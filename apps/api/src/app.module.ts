import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AccessController } from './access/access.controller';
import { AccessService } from './access/access.service';
import { ApprovalsController } from './approvals/approvals.controller';
import { ApprovalsService } from './approvals/approvals.service';
import { EscalationService } from './approvals/escalation.service';
import { DevNotificationSink } from './outbox/dev-notification.sink';
import { OutboxService } from './outbox/outbox.service';
import { WorkerService } from './outbox/worker.service';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { PermissionService } from './auth/permission.service';
import { AllExceptionsFilter } from './common/errors';
import { Public } from './common/request';
import { BillingController } from './billing/billing.controller';
import { BillingService } from './billing/billing.service';
import { CashController } from './cash/cash.controller';
import { CashService } from './cash/cash.service';
import { DatabaseModule } from './database/database.module';
import { InventoryController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { LedgerController } from './ledger/ledger.controller';
import { LedgerService } from './ledger/ledger.service';
import { PurchasingController } from './purchasing/purchasing.controller';
import { PurchasingService } from './purchasing/purchasing.service';
import { ReportsController } from './reports/reports.controller';
import { SalesController } from './sales/sales.controller';
import { SalesService } from './sales/sales.service';
import { OrgController } from './org/org.controller';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() { return { status: 'ok', environment: process.env.APP_ENV ?? 'development' }; }
}

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, AuthController, OrgController, ApprovalsController, AccessController, AuditController, LedgerController, InventoryController, SalesController, BillingController, CashController, PurchasingController, ReportsController],
  providers: [
    AuditService, PermissionService, AuthService, ApprovalsService, AccessService,
    LedgerService, InventoryService, SalesService, CashService, BillingService, PurchasingService, OutboxService, DevNotificationSink, EscalationService, WorkerService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
