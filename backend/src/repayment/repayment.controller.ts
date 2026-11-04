import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { RepaymentService } from './repayment.service.js';

@Controller('repayments')
export class RepaymentController {
  constructor(private readonly repaymentService: RepaymentService) {}

  @Get('upcoming')
  upcoming(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
  ) {
    const d = Math.min(Math.max(parseInt(days ?? '30', 10) || 30, 1), 365);
    return this.repaymentService.upcoming(user.id, d);
  }
}
