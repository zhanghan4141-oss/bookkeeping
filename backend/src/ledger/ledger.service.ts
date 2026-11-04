import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AddMemberDto,
  CreateLedgerDto,
  UpdateLedgerDto,
} from './dto/ledger.dto.js';

// 内置类别模板
const DAILY_EXPENSE_CATEGORIES = ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '教育', '人情'];
const DAILY_INCOME_CATEGORIES = ['工资', '奖金', '理财', '其他收入'];
const LOAN_CATEGORIES = [
  { name: '还款本金', type: 'expense' },
  { name: '还款利息', type: 'expense' },
  { name: '放款收款', type: 'income' },
];

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateLedgerDto) {
    const ledger = await this.prisma.ledger.create({
      data: {
        name: dto.name,
        type: dto.type,
        icon: dto.icon,
        color: dto.color,
        currency: dto.currency ?? 'CNY',
        members: {
          create: { userId, role: 'owner' },
        },
      },
    });

    await this.seedCategories(ledger.id, dto.type);
    return ledger;
  }

  async findAll(userId: string) {
    const members = await this.prisma.ledgerMember.findMany({
      where: { userId },
      include: { ledger: true },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({ ...m.ledger, role: m.role }));
  }

  async findOne(userId: string, ledgerId: string) {
    const member = await this.prisma.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId } },
      include: { ledger: true },
    });
    if (!member) throw new NotFoundException('账本不存在或无权访问');
    return { ...member.ledger, role: member.role };
  }

  async update(ledgerId: string, dto: UpdateLedgerDto) {
    return this.prisma.ledger.update({
      where: { id: ledgerId },
      data: dto,
    });
  }

  async remove(ledgerId: string) {
    await this.prisma.ledger.delete({ where: { id: ledgerId } });
    return { success: true };
  }

  // ---- 成员管理 ----

  async listMembers(ledgerId: string) {
    return this.prisma.ledgerMember.findMany({
      where: { ledgerId },
      include: {
        user: { select: { id: true, email: true, nickname: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMember(ledgerId: string, dto: AddMemberDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new NotFoundException('该邮箱未注册');

    return this.prisma.ledgerMember.upsert({
      where: { ledgerId_userId: { ledgerId, userId: user.id } },
      update: { role: dto.role },
      create: { ledgerId, userId: user.id, role: dto.role },
    });
  }

  async updateMember(ledgerId: string, userId: string, role: string) {
    return this.prisma.ledgerMember.update({
      where: { ledgerId_userId: { ledgerId, userId } },
      data: { role },
    });
  }

  async removeMember(ledgerId: string, userId: string) {
    await this.prisma.ledgerMember.delete({
      where: { ledgerId_userId: { ledgerId, userId } },
    });
    return { success: true };
  }

  // ---- 内置类别 ----

  private async seedCategories(ledgerId: string, type: string) {
    if (type === 'loan') {
      const data = LOAN_CATEGORIES.map((c, i) => ({
        ledgerId,
        name: c.name,
        type: c.type,
        sortOrder: i,
        isBuiltin: true,
      }));
      await this.prisma.category.createMany({ data });
      return;
    }

    const expense = DAILY_EXPENSE_CATEGORIES.map((name, i) => ({
      ledgerId,
      name,
      type: 'expense',
      sortOrder: i,
      isBuiltin: true,
    }));
    const income = DAILY_INCOME_CATEGORIES.map((name, i) => ({
      ledgerId,
      name,
      type: 'income',
      sortOrder: i,
      isBuiltin: true,
    }));
    await this.prisma.category.createMany({ data: [...expense, ...income] });
  }
}
