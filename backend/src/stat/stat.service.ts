import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { periodKey } from './lunar.util.js';
import type { SummaryQueryDto } from './dto/stat.dto.js';

type Calendar = 'solar' | 'lunar';
type Period = 'month' | 'year';

@Injectable()
export class StatService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 统计：收入、支出（含已还贷款利息）、盈余、类别分布、趋势。
   */
  async summary(userId: string, ledgerIds: string[], query: SummaryQueryDto) {
    const period: Period = query.period ?? 'month';
    const calendar: Calendar = query.calendar ?? 'solar';

    // 校验账本权限，过滤出可访问的
    const accessible = await this.filterAccessible(userId, ledgerIds);
    if (accessible.length === 0) {
      return this.emptyResult(period, calendar);
    }

    // 流水
    const transactions = await this.prisma.transaction.findMany({
      where: { ledgerId: { in: accessible } },
      include: {
        category: { select: { id: true, name: true, type: true, color: true, icon: true } },
      },
      orderBy: { occurredAt: 'asc' },
    });

    // 已还贷款利息（计入支出）—— 只取有还款记录的
    const paidRepayments = await this.prisma.loanRepayment.findMany({
      where: {
        paidAmount: { gt: 0 },
        loan: { ledgerId: { in: accessible } },
      },
      include: {
        loan: { select: { id: true, name: true, ledgerId: true, direction: true } },
      },
    });

    // 收支累计
    let totalIncome = 0;
    let totalExpense = 0;
    const byCategory = new Map<
      string,
      { categoryId: string; name: string; type: string; color?: string | null; icon?: string | null; amount: number }
    >();
    const trend = new Map<
      string,
      { key: string; income: number; expense: number }
    >();

    const addTrend = (date: Date, income: number, expense: number) => {
      const key = periodKey(date, period, calendar);
      if (!trend.has(key)) trend.set(key, { key, income: 0, expense: 0 });
      const t = trend.get(key)!;
      t.income += income;
      t.expense += expense;
    };

    for (const tx of transactions) {
      const amount = Number(tx.amount);
      if (tx.type === 'income') {
        totalIncome += amount;
        addTrend(tx.occurredAt, amount, 0);
      } else if (tx.type === 'expense') {
        totalExpense += amount;
        addTrend(tx.occurredAt, 0, amount);
      }
      // transfer 不参与收支统计

      if (tx.category) {
        const key = tx.category.id;
        if (!byCategory.has(key)) {
          byCategory.set(key, {
            categoryId: tx.category.id,
            name: tx.category.name,
            type: tx.category.type,
            color: tx.category.color,
            icon: tx.category.icon,
            amount: 0,
          });
        }
        byCategory.get(key)!.amount += tx.type === 'transfer' ? 0 : amount;
      }
    }

    // 利息支出（口径：已还利息计入支出，本金不计）
    for (const r of paidRepayments) {
      const paidRatio = Number(r.paidAmount) / Math.max(Number(r.totalAmount), 1);
      const interestPaid = Number(r.interestAmount) * paidRatio;
      if (interestPaid <= 0) continue;
      totalExpense += interestPaid;
      const paidDate = r.paidDate ?? r.dueDate;
      addTrend(paidDate, 0, interestPaid);

      const categoryKey = `loan-interest:${r.loan.id}`;
      if (!byCategory.has(categoryKey)) {
        byCategory.set(categoryKey, {
          categoryId: categoryKey,
          name: `${r.loan.name}利息`,
          type: 'expense',
          color: null,
          icon: null,
          amount: 0,
        });
      }
      byCategory.get(categoryKey)!.amount += interestPaid;
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const trendList = Array.from(trend.values()).sort((a, b) =>
      a.key.localeCompare(b.key),
    );
    const categoryList = Array.from(byCategory.values())
      .map((c) => ({ ...c, amount: round(c.amount) }))
      .sort((a, b) => b.amount - a.amount);

    return {
      period,
      calendar,
      totalIncome: round(totalIncome),
      totalExpense: round(totalExpense),
      surplus: round(totalIncome - totalExpense),
      byCategory: categoryList,
      trend: trendList.map((t) => ({
        key: t.key,
        income: round(t.income),
        expense: round(t.expense),
      })),
    };
  }

  /** 过滤出用户可访问的账本 id */
  private async filterAccessible(userId: string, ledgerIds: string[]): Promise<string[]> {
    const members = await this.prisma.ledgerMember.findMany({
      where: {
        userId,
        ledgerId: ledgerIds.length ? { in: ledgerIds } : undefined,
      },
      select: { ledgerId: true },
    });
    return members.map((m) => m.ledgerId);
  }

  private emptyResult(period: Period, calendar: Calendar) {
    return {
      period,
      calendar,
      totalIncome: 0,
      totalExpense: 0,
      surplus: 0,
      byCategory: [],
      trend: [],
    };
  }
}
