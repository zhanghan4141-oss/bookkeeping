import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { lunarYearMonthOf, periodKey } from './lunar.util.js';
import type { SummaryQueryDto } from './dto/stat.dto.js';

type Calendar = 'solar' | 'lunar';
type Period = 'day' | 'month' | 'year';

/** 根据日期范围跨度确定趋势粒度：跨年→年，跨月→月，否则→日（按所选历法判断） */
function determineGranularity(
  startStr: string,
  endStr: string,
  calendar: Calendar,
): Period {
  if (calendar === 'lunar') {
    const s = lunarYearMonthOf(new Date(`${startStr}T00:00:00`));
    const e = lunarYearMonthOf(new Date(`${endStr}T00:00:00`));
    if (s.year !== e.year) return 'year';
    if (s.month !== e.month) return 'month';
    return 'day';
  }
  const start = new Date(`${startStr}T00:00:00`);
  const end = new Date(`${endStr}T00:00:00`);
  if (start.getFullYear() !== end.getFullYear()) return 'year';
  if (start.getMonth() !== end.getMonth()) return 'month';
  return 'day';
}

@Injectable()
export class StatService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 统计：收入、支出、盈余、类别分布、趋势。
   * 口径：全景收支，统计区间内的所有流水（含未来待支出与待还款）。
   * 贷款相关流水（放款收入、还款本金、还款利息）已随贷款创建/还款写入流水，直接按流水统计。
   * @param date 可选，指定统计周期：period=month 时为 YYYY-MM，period=year 时为 YYYY；缺省统计全部
   */
  async summary(userId: string, ledgerIds: string[], query: SummaryQueryDto) {
    const calendar: Calendar = query.calendar ?? 'solar';

    // 校验账本权限，过滤出可访问的
    const accessible = await this.filterAccessible(userId, ledgerIds);
    if (accessible.length === 0) {
      return this.emptyResult('month', calendar);
    }

    // 日期范围过滤 + 确定趋势粒度
    // 全景口径：默认不设时间上限，统计区间内所有流水（含未来待支出/待还款）
    const where: Prisma.TransactionWhereInput = {
      ledgerId: { in: accessible },
    };

    let period: Period = query.period ?? 'month';

    if (query.startDate && query.endDate) {
      // 自定义起止日期（含结束当天）
      const start = new Date(`${query.startDate}T00:00:00`);
      const end = new Date(`${query.endDate}T00:00:00`);
      end.setDate(end.getDate() + 1);
      where.occurredAt = { gte: start, lt: end };
      period = determineGranularity(query.startDate, query.endDate, calendar);
    } else if (query.date && calendar === 'solar') {
      // 旧逻辑：按月/按年 + 参考日期
      if (period === 'month' && /^\d{4}-\d{2}$/.test(query.date)) {
        const start = new Date(`${query.date}-01T00:00:00`);
        const end = new Date(start);
        end.setMonth(end.getMonth() + 1);
        where.occurredAt = { gte: start, lt: end };
      } else if (period === 'year' && /^\d{4}$/.test(query.date)) {
        const start = new Date(`${query.date}-01-01T00:00:00`);
        const end = new Date(`${Number(query.date) + 1}-01-01T00:00:00`);
        where.occurredAt = { gte: start, lt: end };
      }
    }

    // 流水（含未来待支出/待还款）
    const transactions = await this.prisma.transaction.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, type: true, color: true, icon: true } },
      },
      orderBy: { occurredAt: 'asc' },
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

  /** 每个账本的收支结余汇总（账本列表用），支持当日/当月/当年/所有（仅已发生，不含未来） */
  async ledgerSummaries(
    userId: string,
    period: 'day' | 'month' | 'year' | 'all',
  ) {
    const now = new Date();
    // 已发生口径：仅统计今天整天及之前（不含未来）
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const where: Prisma.TransactionWhereInput = {
      occurredAt: { lt: tomorrow },
    };

    if (period === 'day') {
      where.occurredAt = {
        gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        lt: tomorrow,
      };
    } else if (period === 'month') {
      where.occurredAt = {
        gte: new Date(now.getFullYear(), now.getMonth(), 1),
        lt: tomorrow,
      };
    } else if (period === 'year') {
      where.occurredAt = {
        gte: new Date(now.getFullYear(), 0, 1),
        lt: tomorrow,
      };
    }
    // all：仅 lt: tomorrow（今天及之前）

    const members = await this.prisma.ledgerMember.findMany({
      where: { userId },
      select: { ledgerId: true },
    });
    const accessibleIds = members.map((m) => m.ledgerId);

    const transactions = await this.prisma.transaction.findMany({
      where: { ...where, ledgerId: { in: accessibleIds } },
      select: { ledgerId: true, type: true, amount: true },
    });

    const map = new Map<string, { income: number; expense: number }>();
    for (const tx of transactions) {
      const entry = map.get(tx.ledgerId) ?? { income: 0, expense: 0 };
      if (tx.type === 'income') entry.income += Number(tx.amount);
      else if (tx.type === 'expense') entry.expense += Number(tx.amount);
      map.set(tx.ledgerId, entry);
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    return accessibleIds.map((ledgerId) => {
      const e = map.get(ledgerId) ?? { income: 0, expense: 0 };
      return {
        ledgerId,
        income: round(e.income),
        expense: round(e.expense),
        surplus: round(e.income - e.expense),
      };
    });
  }

  /** 账本页顶部矩阵：当日/当月/当年/所有 四个维度的所有账本合计 */
  async overview(userId: string): Promise<
    Record<'day' | 'month' | 'year' | 'all', { income: number; expense: number; surplus: number }>
  > {
    const round = (n: number) => Math.round(n * 100) / 100;
    const periods = ['day', 'month', 'year', 'all'] as const;
    const result = {
      day: { income: 0, expense: 0, surplus: 0 },
      month: { income: 0, expense: 0, surplus: 0 },
      year: { income: 0, expense: 0, surplus: 0 },
      all: { income: 0, expense: 0, surplus: 0 },
    };

    for (const period of periods) {
      const list = await this.ledgerSummaries(userId, period);
      let income = 0;
      let expense = 0;
      for (const s of list) {
        income += s.income;
        expense += s.expense;
      }
      result[period] = {
        income: round(income),
        expense: round(expense),
        surplus: round(income - expense),
      };
    }
    return result;
  }

  /** 某类别在区间内的流水明细（统计页类别列表点开用） */
  async categoryTransactions(
    userId: string,
    categoryId: string,
    startDate: string,
    endDate: string,
    ledgerIds: string[],
  ) {
    const accessible = await this.filterAccessible(userId, ledgerIds);
    if (accessible.length === 0) return [];
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    end.setDate(end.getDate() + 1);
    return this.prisma.transaction.findMany({
      where: {
        categoryId,
        ledgerId: { in: accessible },
        occurredAt: { gte: start, lt: end },
      },
      include: {
        category: { select: { id: true, name: true, icon: true, color: true, type: true } },
        ledger: { select: { id: true, name: true } },
        loan: { select: { id: true, name: true } },
      },
      orderBy: { occurredAt: 'desc' },
    });
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
