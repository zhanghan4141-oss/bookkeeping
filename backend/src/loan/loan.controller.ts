import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { LedgerAccessService } from '../common/access/ledger-access.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import {
  CreateLoanDto,
  PayRepaymentDto,
  PrepayDto,
  UpdateLoanDto,
  UpdateRepaymentsDto,
} from './dto/loan.dto.js';
import { LoanService } from './loan.service.js';

@Controller()
export class LoanController {
  constructor(
    private readonly loanService: LoanService,
    private readonly access: LedgerAccessService,
  ) {}

  @Get('ledgers/:ledgerId/loans')
  async findAll(
    @CurrentUser() user: AuthUser,
    @Param('ledgerId') ledgerId: string,
  ) {
    await this.access.assertMember(ledgerId, user.id);
    return this.loanService.findAll(ledgerId);
  }

  @Post('loans')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateLoanDto) {
    await this.access.assertWritable(dto.ledgerId, user.id);
    return this.loanService.create(user.id, dto);
  }

  @Post('loans/:id/prepay')
  async prepay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PrepayDto,
  ) {
    const loan = await this.loanService.findLoanEntity(id);
    await this.access.assertWritable(loan.ledgerId, user.id);
    return this.loanService.prepay(user.id, id, dto);
  }

  @Patch('loans/:id/repayments')
  async updateRepayments(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRepaymentsDto,
  ) {
    const loan = await this.loanService.findLoanEntity(id);
    await this.access.assertWritable(loan.ledgerId, user.id);
    return this.loanService.updateRepayments(user.id, id, dto);
  }

  @Get('loans/:id')
  async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const loan = await this.loanService.findLoanEntity(id);
    await this.access.assertMember(loan.ledgerId, user.id);
    return this.loanService.findOne(id);
  }

  @Patch('loans/:id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLoanDto,
  ) {
    const loan = await this.loanService.findLoanEntity(id);
    await this.access.assertWritable(loan.ledgerId, user.id);
    return this.loanService.update(user.id, id, dto);
  }

  @Delete('loans/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const loan = await this.loanService.findLoanEntity(id);
    await this.access.assertWritable(loan.ledgerId, user.id);
    return this.loanService.remove(id);
  }

  @Post('loans/:id/repayments/:periodNo/pay')
  async pay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('periodNo', ParseIntPipe) periodNo: number,
    @Body() dto: PayRepaymentDto,
  ) {
    const loan = await this.loanService.findLoanEntity(id);
    await this.access.assertWritable(loan.ledgerId, user.id);
    return this.loanService.payRepayment(id, periodNo, dto);
  }

  @Post('loans/:id/repayments/:periodNo/undo')
  async undo(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('periodNo', ParseIntPipe) periodNo: number,
  ) {
    const loan = await this.loanService.findLoanEntity(id);
    await this.access.assertWritable(loan.ledgerId, user.id);
    return this.loanService.undoRepayment(id, periodNo);
  }
}
