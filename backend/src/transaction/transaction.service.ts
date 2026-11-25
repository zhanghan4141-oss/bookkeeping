import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateTransactionDto,
  QueryTransactionDto,
  TransferTransactionDto,
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
        expensePlan: { select: { id: true, name: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      // 「所有」周期需展示全部流水，不再做数量截断（前端按分组折叠渲染）
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

  /** 转移流水到其它账本：校验贷款流水不可转、目标账本非当前、分类归属与类型一致 */
  async transfer(id: string, dto: TransferTransactionDto) {
    const tx = await this.prisma.transaction.findUnique({ where: { id } });
    if (!tx) throw new NotFoundException('流水不存在');
    if (tx.loanId) throw new BadRequestException('贷款流水不可转移');
    if (dto.ledgerId === tx.ledgerId) {
      throw new BadRequestException('目标账本不能是当前账本');
    }
    if (dto.categoryId) {
      const cat = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, ledgerId: dto.ledgerId },
      });
      if (!cat) throw new BadRequestException('目标分类不属于该账本');
      if (cat.type !== tx.type) {
        throw new BadRequestException('流水类型与目标分类类型不一致');
      }
    }

    return this.prisma.transaction.update({
      where: { id },
      data: {
        ledger: { connect: { id: dto.ledgerId } },
        category: dto.categoryId
          ? { connect: { id: dto.categoryId } }
          : { disconnect: true },
      },
      include: {
        category: { select: { id: true, name: true, icon: true, color: true, type: true } },
        user: { select: { id: true, nickname: true, avatarUrl: true } },
        loan: { select: { id: true, name: true } },
        expensePlan: { select: { id: true, name: true } },
      },
    });
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

  /**
   * 批量修改流水类别（同一账本内）。
   * - 贷款流水 / 支出计划流水不可修改（只能在贷款/支出计划中编辑）；
   * - 类别必须属于该账本，且类别收支类型与流水类型一致。
   */
  async updateCategoryMany(ledgerId: string, ids: string[], categoryId: string) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return { success: true, count: 0 };

    const txs = await this.prisma.transaction.findMany({
      where: { id: { in: uniqueIds }, ledgerId },
      select: { id: true, type: true, loanId: true, expensePlanId: true },
    });
    if (txs.length !== uniqueIds.length) {
      throw new NotFoundException('部分流水不存在');
    }
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category || category.ledgerId !== ledgerId) {
      throw new BadRequestException('类别无效');
    }
    for (const t of txs) {
      if (t.loanId) throw new BadRequestException('贷款流水不可修改类别');
      if (t.expensePlanId) {
        throw new BadRequestException('支出计划流水不可修改类别，请在支出计划中编辑');
      }
      if (t.type === 'transfer') {
        throw new BadRequestException('转账流水不支持修改类别');
      }
      if (t.type === 'income' && category.type !== 'income') {
        throw new BadRequestException('收入流水只能使用收入类别');
      }
      if (t.type === 'expense' && category.type !== 'expense') {
        throw new BadRequestException('支出流水只能使用支出类别');
      }
    }
    await this.prisma.transaction.updateMany({
      where: { id: { in: uniqueIds }, ledgerId },
      data: { categoryId },
    });
    return { success: true, count: uniqueIds.length };
  }
}
