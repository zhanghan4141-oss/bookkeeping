import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RepaymentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 未来 N 天每日需还金额汇总。
   * 只统计用户有权访问的账本中的贷款，且还款状态为 pending/partial。
   */
  async upcoming(userId: string, days: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + days);

    // 用户可访问的账本
    const members = await this.prisma.ledgerMember.findMany({
      where: { userId },
      select: { ledgerId: true },
    });
    const ledgerIds = members.map((m) => m.ledgerId);

    const repayments = await this.prisma.loanRepayment.findMany({
      where: {
        dueDate: { gte: today, lte: end },
        status: { in: ['pending', 'partial'] },
        loan: { ledgerId: { in: ledgerIds } },
      },
      include: {
        loan: {
          select: { id: true, name: true, ledgerId: true, direction: true },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // 按日期分组汇总
    const byDate = new Map<string, { date: string; total: number; items: any[] }>();
    for (const r of repayments) {
      const key = (r.dueDate as Date).toISOString().slice(0, 10);
      const remain = Number(r.totalAmount) - Number(r.paidAmount);
      if (!byDate.has(key)) {
        byDate.set(key, { date: key, total: 0, items: [] });
      }
      const group = byDate.get(key)!;
      group.total += remain;
      group.items.push({
        repaymentId: r.id,
        loanId: r.loan.id,
        loanName: r.loan.name,
        direction: r.loan.direction,
        periodNo: r.periodNo,
        remain: Math.round(remain * 100) / 100,
        status: r.status,
      });
    }

    const result = Array.from(byDate.values()).map((g) => ({
      ...g,
      total: Math.round(g.total * 100) / 100,
    }));
    result.sort((a, b) => a.date.localeCompare(b.date));

    return {
      days,
      totalAmount: Math.round(result.reduce((s, g) => s + g.total, 0) * 100) / 100,
      daily: result,
    };
  }
}
