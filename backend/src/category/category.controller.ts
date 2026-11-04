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
import { CategoryService } from './category.service.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';

@Controller()
export class CategoryController {
  constructor(
    private readonly categoryService: CategoryService,
    private readonly access: LedgerAccessService,
  ) {}

  @Get('ledgers/:ledgerId/categories')
  async findAll(
    @CurrentUser() user: AuthUser,
    @Param('ledgerId') ledgerId: string,
  ) {
    await this.access.assertMember(ledgerId, user.id);
    return this.categoryService.findAll(ledgerId);
  }

  @Post('ledgers/:ledgerId/categories')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('ledgerId') ledgerId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    await this.access.assertWritable(ledgerId, user.id);
    return this.categoryService.create(ledgerId, dto);
  }

  @Patch('categories/:id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    const category = await this.categoryService.findOne(id);
    await this.access.assertWritable(category.ledgerId, user.id);
    return this.categoryService.update(id, dto);
  }

  @Delete('categories/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const category = await this.categoryService.findOne(id);
    await this.access.assertWritable(category.ledgerId, user.id);
    return this.categoryService.remove(id);
  }
}
