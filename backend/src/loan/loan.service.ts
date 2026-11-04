import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateLoanDto, PayRepaymentDto, UpdateLoanDto } from './dto/loan.dto.js';
import { generateRepaymentPlan } from './loan-calculator.js';
import type { RepaymentMethod } from './loan-calculator.js';

@Injectable()
export class LoanService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateLoanDto) {
    const plan = generateRepaymentPlan({
      principal: dto.principal,
      annualRate: dto.annualRate,
      startDate: new Date(dto.startDate),
      termMonths: dto.termMonths,
      repaymentDay: dto.repaymentDay,
      method: dto.repaymentMethod,
      customPeriods: dto.customPeriods,
    });

    return this.prisma.loan.create({
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
  }

  async findAll(ledgerId: string) {
    return this.prisma.loan.findMany({
      where: { ledgerId },
      include: {
        repayments: {
          orderBy: { periodNo: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: { repayments: { orderBy: { periodNo: 'asc' } } },
    });
    if (!loan) throw new NotFoundException('贷款不存在');
    return loan;
  }

  async findLoanEntity(id: string) {
    const loan = await this.prisma.loan.findUnique({ where: { id } });
    if (!loan) throw new NotFoundException('贷款不存在');
    return loan;
  }

  /** 更新贷款：重新生成还款计划。已还清的贷款不允许重算。 */
  async update(id: string, dto: UpdateLoanDto) {
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
        customPeriods: dto.customPeriods,
      });

      data.principal = new Prisma.Decimal(principal);
      data.annualRate = new Prisma.Decimal(annualRate);
      data.startDate = startDate;
      data.termMonths = termMonths;
      data.repaymentDay = repaymentDay;
      data.repaymentMethod = method;

      // 删除旧计划，重建
      await this.prisma.loanRepayment.deleteMany({ where: { loanId: id } });
      await this.prisma.loan.update({ where: { id }, data });

      await this.prisma.loanRepayment.createMany({
        data: plan.map((p) => ({
          loanId: id,
          periodNo: p.periodNo,
          dueDate: p.dueDate,
          principalAmount: new Prisma.Decimal(p.principalAmount),
          interestAmount: new Prisma.Decimal(p.interestAmount),
          totalAmount: new Prisma.Decimal(p.totalAmount),
        })),
      });
    } else {
      await this.prisma.loan.update({ where: { id }, data });
    }

    return this.findOne(id);
  }

  async remove(id: string) {
    await this.prisma.loan.delete({ where: { id } });
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
