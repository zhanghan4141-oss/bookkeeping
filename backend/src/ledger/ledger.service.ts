import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  { name: '贷款', type: 'income' },
];

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateLedgerDto) {
    // 账本 + 成员 + 内置类别 原子写入，避免账本已创建但类别缺失
    return this.prisma.$transaction(async (tx) => {
      const ledger = await tx.ledger.create({
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

      await this.seedCategories(ledger.id, dto.type, tx);
      return ledger;
    });
  }

  async findAll(userId: string) {
    const members = await this.prisma.ledgerMember.findMany({
      where: { userId },
      include: {
        ledger: { include: { _count: { select: { members: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      ...m.ledger,
      role: m.role,
      memberCount: m.ledger._count.members,
    }));
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
    if (role === 'owner') {
      throw new BadRequestException('所有权只能通过转让产生，不能直接设置 owner');
    }
    return this.prisma.ledgerMember.update({
      where: { ledgerId_userId: { ledgerId, userId } },
      data: { role },
    });
  }

  async removeMember(ledgerId: string, userId: string) {
    const member = await this.prisma.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId } },
    });
    if (!member) throw new NotFoundException('成员不存在');
    if (member.role === 'owner') {
      throw new BadRequestException('账本所有者不能被移除，请先转让所有权');
    }
    await this.prisma.ledgerMember.delete({ where: { ledgerId_userId: { ledgerId, userId } } });
    return { success: true };
  }

  /**
   * 转让所有权（原子双写，账本始终恰一名 owner；原 owner 自动变为 editor）。
   * @param operatorUserId 操作者（当前 owner），用于审计记录
   */
  async transferOwner(ledgerId: string, newOwnerUserId: string, operatorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const owner = await tx.ledgerMember.findFirst({
        where: { ledgerId, role: 'owner' },
      });
      if (!owner) throw new NotFoundException('账本不存在或暂无所有者');
      if (owner.userId === newOwnerUserId) {
        throw new BadRequestException('不能转让给自己');
      }
      const target = await tx.ledgerMember.findUnique({
        where: { ledgerId_userId: { ledgerId, userId: newOwnerUserId } },
      });
      if (!target) throw new BadRequestException('目标用户不是该账本成员');

      await tx.ledgerMember.update({
        where: { id: owner.id },
        data: { role: 'editor' },
      });
      await tx.ledgerMember.update({
        where: { id: target.id },
        data: { role: 'owner' },
      });

      // 明确的转让审计记录（比两条 generic member update 更可追溯账本易主历史）
      try {
        await tx.auditLog.create({
          data: {
            ledgerId,
            userId: operatorUserId,
            action: 'transfer_owner',
            entity: 'LedgerMember',
            entityId: ledgerId,
            summary: `转让账本所有权：${owner.userId} → ${newOwnerUserId}`,
            before: JSON.stringify({ from: owner.userId, to: newOwnerUserId }),
          },
        });
      } catch {
        // 审计失败不影响转让
      }
    });
    return this.listMembers(ledgerId);
  }

  /** 成员自行退出账本（owner 不可退出，需先转让所有权） */
  async leaveLedger(ledgerId: string, userId: string) {
    const member = await this.prisma.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId } },
    });
    if (!member) throw new NotFoundException('不在该账本中');
    if (member.role === 'owner') {
      throw new BadRequestException('账本所有者不能退出账本，请先转让所有权');
    }
    await this.prisma.ledgerMember.delete({ where: { id: member.id } });
    return { success: true };
  }

  // ---- 内置类别 ----

  private async seedCategories(
    ledgerId: string,
    type: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    if (type === 'loan') {
      const data = LOAN_CATEGORIES.map((c, i) => ({
        ledgerId,
        name: c.name,
        type: c.type,
        sortOrder: i,
        isBuiltin: true,
      }));
      await db.category.createMany({ data });
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
    await db.category.createMany({ data: [...expense, ...income] });
  }
}
