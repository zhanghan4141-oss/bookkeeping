import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { LedgerAccessService } from '../common/access/ledger-access.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import {
  CreateTransactionDto,
  QueryTransactionDto,
  RemoveManyTransactionDto,
  TransferTransactionDto,
  UpdateCategoryManyDto,
  UpdateTransactionDto,
} from './dto/transaction.dto.js';
import { TransactionService } from './transaction.service.js';

@Controller()
export class TransactionController {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly access: LedgerAccessService,
  ) {}

  @Get('ledgers/:ledgerId/transactions')
  async findAll(
    @CurrentUser() user: AuthUser,
    @Param('ledgerId') ledgerId: string,
    @Query() query: QueryTransactionDto,
  ) {
    await this.access.assertMember(ledgerId, user.id);
    return this.transactionService.findAll(ledgerId, query);
  }

  @Post('transactions')
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTransactionDto,
  ) {
    await this.access.assertWritable(dto.ledgerId, user.id);
    return this.transactionService.create(user.id, dto);
  }

  @Patch('transactions/:id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
  ) {
    const tx = await this.transactionService.findOne(id);
    await this.access.assertWritable(tx.ledgerId, user.id);
    return this.transactionService.update(id, dto);
  }

  @Patch('transactions/:id/transfer')
  async transfer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: TransferTransactionDto,
  ) {
    const tx = await this.transactionService.findOne(id);
    // 源账本与目标账本都必须可写（viewer 会被拒绝）
    await this.access.assertWritable(tx.ledgerId, user.id);
    await this.access.assertWritable(dto.ledgerId, user.id);
    return this.transactionService.transfer(id, dto);
  }

  @Delete('transactions/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const tx = await this.transactionService.findOne(id);
    await this.access.assertWritable(tx.ledgerId, user.id);
    return this.transactionService.remove(id);
  }

  @Delete('transactions')
  async removeMany(
    @CurrentUser() user: AuthUser,
    @Body() dto: RemoveManyTransactionDto,
  ) {
    const ledgerIds = await this.transactionService.findLedgerIds(dto.ids);
    for (const ledgerId of ledgerIds) {
      await this.access.assertWritable(ledgerId, user.id);
    }
    return this.transactionService.removeMany(dto.ids);
  }

  /** 批量修改流水类别（loan/支出计划流水不可参与） */
  @Patch('ledgers/:ledgerId/transactions/category')
  async updateCategoryMany(
    @CurrentUser() user: AuthUser,
    @Param('ledgerId') ledgerId: string,
    @Body() dto: UpdateCategoryManyDto,
  ) {
    await this.access.assertWritable(ledgerId, user.id);
    return this.transactionService.updateCategoryMany(
      ledgerId,
      dto.ids,
      dto.categoryId,
    );
  }
}
