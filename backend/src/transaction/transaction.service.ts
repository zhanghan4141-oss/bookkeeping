import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateTransactionDto,
  QueryTransactionDto,
  UpdateTransactionDto,
} from './dto/transaction.dto.js';

@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(ledgerId: string, query: QueryTransactionDto) {
    const where: Prisma.TransactionWhereInput = { ledgerId };

    if (query.month) {
      const start = new Date(`${query.month}-01T00:00:00`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      where.occurredAt = { gte: start, lt: end };
    } else if (query.year) {
      const start = new Date(`${query.year}-01-01T00:00:00`);
      const end = new Date(`${Number(query.year) + 1}-01-01T00:00:00`);
      where.occurredAt = { gte: start, lt: end };
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.type) where.type = query.type;
    if (query.keyword) {
      const kw = query.keyword.trim();
      const or: Prisma.TransactionWhereInput[] = [
        { note: { contains: kw } },
        { category: { name: { contains: kw } } },
      ];
      // 金额搜索：关键词是数字时精确匹配金额
      if (/^\d+(\.\d+)?$/.test(kw)) {
        or.push({ amount: { equals: new Prisma.Decimal(kw) } });
      }
      where.OR = or;
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, icon: true, color: true, type: true } },
        user: { select: { id: true, nickname: true, avatarUrl: true } },
        loan: { select: { id: true, name: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });

    return transactions;
  }

  async create(userId: string, dto: CreateTransactionDto) {
    return this.prisma.transaction.create({
      data: {
        ledgerId: dto.ledgerId,
        categoryId: dto.categoryId,
        userId,
        type: dto.type,
        amount: new Prisma.Decimal(dto.amount),
        note: dto.note,
        occurredAt: new Date(dto.occurredAt),
      },
      include: {
        category: { select: { id: true, name: true, icon: true, color: true, type: true } },
      },
    });
  }

  async findOne(id: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id } });
    if (!tx) throw new NotFoundException('流水不存在');
    return tx;
  }

  async update(id: string, dto: UpdateTransactionDto) {
    const data: Prisma.TransactionUpdateInput = {};
    if (dto.categoryId !== undefined) {
      data.category = dto.categoryId
        ? { connect: { id: dto.categoryId } }
        : { disconnect: true };
    }
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.occurredAt !== undefined) data.occurredAt = new Date(dto.occurredAt);

    return this.prisma.transaction.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.prisma.transaction.delete({ where: { id } });
    return { success: true };
  }

  async findLedgerIds(ids: string[]): Promise<string[]> {
    const txs = await this.prisma.transaction.findMany({
      where: { id: { in: ids } },
      select: { ledgerId: true },
    });
    return [...new Set(txs.map((t) => t.ledgerId))];
  }

  async removeMany(ids: string[]) {
    if (!ids?.length) return { success: true };
    await this.prisma.transaction.deleteMany({ where: { id: { in: ids } } });
    return { success: true };
  }
}
