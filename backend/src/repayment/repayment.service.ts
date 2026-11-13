import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RepaymentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 未来 N 天每日需还金额汇总 + 待支出汇总。
   * - 待还款：贷款账本中，还款状态为 pending/partial 的计划
   * - 待支出：普通账本（非贷款）中，未来日期的支出流水
   * @param ledgerIds 可选，指定要统计的账本 id；缺省统计用户所有账本
   */
  async upcoming(userId: string, days: number, ledgerIds?: string[]) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + days);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 用户可访问的账本
    const members = await this.prisma.ledgerMember.findMany({
      where: { userId },
      select: { ledgerId: true },
    });
    const accessible = members.map((m) => m.ledgerId);

    // 交集：指定账本 ∩ 可访问账本；未指定则用全部可访问
    const targetLedgerIds = ledgerIds?.length
      ? ledgerIds.filter((id) => accessible.includes(id))
      : accessible;

    // ===== 待还款 =====
    const repayments = await this.prisma.loanRepayment.findMany({
      where: {
        dueDate: { gte: today, lte: end },
        status: { in: ['pending', 'partial'] },
        loan: { ledgerId: { in: targetLedgerIds } },
      },
      include: {
        loan: {
          select: { id: true, name: true, ledgerId: true, direction: true, principal: true, repaymentMethod: true },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // 计算每个贷款的剩余未还本金与剩余未还期数（按期还款、未还清部分）
    const loanIds = [...new Set(repayments.map((r) => r.loanId))];
    const remainingByLoan = new Map<string, { principal: number; periods: number }>();
    if (loanIds.length > 0) {
      const outstanding = await this.prisma.loanRepayment.findMany({
        where: {
          loanId: { in: loanIds },
          kind: 'period',
          status: { in: ['pending', 'partial'] },
        },
        select: {
          loanId: true,
          principalAmount: true,
          interestAmount: true,
          totalAmount: true,
          paidAmount: true,
          loan: { select: { repaymentMethod: true, principal: true } },
        },
      });
      for (const r of outstanding) {
        const entry = remainingByLoan.get(r.loanId) ?? { principal: 0, periods: 0 };
        if (r.loan.repaymentMethod !== 'custom') {
          // 非自定义：剩余本金 = Σ 各期未还本金（未还比例）
          const ratio = Number(r.paidAmount) / Math.max(Number(r.totalAmount), 1);
          entry.principal += Number(r.principalAmount) * (1 - ratio);
        }
        entry.periods += 1;
        remainingByLoan.set(r.loanId, entry);
      }

      // 自定义：剩余未还本金 = 贷款本金 − 已还本金 − 提前还款本金（与贷款详情口径一致）
      // 已还本金 = Σ 各期本金 × 还款比例（历史合并期全额当本金）；提前还款单列
      const allEntries = await this.prisma.loanRepayment.findMany({
        where: { loanId: { in: loanIds } },
        select: {
          loanId: true,
          kind: true,
          principalAmount: true,
          interestAmount: true,
          totalAmount: true,
          paidAmount: true,
          loan: { select: { repaymentMethod: true, principal: true } },
        },
      });
      for (const r of allEntries) {
        if (r.loan.repaymentMethod !== 'custom') continue;
        const entry = remainingByLoan.get(r.loanId);
        if (!entry) continue;
        const total = Number(r.totalAmount);
        const ratio = Number(r.paidAmount) / Math.max(total, 1);
        if (r.kind === 'prepay') {
          entry.principal += total;
        } else if (total > 0) {
          const P = Number(r.principalAmount);
          const I = Number(r.interestAmount);
          const base = P === 0 && I === 0 ? total : P;
          entry.principal += base * ratio;
        }
      }
      // 回填贷款本金
      for (const item of allEntries) {
        if (item.loan.repaymentMethod !== 'custom') continue;
        const entry = remainingByLoan.get(item.loanId);
        if (!entry) continue;
        entry.principal = Math.max(
          0,
          Number(item.loan.principal) - entry.principal,
        );
      }
    }

    // 按日期分组汇总
    const byDate = new Map<string, { date: string; total: number; items: any[] }>();
    for (const r of repayments) {
      const key = (r.dueDate as Date).toISOString().slice(0, 10);
      const remain = Number(r.totalAmount) - Number(r.paidAmount);
      const remaining = remainingByLoan.get(r.loanId) ?? { principal: 0, periods: 0 };
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
        totalAmount: Math.round(Number(r.totalAmount) * 100) / 100,
        remainingPrincipal: Math.round(remaining.principal * 100) / 100,
        remainingPeriods: remaining.periods,
        status: r.status,
      });
    }

    const result = Array.from(byDate.values()).map((g) => ({
      ...g,
      total: Math.round(g.total * 100) / 100,
    }));
    result.sort((a, b) => a.date.localeCompare(b.date));

    // ===== 待支出（非贷款手动记账的未来支出流水；贷款流水计入待还款，避免重复）=====
    const expenses = await this.prisma.transaction.findMany({
      where: {
        ledgerId: { in: targetLedgerIds },
        loanId: null,
        type: 'expense',
        occurredAt: { gte: tomorrow, lte: end },
      },
      include: {
        ledger: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, icon: true } },
      },
      orderBy: { occurredAt: 'asc' },
    });

    const expenseByDate = new Map<
      string,
      { date: string; total: number; items: any[] }
    >();
    for (const e of expenses) {
      const key = e.occurredAt.toISOString().slice(0, 10);
      const amount = Number(e.amount);
      if (!expenseByDate.has(key)) {
        expenseByDate.set(key, { date: key, total: 0, items: [] });
      }
      const group = expenseByDate.get(key)!;
      group.total += amount;
      group.items.push({
        transactionId: e.id,
        ledgerId: e.ledger.id,
        ledgerName: e.ledger.name,
        categoryName: e.category?.name ?? '未分类',
        categoryIcon: e.category?.icon,
        note: e.note,
        amount: Math.round(amount * 100) / 100,
      });
    }

    const expenseDaily = Array.from(expenseByDate.values()).map((g) => ({
      ...g,
      total: Math.round(g.total * 100) / 100,
    }));
    expenseDaily.sort((a, b) => a.date.localeCompare(b.date));

    return {
      days,
      // 待还款
      totalAmount: Math.round(result.reduce((s, g) => s + g.total, 0) * 100) / 100,
      daily: result,
      // 待支出
      pendingExpense: {
        totalAmount: Math.round(
          expenseDaily.reduce((s, g) => s + g.total, 0) * 100,
        ) / 100,
        daily: expenseDaily,
      },
    };
  }
}
