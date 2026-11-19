import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AccessController } from './access/access.controller';
import { AccessService } from './access/access.service';
import { ApprovalsController } from './approvals/approvals.controller';
import { ApprovalsService } from './approvals/approvals.service';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { PermissionService } from './auth/permission.service';
import { AllExceptionsFilter } from './common/errors';
import { Public } from './common/request';
import { DatabaseModule } from './database/database.module';
import { OrgController } from './org/org.controller';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() { return { status: 'ok', environment: process.env.APP_ENV ?? 'development' }; }
}

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, AuthController, OrgController, ApprovalsController, AccessController, AuditController],
  providers: [
    AuditService, PermissionService, AuthService, ApprovalsService, AccessService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
