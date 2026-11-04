import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { LedgerAccessService } from '../common/access/ledger-access.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import {
  AddMemberDto,
  CreateLedgerDto,
  UpdateLedgerDto,
  UpdateMemberDto,
} from './dto/ledger.dto.js';
import { LedgerService } from './ledger.service.js';

@Controller('ledgers')
export class LedgerController {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly access: LedgerAccessService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLedgerDto) {
    return this.ledgerService.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.ledgerService.findAll(user.id);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.assertMember(id, user.id);
    return this.ledgerService.findOne(user.id, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLedgerDto,
  ) {
    await this.access.assertWritable(id, user.id);
    return this.ledgerService.update(id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.assertOwner(id, user.id);
    return this.ledgerService.remove(id);
  }

  // ---- 成员管理 ----

  @Get(':id/members')
  async listMembers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.assertMember(id, user.id);
    return this.ledgerService.listMembers(id);
  }

  @Post(':id/members')
  async addMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
  ) {
    await this.access.assertOwner(id, user.id);
    return this.ledgerService.addMember(id, dto);
  }

  @Patch(':id/members/:userId')
  async updateMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    await this.access.assertOwner(id, user.id);
    return this.ledgerService.updateMember(id, userId, dto.role);
  }

  @Delete(':id/members/:userId')
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    await this.access.assertOwner(id, user.id);
    return this.ledgerService.removeMember(id, userId);
  }
}
