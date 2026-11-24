import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { LedgerAccessService } from '../common/access/ledger-access.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import {
  CreateExpensePlanDto,
  MarkPeriodDto,
  UpdateExpensePlanDto,
  UpdateExpensePlanPeriodsDto,
} from './dto/expense-plan.dto.js';
import { ExpensePlanService } from './expense-plan.service.js';

@Controller()
export class ExpensePlanController {
  constructor(
    private readonly expensePlanService: ExpensePlanService,
    private readonly access: LedgerAccessService,
  ) {}

  @Get('ledgers/:ledgerId/expense-plans')
  async findAll(
    @CurrentUser() user: AuthUser,
    @Param('ledgerId') ledgerId: string,
  ) {
    await this.access.assertMember(ledgerId, user.id);
    return this.expensePlanService.findAll(ledgerId);
  }

  @Post('expense-plans')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateExpensePlanDto) {
    await this.access.assertWritable(dto.ledgerId, user.id);
    return this.expensePlanService.create(user.id, dto);
  }

  @Get('expense-plans/:id')
  async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const plan = await this.expensePlanService.findPlanEntity(id);
    await this.access.assertMember(plan.ledgerId, user.id);
    return this.expensePlanService.findOne(id);
  }

  @Patch('expense-plans/:id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateExpensePlanDto,
  ) {
    const plan = await this.expensePlanService.findPlanEntity(id);
    await this.access.assertWritable(plan.ledgerId, user.id);
    return this.expensePlanService.update(user.id, id, dto);
  }

  @Delete('expense-plans/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const plan = await this.expensePlanService.findPlanEntity(id);
    await this.access.assertWritable(plan.ledgerId, user.id);
    return this.expensePlanService.remove(id);
  }

  @Post('expense-plans/:id/periods/:periodNo/mark')
  async mark(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('periodNo', ParseIntPipe) periodNo: number,
    @Body() dto: MarkPeriodDto,
  ) {
    const plan = await this.expensePlanService.findPlanEntity(id);
    await this.access.assertWritable(plan.ledgerId, user.id);
    return this.expensePlanService.mark(id, periodNo, dto);
  }

  @Post('expense-plans/:id/periods/:periodNo/undo')
  async undo(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('periodNo', ParseIntPipe) periodNo: number,
  ) {
    const plan = await this.expensePlanService.findPlanEntity(id);
    await this.access.assertWritable(plan.ledgerId, user.id);
    return this.expensePlanService.undo(id, periodNo);
  }

  /** 逐期编辑（已支出期不可改） */
  @Patch('expense-plans/:id/periods')
  async updatePeriods(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateExpensePlanPeriodsDto,
  ) {
    const plan = await this.expensePlanService.findPlanEntity(id);
    await this.access.assertWritable(plan.ledgerId, user.id);
    return this.expensePlanService.updatePeriods(id, dto.periods);
  }

  @Get('expense-plans/:id/export')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const plan = await this.expensePlanService.findPlanEntity(id);
    await this.access.assertNotViewer(plan.ledgerId, user.id);
    const { buffer, filename } = await this.expensePlanService.exportPlan(id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.send(buffer);
  }
}