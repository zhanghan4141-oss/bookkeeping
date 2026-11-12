import { Controller, Get, Query } from '@nestjs/common';
import { LedgerAccessService } from '../common/access/ledger-access.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { AuditLogService } from './audit-log.service.js';

@Controller('audit-logs')
export class AuditLogController {
  constructor(
    private readonly service: AuditLogService,
    private readonly access: LedgerAccessService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('ledgerId') ledgerId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.access.assertMember(ledgerId, user.id);
    return this.service.list(
      ledgerId,
      Number(limit ?? 50),
      Number(offset ?? 0),
    );
  }
}
