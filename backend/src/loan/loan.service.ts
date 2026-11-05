import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateLoanDto,
  PayRepaymentDto,
  PrepayDto,
  UpdateLoanDto,
  UpdateRepaymentsDto,
} from './dto/loan.dto.js';
import { calculateXIRR, generateRepaymentPlan } from './loan-calculator.js';
import type { RepaymentMethod } from './loan-calculator.js';

@Injectable()
export class LoanService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateLoanDto) {
    // 自定义方式：未传 customPeriods 时，按等额本息生成默认计划（后续可在还款计划编辑里改）
    let plan: ReturnType<typeof generateRepaymentPlan>;
    if (
      dto.repaymentMethod === 'custom' &&
      (!dto.customPeriods || dto.customPeriods.length === 0)
    ) {
      const equalPlan = generateRepaymentPlan({
        principal: dto.principal,
        annualRate: dto.annualRate,
        startDate: new Date(dto.startDate),
        termMonths: dto.termMonths,
        repaymentDay: dto.repaymentDay,
        method: 'equal_installment',
      });
      // 转成自定义格式：本金利息归零，总额=等额本息月供
      plan = equalPlan.map((p) => ({
        periodNo: p.periodNo,
        dueDate: p.dueDate,
        principalAmount: 0,
        interestAmount: 0,
        totalAmount: p.totalAmount,
      }));
    } else {
      plan = generateRepaymentPlan({
        principal: dto.principal,
        annualRate: dto.annualRate,
        startDate: new Date(dto.startDate),
        termMonths: dto.termMonths,
        repaymentDay: dto.repaymentDay,
        method: dto.repaymentMethod,
        customPeriods: this.toCustomPeriodDates(dto.customPeriods),
      });
    }

    const loan = await this.prisma.loan.create({
      data: {
        ledgerId: dto.ledgerId,
        name: dto.name,
        direction: dto.direction ?? 'borrow',
        principal: new Prisma.Decimal(dto.principal),
        annualRate: new Prisma.Decimal(dto.annualRate),
        startDate: new Date(dto.startDate),
        termMonths: dto.termMonths,
        repaymentDay: dto.repaymentDay,
        repaymentMethod: dto.repaymentMethod,
        note: dto.note,
        repayments: {
          create: plan.map((p) => ({
            periodNo: p.periodNo,
            dueDate: p.dueDate,
            principalAmount: new Prisma.Decimal(p.principalAmount),
            interestAmount: new Prisma.Decimal(p.interestAmount),
            totalAmount: new Prisma.Decimal(p.totalAmount),
          })),
        },
      },
      include: { repayments: { orderBy: { periodNo: 'asc' } } },
    });

    // 写流水：放款收入 + 每期本金/利息支出
    await this.writeLoanTransactions(userId, loan.id, loan.ledgerId, {
      principal: dto.principal,
      startDate: new Date(dto.startDate),
      plan,
    });

