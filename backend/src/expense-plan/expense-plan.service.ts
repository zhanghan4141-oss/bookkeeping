import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateExpensePlanDto,
  MarkPeriodDto,
  UpdateExpensePlanDto,
  UpdateExpensePlanPeriodsDto,
} from './dto/expense-plan.dto.js';
import {
  Frequency,
  generatePlanPeriods,
  periodDueDate,
} from './expense-plan-calculator.js';

const UNLIMITED_DEFAULT = 120; // 期数 0（不限）MVP 生成 120 期
const DAY_MS = 24 * 60 * 60 * 1000;

/** 日期/时间戳 → YYYY-MM-DD（本地 DATE 与 UTC 口径一致） */
const fmtDay = (d: Date | string): string => {
  const x = typeof d === 'string' ? new Date(`${d}T00:00:00`) : d;
  return x.toISOString().slice(0, 10);
};

/** 今天（本地日期）的 UTC 午夜：避免 DATE 序列化偏移一天 */
const todayMidnight = (): Date => {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return new Date(`${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`);
};

@Injectable()
export class ExpensePlanService {
  constructor(private readonly prisma: PrismaService) {}

  /** 创建支出计划：创建计划 + 全部期 + 全部期支出流水（创建即生成流水，镜像贷款） */
  async create(userId: string, dto: CreateExpensePlanDto) {
    const name = dto.name.trim();
    await this.assertNameUnique(dto.ledgerId, name);
    await this.assertCategoryForLedger(dto.ledgerId, dto.categoryId);

    const entries = generatePlanPeriods({
      startDate: dto.startDate,
      frequency: dto.frequency,
      day: dto.day,
      periodAmount: dto.periodAmount,
      termCount: dto.termCount,
    });

    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.expensePlan.create({
        data: {
          ledgerId: dto.ledgerId,
          categoryId: dto.categoryId,
          name,
          periodAmount: new Prisma.Decimal(dto.periodAmount),
          termCount: dto.termCount,
          frequency: dto.frequency,
          startDate: new Date(dto.startDate),
          day: dto.day,
          note: dto.note,
        },
      });
      for (const p of entries) {
        const period = await tx.expensePlanPeriod.create({
          data: {
            planId: created.id,
            periodNo: p.periodNo,
            dueDate: p.dueDate,
            amount: new Prisma.Decimal(p.amount),
          },
        });
        await tx.transaction.create({
          data: {
            ledgerId: dto.ledgerId,
            categoryId: dto.categoryId,
            userId,
            type: 'expense',
            amount: new Prisma.Decimal(p.amount),
            note: this.noteWithPlan(name, p.periodNo, dto.note),
            occurredAt: p.dueDate,
            expensePlanId: created.id,
            expensePlanPeriodId: period.id,
          },
        });
      }
      return tx.expensePlan.findUnique({
        where: { id: created.id },
        include: { periods: { orderBy: { periodNo: 'asc' } } },
      });
    });

    if (!plan) throw new NotFoundException('支出计划创建失败');
    return this.withDerived(plan);
  }

  /**
   * 标记已支出（镜像贷款 pay，支持提前支出）。
   * - 更新计划期状态 + 流水金额/时间（时间同步到 paidDate/今天）；
   * - applyToFuture：将该实际金额同步到后续未支出期（计划金额跟随实际）。
   */
  async mark(planId: string, periodNo: number, dto: MarkPeriodDto) {
    const period = await this.prisma.expensePlanPeriod.findUnique({
      where: { planId_periodNo: { planId, periodNo } },
    });
    if (!period) throw new NotFoundException('支出期不存在');
    if (period.status === 'paid') throw new BadRequestException('该期已标记支出');

    const paidDate = dto.paidDate ? new Date(dto.paidDate) : todayMidnight();
    if (paidDate > new Date()) {
      throw new BadRequestException('支出日期不能晚于今天');
    }
    const amount = dto.amount ?? Number(period.amount);
    const baseAmount = Number(period.amount);

    await this.prisma.$transaction(async (tx) => {
      // 本期计划金额跟随实际支出额（计划反映真实情况）
      await tx.expensePlanPeriod.update({
        where: { id: period.id },
        data: { status: 'paid', paidDate, amount: new Prisma.Decimal(amount) },
      });
      await tx.transaction.updateMany({
        where: { expensePlanPeriodId: period.id },
        data: { amount: new Prisma.Decimal(amount), occurredAt: paidDate },
      });
      if (dto.applyToFuture && dto.amount !== undefined && dto.amount !== baseAmount) {
        // 同步后续未支出期金额 + 计划基准金额（计划金额跟随实际）
        await tx.expensePlan.update({
          where: { id: planId },
          data: { periodAmount: new Prisma.Decimal(dto.amount) },
        });
        const future = await tx.expensePlanPeriod.findMany({
          where: { planId, status: 'pending', periodNo: { gt: periodNo } },
          select: { id: true },
        });
        if (future.length > 0) {
          await tx.expensePlanPeriod.updateMany({
            where: { planId, status: 'pending', periodNo: { gt: periodNo } },
            data: { amount: new Prisma.Decimal(dto.amount) },
          });
          await tx.transaction.updateMany({
            where: { expensePlanPeriodId: { in: future.map((f) => f.id) } },
            data: { amount: new Prisma.Decimal(dto.amount) },
          });
        }
      }
    });

    await this.recalcPlanStatus(planId);
    return this.findOne(planId);
  }

  /** 撤销支出（镜像贷款 undo）：期恢复待支出，金额恢复计划基准，流水时间恢复为该期到期日 */
  async undo(planId: string, periodNo: number) {
    const plan = await this.findPlanEntity(planId);
    const period = await this.prisma.expensePlanPeriod.findUnique({
      where: { planId_periodNo: { planId, periodNo } },
    });
    if (!period) throw new NotFoundException('支出期不存在');
    if (period.status !== 'paid') throw new BadRequestException('该期尚未标记支出');

    await this.prisma.$transaction(async (tx) => {
      await tx.expensePlanPeriod.update({
        where: { id: period.id },
        data: { status: 'pending', paidDate: null, amount: plan.periodAmount },
      });
      await tx.transaction.updateMany({
        where: { expensePlanPeriodId: period.id },
        data: { amount: plan.periodAmount, occurredAt: period.dueDate },
      });
    });

    await this.recalcPlanStatus(planId);
    return this.findOne(planId);
  }

  /**
   * 编辑支出计划（与贷款 updateRepayments 同规则：流水随计划同步，已标记期及其流水永不改动）。
   * 已标记期不可删除/不可改；未标记期（及流水）按新参数删除重建。
   * status=closed：保留已支出期流水，删除全部未标记期及其未来流水。
   */
  async update(userId: string, id: string, dto: UpdateExpensePlanDto) {
    const existing = await this.prisma.expensePlan.findUnique({
      where: { id },
      include: { periods: { orderBy: { periodNo: 'asc' } } },
    });
    if (!existing) throw new NotFoundException('支出计划不存在');
    if (dto.name !== undefined) await this.assertNameUnique(existing.ledgerId, dto.name.trim(), id);
    if (dto.categoryId !== undefined) await this.assertCategoryForLedger(existing.ledgerId, dto.categoryId);

    const paidPeriods = existing.periods.filter((p) => p.status === 'paid');
    const paidCount = paidPeriods.length;
    const nextTermCount = dto.termCount ?? existing.termCount;
    if (nextTermCount > 0 && nextTermCount < paidCount) {
      throw new BadRequestException(
        `已标记支出的期数为 ${paidCount}，期数不能小于该值，请先撤销支出再缩减期数`,
      );
    }

    const closePlan = dto.status === 'closed';
    const scheduleChanged =
      dto.periodAmount !== undefined ||
      dto.frequency !== undefined ||
      dto.startDate !== undefined ||
      dto.day !== undefined ||
      dto.termCount !== undefined ||
      dto.categoryId !== undefined;

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.ExpensePlanUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name.trim();
      if (dto.categoryId !== undefined) data.category = { connect: { id: dto.categoryId } };
      if (dto.periodAmount !== undefined) data.periodAmount = new Prisma.Decimal(dto.periodAmount);
      if (dto.frequency !== undefined) data.frequency = dto.frequency;
      if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
      if (dto.day !== undefined) data.day = dto.day;
      if (dto.termCount !== undefined) data.termCount = dto.termCount;
      if (dto.note !== undefined) data.note = dto.note;
      if (dto.status !== undefined) data.status = dto.status;
      await tx.expensePlan.update({ where: { id }, data });

      const unpaid = existing.periods.filter((p) => p.status !== 'paid');

      if (closePlan) {
        // 关闭 = 清未来期：保留已支出期流水，删除未标记期及其未来流水
        await this.removeUnpaidSchedule(tx, unpaid);
      } else if (scheduleChanged) {
        await this.removeUnpaidSchedule(tx, unpaid);
        const startDate = dto.startDate ?? fmtDay(existing.startDate);
        const frequency = dto.frequency ?? (existing.frequency as Frequency);
        const day = dto.day ?? existing.day;
        const amount = dto.periodAmount ?? Number(existing.periodAmount);
        const categoryId = dto.categoryId ?? existing.categoryId;
        let unpaidCount: number;
        if (nextTermCount > 0) {
          unpaidCount = Math.max(0, nextTermCount - paidCount);
        } else {
          unpaidCount = unpaid.length > 0 ? unpaid.length : Math.max(0, UNLIMITED_DEFAULT - paidCount);
        }
        if (unpaidCount > 0) {
          const lastPaidDue = paidCount > 0
            ? paidPeriods.reduce((max, p) => (p.dueDate > max ? p.dueDate : max), paidPeriods[0].dueDate)
            : null;
          let prevDue = lastPaidDue;
          const planName = dto.name !== undefined ? dto.name.trim() : existing.name;
          const planNote = dto.note !== undefined ? dto.note : existing.note;
          for (let i = 1; i <= unpaidCount; i++) {
            const periodNo = paidCount + i;
            let due = periodDueDate(startDate, frequency, day, periodNo);
            // 单调守卫：新期到期日需晚于前一期待到期日
            if (prevDue && due <= prevDue) due = new Date(prevDue.getTime() + DAY_MS);
            prevDue = due;
            const period = await tx.expensePlanPeriod.create({
              data: {
                planId: id,
                periodNo,
                dueDate: due,
                amount: new Prisma.Decimal(amount),
              },
            });
            await tx.transaction.create({
              data: {
                ledgerId: existing.ledgerId,
                categoryId,
                userId,
                type: 'expense',
                amount: new Prisma.Decimal(amount),
                note: this.noteWithPlan(planName, periodNo, planNote),
                occurredAt: due,
                expensePlanId: id,
                expensePlanPeriodId: period.id,
              },
            });
          }
        }
      }
    });

    await this.recalcPlanStatus(id);
    return this.findOne(id);
  }

  /**
   * 逐期编辑（镜像贷款 updateRepayments）：已支出期不可改日期/金额（可撤销后改）；
   * 未支出期更新日期/金额并同步对应流水（occurredAt/amount）。
   */
  async updatePeriods(id: string, periods: UpdateExpensePlanPeriodsDto['periods']) {
    const plan = await this.prisma.expensePlan.findUnique({
      where: { id },
      include: { periods: { orderBy: { periodNo: 'asc' } } },
    });
    if (!plan) throw new NotFoundException('支出计划不存在');
    if (periods.length !== plan.periods.length) {
      throw new BadRequestException(`期数不匹配：需要 ${plan.periods.length} 期`);
    }
    await this.prisma.$transaction(async (tx) => {
      let prevDue: Date | null = null;
      for (const p of periods) {
        const orig = plan.periods.find((x) => x.periodNo === p.periodNo);
        if (!orig) throw new BadRequestException(`第${p.periodNo}期不存在`);
        let effDue = new Date(p.dueDate);
        if (prevDue && effDue <= prevDue) {
          effDue = new Date(prevDue.getTime() + DAY_MS);
        }
        prevDue = effDue;
        const amount = new Prisma.Decimal(p.amount);
        // 操作过（已支出且提前标记）→ 只改计划行，流水冻结；一致/未支出 → 流水同步
        const diverged =
          orig.status === 'paid' &&
          orig.paidDate != null &&
          fmtDay(orig.paidDate) !== fmtDay(orig.dueDate);
        await tx.expensePlanPeriod.update({
          where: { id: orig.id },
          data: { dueDate: effDue, amount },
        });
        if (!diverged) {
          await tx.transaction.updateMany({
            where: { expensePlanPeriodId: orig.id },
            data: { occurredAt: effDue, amount },
          });
        }
      }
    });
    await this.recalcPlanStatus(id);
    return this.findOne(id);
  }

  /** 删除支出计划：清理流水 + 期 + 计划（类别保留） */
  async remove(id: string) {
    const plan = await this.findPlanEntity(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.deleteMany({ where: { expensePlanId: id } });
      await tx.expensePlanPeriod.deleteMany({ where: { planId: id } });
      await tx.expensePlan.delete({ where: { id } });
    });
    return { id: plan.id };
  }

  async findAll(ledgerId: string) {
    // 到期自动已支出（镜像贷款 autoSettleExpired：到期日已过的未支出期自动记为已支出）
    await this.autoMarkExpiredByLedger(ledgerId);
    const plans = await this.prisma.expensePlan.findMany({
      where: { ledgerId },
      include: { category: { select: { id: true, name: true } }, periods: { orderBy: { periodNo: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return plans.map((p) => this.withDerived(p));
  }

  async findOne(id: string) {
    await this.autoMarkExpired(id);
    const plan = await this.prisma.expensePlan.findUnique({
      where: { id },
      include: { category: { select: { id: true, name: true } }, periods: { orderBy: { periodNo: 'asc' } } },
    });
    if (!plan) throw new NotFoundException('支出计划不存在');
    return this.withDerived(plan);
  }

  /** 到期自动已支出：到期日已过的未支出期置为已支出（paidDate=到期日，流水时间本就在该日） */
  private async autoMarkExpired(planId: string) {
    const today = todayMidnight();
    await this.prisma.$executeRaw`
      UPDATE \`ExpensePlanPeriod\`
      SET \`status\` = 'paid', \`paidDate\` = \`dueDate\`
      WHERE \`planId\` = ${planId} AND \`dueDate\` < ${today} AND \`status\` = 'pending'
    `;
  }

  private async autoMarkExpiredByLedger(ledgerId: string) {
    const today = todayMidnight();
    await this.prisma.$executeRaw`
      UPDATE \`ExpensePlanPeriod\` p
      JOIN \`ExpensePlan\` e ON e.\`id\` = p.\`planId\`
      SET p.\`status\` = 'paid', p.\`paidDate\` = p.\`dueDate\`
      WHERE e.\`ledgerId\` = ${ledgerId} AND p.\`dueDate\` < ${today} AND p.\`status\` = 'pending'
    `;
  }

  /** 导出支出计划 Excel（镜像导出还款计划） */
  async exportPlan(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const plan = await this.prisma.expensePlan.findUnique({
      where: { id },
      include: { periods: { orderBy: { periodNo: 'asc' } } },
    });
    if (!plan) throw new NotFoundException('支出计划不存在');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('支出计划');
    sheet.columns = [
      { header: '期数', key: 'periodNo', width: 10 },
      { header: '到期日', key: 'dueDate', width: 15 },
      { header: '金额', key: 'amount', width: 15, style: { numFmt: '0.00' } },
      { header: '状态', key: 'status', width: 12 },
    ];
    for (const p of plan.periods) {
      sheet.addRow({
        periodNo: p.periodNo,
        dueDate: fmtDay(p.dueDate),
        amount: Number(p.amount),
        status: p.status === 'paid' ? '已支出' : '待支出',
      });
    }
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    return { buffer, filename: `${plan.name}_支出计划.xlsx` };
  }

  /** 附加派生统计：总期数 / 已支出期数 / 已支出金额 / 待支出金额 */
  private withDerived(plan: {
    periods: { status: string; amount: Prisma.Decimal; dueDate: Date; paidDate: Date | null }[];
  }) {
    const periods = plan.periods.map((p) => ({
      ...p,
      // 操作过：已支出且实际日期偏离到期日（提前标记）
      diverged:
        p.status === 'paid' &&
        p.paidDate != null &&
        fmtDay(p.paidDate) !== fmtDay(p.dueDate),
    }));
    const paid = periods.filter((p) => p.status === 'paid');
    const paidCount = paid.length;
    const totalPaid = paid.reduce((s, p) => s + Number(p.amount), 0);
    const totalRemaining = periods
      .filter((p) => p.status !== 'paid')
      .reduce((s, p) => s + Number(p.amount), 0);
    return {
      ...plan,
      periods,
      totalCount: periods.length,
      paidCount,
      pendingCount: periods.length - paidCount,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalRemaining: Math.round(totalRemaining * 100) / 100,
    };
  }

  /** 删除未标记期及其流水（已标记期不受影响） */
  private async removeUnpaidSchedule(
    tx: Prisma.TransactionClient,
    unpaid: { id: string }[],
  ) {
    if (unpaid.length === 0) return;
    const ids = unpaid.map((p) => p.id);
    await tx.transaction.deleteMany({ where: { expensePlanPeriodId: { in: ids } } });
    await tx.expensePlanPeriod.deleteMany({ where: { id: { in: ids } } });
  }

  /** 状态推进：全期已支出（且期数固定）→ completed；手动 closed 保持；否则 active */
  private async recalcPlanStatus(planId: string) {
    const plan = await this.prisma.expensePlan.findUnique({
      where: { id: planId },
      include: { periods: { select: { status: true } } },
    });
    if (!plan || plan.status === 'closed') return;
    const allPaid = plan.periods.length > 0 && plan.periods.every((p) => p.status === 'paid');
    const next = allPaid && plan.termCount > 0 ? 'completed' : 'active';
    if (next !== plan.status) {
      await this.prisma.expensePlan.update({ where: { id: planId }, data: { status: next } });
    }
  }

  private async assertNameUnique(ledgerId: string, name: string, excludeId?: string) {
    const trimmed = name.trim();
    const existing = await this.prisma.expensePlan.findFirst({
      where: { ledgerId, name: trimmed, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (existing) throw new BadRequestException('该账本下已存在同名支出计划');
  }

  private async assertCategoryForLedger(ledgerId: string, categoryId: string) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category || category.ledgerId !== ledgerId || category.type !== 'expense') {
      throw new BadRequestException('支出类别无效');
    }
  }

  private noteWithPlan(name: string, periodNo: number, planNote?: string | null): string {
    const base = `${name} 第${periodNo}期`;
    const t = planNote?.trim();
    return t ? `${base}（${t}）`.slice(0, 191) : base;
  }

  async findPlanEntity(id: string) {
    const plan = await this.prisma.expensePlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('支出计划不存在');
    return plan;
  }
}