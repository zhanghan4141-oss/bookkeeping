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
}