    return this.findOne(loan.id);
  }

  /**
   * 编辑还款计划（仅自定义方式）。
   * 接受完整的 customPeriods（日期+总额），重建计划 + 流水。
   * 已还的期保留 paidAmount/status/paidDate。
   */
  async updateRepayments(
    userId: string,
    loanId: string,
    dto: UpdateRepaymentsDto,
  ) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: { repayments: { orderBy: { periodNo: 'asc' } } },
    });
    if (!loan) throw new NotFoundException('贷款不存在');
    if (loan.repaymentMethod !== 'custom') {
      throw new BadRequestException('仅自定义还款方式可编辑还款计划');
    }

    const customPeriods = this.toCustomPeriodDates(dto.customPeriods);
    if (!customPeriods || customPeriods.length !== loan.termMonths) {
      throw new BadRequestException(
        `还款计划期数不匹配：需要 ${loan.termMonths} 期`,
      );
    }

    // 保留已还期的状态映射
    const paidMap = new Map(
      loan.repayments
        .filter((r) => Number(r.paidAmount) > 0)
        .map((r) => [r.periodNo, r]),
    );

    await this.prisma.$transaction(async (tx) => {
      // 删除旧流水 + 旧计划
      await tx.transaction.deleteMany({ where: { loanId } });
      await tx.loanRepayment.deleteMany({ where: { loanId } });

      // 重建计划（保留已还期状态）
      await tx.loanRepayment.createMany({
        data: customPeriods.map((p, i) => {
          const periodNo = i + 1;
          const paid = paidMap.get(periodNo);
          const totalAmount = p.totalAmount;
          // 若该期已还，且新的总额小于已还金额，则报错
          if (paid && Number(paid.paidAmount) > totalAmount + 0.005) {
            throw new BadRequestException(
              `第${periodNo}期已还 ${paid.paidAmount} 元，不能小于已还金额`,
            );
          }
          return {
            loanId,
            periodNo,
            dueDate: p.dueDate,
            principalAmount: new Prisma.Decimal(0),
            interestAmount: new Prisma.Decimal(0),
            totalAmount: new Prisma.Decimal(totalAmount),
            paidAmount: paid ? paid.paidAmount : new Prisma.Decimal(0),
            status: paid
              ? Number(paid.paidAmount) >= totalAmount - 0.005
                ? 'paid'
                : 'partial'
              : 'pending',
            paidDate: paid ? paid.paidDate : null,
          };
        }),
      });

      // 写新流水（放款收入 + 每期还款总额）
      await this.writeLoanTransactions(
        userId,
        loanId,
        loan.ledgerId,
        {
          principal: Number(loan.principal),
          startDate: loan.startDate,
          plan: customPeriods.map((p, i) => ({
            periodNo: i + 1,
            dueDate: p.dueDate,
            principalAmount: 0,
            interestAmount: 0,
            totalAmount: p.totalAmount,
          })),
        },
        tx,
      );
    });

    return this.findOne(loanId);
  }

  /**
   * 提前还款：
   * - amount < 剩余本金：部分提前还本金，重算剩余计划（期数不变、每期金额变小）
   * - amount >= 剩余本金：提前结清，删除剩余计划，贷款标记还清
   */
  async prepay(userId: string, loanId: string, dto: PrepayDto) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: { repayments: { orderBy: { periodNo: 'asc' } } },
    });
    if (!loan) throw new NotFoundException('贷款不存在');
    if (loan.status === 'paid_off') throw new BadRequestException('贷款已还清');

    const prepayDate = new Date(dto.prepayDate);

    // 找出「提前还款日之后」未还清的期
    const remaining = loan.repayments.filter(
      (r) => r.dueDate > prepayDate && r.status !== 'paid',
    );
    if (remaining.length === 0) {
      throw new BadRequestException('提前还款日之后没有待还期');
    }

    // 剩余本金 = 这些期的本金之和（含部分已还的按剩余本金）
    const remainingPrincipal = remaining.reduce((s, r) => {
      const paidRatio = Number(r.paidAmount) / Math.max(Number(r.totalAmount), 1);
      return s + Number(r.principalAmount) * (1 - paidRatio);
    }, 0);

    const prepayAmount = dto.amount;
    const isFullSettlement = prepayAmount >= remainingPrincipal - 0.005;

    await this.prisma.$transaction(async (tx) => {
      if (isFullSettlement) {
        // ===== 提前结清 =====
        // 1. 删除剩余期的流水（该贷款关联的，occurredAt >= 剩余第一期到期日）
        await tx.transaction.deleteMany({
          where: {
            loanId,
            occurredAt: { gte: remaining[0].dueDate },
          },
        });
        // 2. 删除剩余还款计划
        await tx.loanRepayment.deleteMany({
          where: {
            loanId,
            periodNo: { in: remaining.map((r) => r.periodNo) },
          },
        });
        // 3. 提前结清流水（本金支出）
        const principalCategory = await this.findCategory(
          tx,
          loan.ledgerId,
          '还款本金',
        );
        if (principalCategory) {
          await tx.transaction.create({
            data: {
              ledgerId: loan.ledgerId,
              categoryId: principalCategory.id,
              userId,
              type: 'expense',
              amount: new Prisma.Decimal(remainingPrincipal),
              note: `${loan.name} 提前结清`,
              occurredAt: prepayDate,
              loanId,
            },
          });
        }
        // 4. 贷款标记还清
        await tx.loan.update({
          where: { id: loanId },
          data: { status: 'paid_off' },
        });
        return;
      }

      // ===== 部分提前还本金 =====
      const newPrincipal = Math.round((remainingPrincipal - prepayAmount) * 100) / 100;
      const remainTermMonths = remaining.length;

      // 重新生成剩余期数的还款计划（保持原到期日不变）
      const newPlan = generateRepaymentPlan({
        principal: newPrincipal,
        annualRate: Number(loan.annualRate),
        startDate: remaining[0].dueDate,
        termMonths: remainTermMonths,
        repaymentDay: loan.repaymentDay,
        method: loan.repaymentMethod as RepaymentMethod,
        dueDates: remaining.map((r) => r.dueDate),
      });

      // 1. 删除「提前还款日之后」的流水（该贷款关联的，occurredAt > prepayDate）
      await tx.transaction.deleteMany({
        where: {
          loanId,
          occurredAt: { gt: prepayDate },
        },
      });

      // 2. 删除这些期的还款计划
      await tx.loanRepayment.deleteMany({
        where: {
          loanId,
          periodNo: { in: remaining.map((r) => r.periodNo) },
        },
      });

      // 3. 重建新还款计划（保留原 periodNo 起始，期数 = 剩余期数）
      await tx.loanRepayment.createMany({
        data: newPlan.map((p, i) => ({
          loanId,
          periodNo: remaining[0].periodNo + i,
          dueDate: p.dueDate,
          principalAmount: new Prisma.Decimal(p.principalAmount),
          interestAmount: new Prisma.Decimal(p.interestAmount),
          totalAmount: new Prisma.Decimal(p.totalAmount),
        })),
      });

      // 4. 写新流水（本金 + 利息）
      await this.writeLoanTransactions(
        userId,
        loan.id,
        loan.ledgerId,
        {
          principal: newPrincipal,
          startDate: remaining[0].dueDate,
          plan: newPlan,
        },
        tx,
      );

      // 5. 提前还款本身也记一笔流水（本金支出）
      const principalCategory = await this.findCategory(
        tx,
        loan.ledgerId,
        '还款本金',
      );
      if (principalCategory) {
        await tx.transaction.create({
          data: {
            ledgerId: loan.ledgerId,
            categoryId: principalCategory.id,
            userId,
            type: 'expense',
            amount: new Prisma.Decimal(prepayAmount),
            note: `${loan.name} 提前还款`,
            occurredAt: prepayDate,
            loanId,
          },
        });
      }
    });

    return this.findOne(loanId);
  }

  /**
   * 写贷款相关流水：放款收入 + 每期本金/利息支出。
   * @param tx 可选，事务客户端
   */
  private async writeLoanTransactions(
    userId: string,
    loanId: string,
    ledgerId: string,
    params: {
      principal: number;
      startDate: Date;
      plan: { dueDate: Date; principalAmount: number; interestAmount: number; totalAmount: number }[];
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const incomeCategory = await this.findCategory(db, ledgerId, '放款收款');
    const principalCategory = await this.findCategory(db, ledgerId, '还款本金');
    const interestCategory = await this.findCategory(db, ledgerId, '还款利息');

    const transactions: Prisma.TransactionCreateManyInput[] = [];

    // 放款收入（本金入账）
    if (incomeCategory) {
      transactions.push({
        ledgerId,
        categoryId: incomeCategory.id,
        userId,
        type: 'income',
        amount: new Prisma.Decimal(params.principal),
        note: '放款收款',
        occurredAt: params.startDate,
        loanId,
      });
    }

    // 每期还款支出
    for (const p of params.plan) {
      // 自定义方式：本金利息都为0，只写一条总额流水
      if (p.principalAmount === 0 && p.interestAmount === 0 && p.totalAmount > 0) {
        if (principalCategory) {
          transactions.push({
            ledgerId,
            categoryId: principalCategory.id,
            userId,
            type: 'expense',
            amount: new Prisma.Decimal(p.totalAmount),
            note: '还款',
            occurredAt: p.dueDate,
            loanId,
          });
        }
        continue;
      }
      if (principalCategory && p.principalAmount > 0) {
        transactions.push({
          ledgerId,
          categoryId: principalCategory.id,
          userId,
          type: 'expense',
          amount: new Prisma.Decimal(p.principalAmount),
          note: '还款本金',
          occurredAt: p.dueDate,
          loanId,
        });
      }
      if (interestCategory && p.interestAmount > 0) {
        transactions.push({
          ledgerId,
          categoryId: interestCategory.id,
          userId,
          type: 'expense',
          amount: new Prisma.Decimal(p.interestAmount),
          note: '还款利息',
          occurredAt: p.dueDate,
          loanId,
        });
      }
    }

    if (transactions.length > 0) {
      await db.transaction.createMany({ data: transactions });
    }
  }

  private async findCategory(
    db: Prisma.TransactionClient | PrismaService,
    ledgerId: string,
    name: string,
  ) {
    return db.category.findFirst({ where: { ledgerId, name } });
  }

  private toCustomPeriodDates(
    customPeriods?: { dueDate: string; totalAmount: number }[],
  ): { dueDate: Date; totalAmount: number }[] | undefined {
    if (!customPeriods) return undefined;
    return customPeriods.map((c) => ({
      dueDate: new Date(c.dueDate),
      totalAmount: c.totalAmount,
    }));
  }

  async findAll(ledgerId: string) {
    // 先把到期的期自动标记为已还
    await this.autoSettleExpiredByLedger(ledgerId);
    const loans = await this.prisma.loan.findMany({
      where: { ledgerId },
      include: {
        repayments: {
          orderBy: { periodNo: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return loans.map((l) => this.withActualRate(l));
  }

  async findOne(id: string) {
    // 先把到期的期自动标记为已还
    await this.autoSettleExpired(id);
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: { repayments: { orderBy: { periodNo: 'asc' } } },
    });
    if (!loan) throw new NotFoundException('贷款不存在');
    return this.withActualRate(loan);
  }

  /** 自动把「还款日已过」的期标记为已还（到期自动已还） */
  private async autoSettleExpired(loanId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.prisma.$executeRaw`
      UPDATE \`LoanRepayment\`
      SET \`status\` = 'paid', \`paidAmount\` = \`totalAmount\`, \`paidDate\` = \`dueDate\`
      WHERE \`loanId\` = ${loanId}
        AND \`dueDate\` < ${today}
        AND \`status\` IN ('pending', 'partial', 'overdue')
    `;
  }

  private async autoSettleExpiredByLedger(ledgerId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.prisma.$executeRaw`
      UPDATE \`LoanRepayment\` r
      JOIN \`Loan\` l ON l.\`id\` = r.\`loanId\`
      SET r.\`status\` = 'paid', r.\`paidAmount\` = r.\`totalAmount\`, r.\`paidDate\` = r.\`dueDate\`
      WHERE l.\`ledgerId\` = ${ledgerId}
        AND r.\`dueDate\` < ${today}
        AND r.\`status\` IN ('pending', 'partial', 'overdue')
    `;
  }

  /** 附加实际年利率（XIRR） */
  private withActualRate(loan: {
    principal: Prisma.Decimal;
    startDate: Date;
    repayments: { dueDate: Date; totalAmount: Prisma.Decimal }[];
  }) {
    const xirr = calculateXIRR(
      Number(loan.principal),
      loan.startDate,
      loan.repayments.map((r) => ({
        dueDate: r.dueDate,
        totalAmount: Number(r.totalAmount),
      })),
    );
    return {
      ...loan,
      actualAnnualRate: xirr === null ? null : Math.round(xirr * 10000) / 100,
    };
  }

  async findLoanEntity(id: string) {
    const loan = await this.prisma.loan.findUnique({ where: { id } });
    if (!loan) throw new NotFoundException('贷款不存在');
    return loan;
  }

  /** 更新贷款：重新生成还款计划。已还清的贷款不允许重算。 */
  async update(userId: string, id: string, dto: UpdateLoanDto) {
    const existing = await this.prisma.loan.findUnique({
      where: { id },
      include: { repayments: true },
    });
    if (!existing) throw new NotFoundException('贷款不存在');

    const hasPaid = existing.repayments.some((r) => Number(r.paidAmount) > 0);
    const paramsChanged =
      dto.principal !== undefined ||
      dto.annualRate !== undefined ||
      dto.startDate !== undefined ||
      dto.termMonths !== undefined ||
      dto.repaymentDay !== undefined ||
      dto.repaymentMethod !== undefined ||
      dto.customPeriods !== undefined;

    // 自定义贷款不能改为其他类型
    if (
      existing.repaymentMethod === 'custom' &&
      dto.repaymentMethod !== undefined &&
      dto.repaymentMethod !== 'custom'
    ) {
      throw new BadRequestException('自定义贷款不能改为其他还款方式');
    }

    if (hasPaid && paramsChanged) {
      throw new BadRequestException('已有还款记录，不能重新计算还款计划');
    }

    // 基础字段更新
    const data: Prisma.LoanUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.direction !== undefined) data.direction = dto.direction;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.status !== undefined) data.status = dto.status;

    if (paramsChanged) {
      const principal = dto.principal ?? Number(existing.principal);
      const annualRate = dto.annualRate ?? Number(existing.annualRate);
      const startDate = dto.startDate
        ? new Date(dto.startDate)
        : existing.startDate;
      const termMonths = dto.termMonths ?? existing.termMonths;
      const repaymentDay = dto.repaymentDay ?? existing.repaymentDay;
      const method = (dto.repaymentMethod ??
        existing.repaymentMethod) as RepaymentMethod;

      const plan = generateRepaymentPlan({
        principal,
        annualRate,
        startDate,
        termMonths,
        repaymentDay,
        method,
        customPeriods: this.toCustomPeriodDates(dto.customPeriods),
      });

      data.principal = new Prisma.Decimal(principal);
      data.annualRate = new Prisma.Decimal(annualRate);
      data.startDate = startDate;
      data.termMonths = termMonths;
      data.repaymentDay = repaymentDay;
      data.repaymentMethod = method;

      // 删除旧计划、旧流水，重建
      await this.prisma.$transaction(async (tx) => {
        await tx.loanRepayment.deleteMany({ where: { loanId: id } });
        await tx.transaction.deleteMany({ where: { loanId: id } });
        await tx.loan.update({ where: { id }, data });

        await tx.loanRepayment.createMany({
          data: plan.map((p) => ({
            loanId: id,
            periodNo: p.periodNo,
            dueDate: p.dueDate,
            principalAmount: new Prisma.Decimal(p.principalAmount),
            interestAmount: new Prisma.Decimal(p.interestAmount),
            totalAmount: new Prisma.Decimal(p.totalAmount),
          })),
        });

        await this.writeLoanTransactions(
          userId,
          id,
          existing.ledgerId,
          { principal, startDate, plan },
          tx,
        );
      });
    } else {
      await this.prisma.loan.update({ where: { id }, data });
    }

    return this.findOne(id);
  }

  async remove(id: string) {
    await this.prisma.$transaction(async (tx) => {
      // 先删关联流水，再删还款计划，最后删贷款
      await tx.transaction.deleteMany({ where: { loanId: id } });
      await tx.loanRepayment.deleteMany({ where: { loanId: id } });
      await tx.loan.delete({ where: { id } });
    });
    return { success: true };
  }

  /** 标记某期还款 */
  async payRepayment(
    loanId: string,
    periodNo: number,
    dto: PayRepaymentDto,
  ) {
    const repayment = await this.prisma.loanRepayment.findUnique({
      where: { loanId_periodNo: { loanId, periodNo } },
    });
    if (!repayment) throw new NotFoundException('还款计划不存在');

    const newPaid = Number(repayment.paidAmount) + dto.amount;
    const total = Number(repayment.totalAmount);
    let status = repayment.status;
    if (newPaid >= total - 0.005) {
      status = 'paid';
    } else if (newPaid > 0) {
      status = 'partial';
    }

    const updated = await this.prisma.loanRepayment.update({
      where: { loanId_periodNo: { loanId, periodNo } },
      data: {
        paidAmount: new Prisma.Decimal(newPaid),
        status,
        paidDate: dto.paidDate ? new Date(dto.paidDate) : new Date(),
      },
    });

    await this.recalcLoanStatus(loanId);

    return updated;
  }

  /** 撤销某期还款（恢复 pending） */
  async undoRepayment(loanId: string, periodNo: number) {
    const updated = await this.prisma.loanRepayment.update({
      where: { loanId_periodNo: { loanId, periodNo } },
      data: {
        paidAmount: new Prisma.Decimal(0),
        status: 'pending',
        paidDate: null,
      },
    });
    await this.recalcLoanStatus(loanId);
    return updated;
  }

  /** 根据还款进度更新贷款状态 */
  private async recalcLoanStatus(loanId: string) {
    const repayments = await this.prisma.loanRepayment.findMany({
      where: { loanId },
    });
    const allPaid = repayments.length > 0 && repayments.every((r) => r.status === 'paid');
    await this.prisma.loan.update({
      where: { id: loanId },
      data: { status: allPaid ? 'paid_off' : 'active' },
    });
  }
}
