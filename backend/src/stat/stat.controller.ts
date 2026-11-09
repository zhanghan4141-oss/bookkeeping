import { Controller, Get, Param, Query } from '@nestjs/common';
import { LedgerAccessService } from '../common/access/ledger-access.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { LedgerSummaryQueryDto, SummaryQueryDto } from './dto/stat.dto.js';
import { StatService } from './stat.service.js';

@Controller()
export class StatController {
  constructor(
    private readonly statService: StatService,
    private readonly access: LedgerAccessService,
  ) {}

  /** 单账本统计 */
  @Get('ledgers/:ledgerId/stats/summary')
  async ledgerSummary(
    @CurrentUser() user: AuthUser,
    @Param('ledgerId') ledgerId: string,
    @Query() query: SummaryQueryDto,
  ) {
    await this.access.assertMember(ledgerId, user.id);
    return this.statService.summary(user.id, [ledgerId], query);
  }

  /** 多账本汇总统计 */
  @Get('stats/summary')
  summary(
    @CurrentUser() user: AuthUser,
    @Query() query: SummaryQueryDto,
  ) {
    const ledgerIds = query.ledgerIds
      ? query.ledgerIds.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return this.statService.summary(user.id, ledgerIds, query);
  }

  /** 每个账本的收支结余汇总（账本列表用） */
  @Get('stats/ledgers')
  ledgerSummaries(
    @CurrentUser() user: AuthUser,
    @Query() query: LedgerSummaryQueryDto,
  ) {
    return this.statService.ledgerSummaries(user.id, query.period ?? 'day');
  }

  /** 账本页顶部矩阵：当日/当月/当年/所有 四维度所有账本合计 */
  @Get('stats/overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.statService.overview(user.id);
  }
}
