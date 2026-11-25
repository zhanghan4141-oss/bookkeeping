import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(ledgerId: string) {
    return this.prisma.category.findMany({
      where: { ledgerId },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
      include: { _count: { select: { transactions: true } } },
    });
  }

  create(ledgerId: string, dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: { ...dto, ledgerId },
    });
  }

  update(id: string, dto: UpdateCategoryDto) {
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(id: string, targetCategoryId?: string | null) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('类别不存在');
    await this.prisma.$transaction(async (tx) => {
      // 迁移该类别下的流水：目标类别（同类型同账本）或未分类
      if (targetCategoryId) {
        const target = await tx.category.findUnique({ where: { id: targetCategoryId } });
        if (!target || target.ledgerId !== category.ledgerId || target.type !== category.type) {
          throw new BadRequestException('目标类别无效');
        }
        await tx.transaction.updateMany({
          where: { categoryId: id },
          data: { categoryId: targetCategoryId },
        });
      } else {
        await tx.transaction.updateMany({
          where: { categoryId: id },
          data: { categoryId: null },
        });
      }
      await tx.category.delete({ where: { id } });
    });
    return { success: true };
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('类别不存在');
    return category;
  }
}
