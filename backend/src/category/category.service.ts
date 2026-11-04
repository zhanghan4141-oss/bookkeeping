import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(ledgerId: string) {
    return this.prisma.category.findMany({
      where: { ledgerId },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
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

  async remove(id: string) {
    await this.prisma.category.delete({ where: { id } });
    return { success: true };
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('类别不存在');
    return category;
  }
}
