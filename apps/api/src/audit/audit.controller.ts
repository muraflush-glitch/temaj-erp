import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../common/request';
import { AuditService } from './audit.service';

const ListDto = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), entityType: z.string().max(60).optional() });

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit.read')
  list(@Query() q: unknown) {
    const dto = ListDto.parse(q);
    return this.audit.list(dto.limit, dto.entityType);
  }

  @Get('verify')
  @RequirePermission('audit.read')
  async verify() {
    const broken = await this.audit.verifyChain();
    return { intact: broken === null, firstBrokenId: broken };
  }
}
