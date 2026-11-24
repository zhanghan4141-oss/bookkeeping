import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateLoanDto,
  CustomPeriodDto,
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
    const name = dto.name.trim();
    await this.assertNameUnique(dto.ledgerId, name);

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
      // 转成自定义格式：本金利息归零，每期金额初始为 0（用户后续手动逐期填写）
      plan = equalPlan.map((p) => ({
        periodNo: p.periodNo,
        dueDate: p.dueDate,
        principalAmount: 0,
        interestAmount: 0,
        totalAmount: 0,
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

    // 原子写入：贷款 + 还款计划 + 流水 在同一事务内，任一步失败整体回滚，
    // 避免「接口报错但贷款/流水已创建」的不一致。
    const loan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.loan.create({
        data: {
          ledgerId: dto.ledgerId,
          name,
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
      });

      // 写流水：放款收入 + 每期本金/利息支出（用事务客户端，保证原子性）
      await this.writeLoanTransactions(
        userId,
        created.id,
        created.ledgerId,
        {
          principal: dto.principal,
          startDate: new Date(dto.startDate),
          plan,
          loanNote: dto.note,
          loanName: created.name,
        },
        tx,
      );

      // 读回完整贷款（含默认字段，如 kind/paidAmount/status）
      return tx.loan.findUnique({
        where: { id: created.id },
        include: { repayments: { orderBy: [{ dueDate: 'asc' }, { periodNo: 'asc' }] } },
      });
    });

    if (!loan) throw new NotFoundException('贷款创建失败');
    return this.withDerived(loan);
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
      include: { repayments: { orderBy: [{ dueDate: 'asc' }, { periodNo: 'asc' }] } },
    });
    if (!loan) throw new NotFoundException('贷款不存在');
    if (loan.repaymentMethod !== 'custom') {
      throw new BadRequestException('仅自定义还款方式可编辑还款计划');
    }

    const entries = dto.customPeriods.map((c) => {
      const kind = c.kind ?? 'period';
      if (kind === 'prepay') {
        // 提前还款：本金 + 利息（利息缺省 0）；兼容旧格式仅传 totalAmount → 全额当本金
        if (c.principal === undefined && c.interest === undefined) {
          const total = c.totalAmount ?? 0;
          return { kind, dueDate: new Date(c.dueDate), principal: total, interest: 0, totalAmount: total };
        }
        const principal = c.principal ?? 0;
        const interest = c.interest ?? 0;
        return { kind, dueDate: new Date(c.dueDate), principal, interest, totalAmount: principal + interest };
      }
      // 普通期：分账（本金/利息）或历史合并期（仅总额，全额按本金处理）
      if (c.principal !== undefined || c.interest !== undefined) {
        const principal = c.principal ?? 0;
        const interest = c.interest ?? 0;
        return { kind, dueDate: new Date(c.dueDate), principal, interest, totalAmount: principal + interest };
      }
      return { kind, dueDate: new Date(c.dueDate), principal: 0, interest: 0, totalAmount: c.totalAmount ?? 0 };
    });
    const periodEntries = entries.filter((e) => e.kind === 'period');
    if (periodEntries.length !== loan.termMonths) {
      throw new BadRequestException(
        `还款计划期数不匹配：需要 ${loan.termMonths} 期`,
      );
    }
    const prepayEntries = entries.filter((e) => e.kind === 'prepay');

    // 校验：计划本金总额（各期本金 + 提前还条目本金部分）应等于借款金额
    const totalPrincipal =
      periodEntries.reduce((s, p) => {
        // 历史合并期本金利息都为 0 时，全额当本金
        const principal = p.principal !== undefined ? p.principal : (p.totalAmount ?? 0);
        return s + (principal || 0);
      }, 0) + prepayEntries.reduce((s, p) => s + (p.principal ?? 0), 0);
    if (Math.abs(totalPrincipal - Number(loan.principal)) > 0.01) {
      throw new BadRequestException(
        `还款计划本金总额 ¥${Math.round(totalPrincipal * 100) / 100} 与借款金额 ¥${Number(loan.principal)} 不一致`,
      );
    }

    // 本地日期键（YYYY-MM-DD）：DATE/归一化 DATETIME 用 toISOString 同日，与现有口径一致
    const fmtDay = (d: Date | string) => {
      const x = typeof d === 'string' ? new Date(`${d}T00:00:00`) : d;
      return x.toISOString().slice(0, 10);
    };

    // 提前还款日期不能晚于今天（提前还只可能是今天/过去）
    for (const p of prepayEntries) {
      if (p.dueDate > new Date()) {
        throw new BadRequestException('提前还款日期不能晚于今天');
      }
    }

    // 已还的普通期按期号映射（期数固定，期号即顺序，支持改日期）
    const oldPaidByPeriodNo = new Map<number, (typeof loan.repayments)[number]>();
    for (const r of loan.repayments) {
      if (r.kind === 'period' && Number(r.paidAmount) > 0) {
        oldPaidByPeriodNo.set(r.periodNo, r);
      }
    }
    // 已发生的提前还款（paidAmount>0）按日期映射
    const oldPaidPrepayByDate = new Map(
      loan.repayments
        .filter((r) => r.kind === 'prepay' && Number(r.paidAmount) > 0)
        .map((r) => [fmtDay(r.dueDate), r]),
    );
    const newPrepayDates = new Set(prepayEntries.map((p) => fmtDay(p.dueDate)));
    // 保留的提前还（旧已发生且仍在计划里）日期集；被删除的提前还 → 流水随之删除
    const keptPrepayDates = new Set(
      [...oldPaidPrepayByDate.keys()].filter((k) => newPrepayDates.has(k)),
    );

    // 「操作过」（与计划不一致）：提前还款恒为真；普通期按实际日期/金额偏离判定
    const isDiverged = (r: (typeof loan.repayments)[number]): boolean => {
      if (r.kind === 'prepay') return true;
      const paidDay = r.paidDate ? fmtDay(r.paidDate) : null;
      if (paidDay && paidDay !== fmtDay(r.dueDate)) return true;
      return Number(r.paidAmount) !== Number(r.totalAmount);
    };

    await this.prisma.$transaction(async (tx) => {
      // 保留「操作过」已还期/仍保留的提前还款对应的流水（原 id/日期/金额），其余删除重建
      const existingTx = await tx.transaction.findMany({
        where: { loanId },
        select: {
          id: true,
          ledgerId: true,
          categoryId: true,
          userId: true,
          type: true,
          amount: true,
          note: true,
          occurredAt: true,
        },
      });
      const preservedIds = new Set<string>();
      const isRepayNote = (note: string | null) =>
        ['还款本金', '还款利息', '还款'].some((p) => note?.startsWith(p)) ||
        note?.includes('提前还款');
      // 操作过的普通期 → 保留流水（一致期不保留，随重建同步为新计划）
      for (const [periodNo, r] of oldPaidByPeriodNo) {
        if (!isDiverged(r)) continue;
        const at = new Set([fmtDay(r.dueDate)]);
        if (r.paidDate) at.add(fmtDay(r.paidDate));
        for (const t of existingTx) {
          if (preservedIds.has(t.id) || t.type !== 'expense' || !isRepayNote(t.note)) continue;
          if (at.has(fmtDay(t.occurredAt))) preservedIds.add(t.id);
        }
      }
      // 保留仍在计划里的提前还款流水（被删除的提前还 → 流水随之删除）
      for (const k of keptPrepayDates) {
        for (const t of existingTx) {
          if (preservedIds.has(t.id) || t.type !== 'expense' || !isRepayNote(t.note)) continue;
          if (fmtDay(t.occurredAt) === k) preservedIds.add(t.id);
        }
      }

      // 删除其余流水 + 全部旧计划（period 与 prepay 一并重建）
      await tx.transaction.deleteMany({
        where: { loanId, id: { notIn: [...preservedIds] } },
      });
      await tx.loanRepayment.deleteMany({ where: { loanId } });

      // 重建各期：一致已还期 → 同步为新计划（金额/日期/paidDate）；操作过已还期 → 计划更新、实际冻结
      await tx.loanRepayment.createMany({
        data: periodEntries.map((p, i) => {
          const periodNo = i + 1;
          const old = oldPaidByPeriodNo.get(periodNo);
          const totalAmount = p.totalAmount;
          if (old && isDiverged(old)) {
            // 操作过：只改计划行，实际（paidAmount/paidDate）保持原样
            return {
              loanId,
              periodNo,
              dueDate: p.dueDate,
              principalAmount: new Prisma.Decimal(p.principal),
              interestAmount: new Prisma.Decimal(p.interest),
              totalAmount: new Prisma.Decimal(totalAmount),
              paidAmount: old.paidAmount,
              status: Number(old.paidAmount) >= totalAmount - 0.005 ? 'paid' : 'partial',
              paidDate: old.paidDate,
            };
          }
          if (old) {
            // 一致：流水/计划同步，视为按新计划足额还
            return {
              loanId,
              periodNo,
              dueDate: p.dueDate,
              principalAmount: new Prisma.Decimal(p.principal),
              interestAmount: new Prisma.Decimal(p.interest),
              totalAmount: new Prisma.Decimal(totalAmount),
              paidAmount: new Prisma.Decimal(totalAmount),
              status: 'paid',
              paidDate: p.dueDate,
            };
          }
          return {
            loanId,
            periodNo,
            dueDate: p.dueDate,
            principalAmount: new Prisma.Decimal(p.principal),
            interestAmount: new Prisma.Decimal(p.interest),
            totalAmount: new Prisma.Decimal(totalAmount),
            paidAmount: new Prisma.Decimal(0),
            status: 'pending',
            paidDate: null,
          };
        }),
      });

      // 重建提前还款条目（未来日期已在上方拒绝，一律记为已还；保留的继承原实际）
      if (prepayEntries.length > 0) {
        await tx.loanRepayment.createMany({
          data: prepayEntries.map((p, i) => {
            const old = oldPaidPrepayByDate.get(fmtDay(p.dueDate));
            const paidAmount = old ? old.paidAmount : new Prisma.Decimal(p.totalAmount);
            return {
              loanId,
              periodNo: 10000 + i + 1,
              kind: 'prepay',
              dueDate: p.dueDate,
              principalAmount: new Prisma.Decimal(p.principal),
              interestAmount: new Prisma.Decimal(p.interest),
              totalAmount: new Prisma.Decimal(p.totalAmount),
              paidAmount,
              status: Number(paidAmount) >= p.totalAmount - 0.005 ? 'paid' : 'partial',
              paidDate: old ? old.paidDate : p.dueDate,
              note: '提前还款',
            };
          }),
        });
      }

      // 写流水：放款收入 + 每期还款（跳过「操作过」已还期——其流水已保留；一致期同步重写为新计划）
      const skipNos = new Set<number>();
      periodEntries.forEach((p, i) => {
        const old = oldPaidByPeriodNo.get(i + 1);
        if (old && isDiverged(old)) skipNos.add(i + 1);
      });
      await this.writeLoanTransactions(
        userId,
        loanId,
        loan.ledgerId,
        {
          principal: Number(loan.principal),
          startDate: loan.startDate,
          plan: periodEntries.map((p, i) => ({
            periodNo: i + 1,
            dueDate: p.dueDate,
            principalAmount: p.principal,
            interestAmount: p.interest,
            totalAmount: p.totalAmount,
          })),
          loanNote: loan.note,
          loanName: loan.name,
          skipPeriodNos: skipNos,
        },
        tx,
      );

      // 写提前还款流水：已发生的旧 prepay 流水已保留，跳过重写；新增条目按本金/利息拆两条
      if (prepayEntries.length > 0) {
        const principalCategory = await this.findOrCreateCategory(
          tx,
          loan.ledgerId,
          '还款本金',
          'expense',
        );
        const interestCategory = await this.findOrCreateCategory(
          tx,
          loan.ledgerId,
          '还款利息',
          'expense',
        );
        for (const p of prepayEntries) {
          if (keptPrepayDates.has(fmtDay(p.dueDate))) continue;
          if (principalCategory && p.principal > 0) {
            await tx.transaction.create({
              data: {
                ledgerId: loan.ledgerId,
                categoryId: principalCategory.id,
                userId,
                type: 'expense',
                amount: new Prisma.Decimal(p.principal),
                note: this.noteWithLoan(`${loan.name} 提前还款`, loan.note),
                occurredAt: p.dueDate,
                loanId,
              },
            });
          }
          if (interestCategory && p.interest > 0) {
            await tx.transaction.create({
              data: {
                ledgerId: loan.ledgerId,
                categoryId: interestCategory.id,
                userId,
                type: 'expense',
                amount: new Prisma.Decimal(p.interest),
                note: this.noteWithLoan(`${loan.name} 提前还款利息`, loan.note),
                occurredAt: p.dueDate,
                loanId,
              },
            });
          }
        }
      }
    });

    return this.findOne(loanId);
  }

  /**
   * 提前还款：
   * - amount < 剩余本金：部分提前还本金，重算剩余计划
   *   · mode=reduce_payment（默认）：期数不变、每期金额变小
   *   · mode=reduce_term：等额本息保持月供不变 / 等额本金保持每期本金不变，期数缩短
   * - amount >= 剩余本金：提前结清，删除剩余计划，贷款标记还清
   * - 两种情况都会按天收取「截至还款日的当期已产生利息」
   */
  async prepay(userId: string, loanId: string, dto: PrepayDto) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: { repayments: { orderBy: [{ dueDate: 'asc' }, { periodNo: 'asc' }] } },
    });
    if (!loan) throw new NotFoundException('贷款不存在');
    if (loan.status === 'paid_off') throw new BadRequestException('贷款已还清');

    const prepayDate = new Date(dto.prepayDate);
    if (prepayDate > new Date()) {
      throw new BadRequestException('提前还款日期不能晚于今天');
    }

    // ===== 自定义贷款：纯记账，追加一条已还的「提前还款」计划记录 + 本金/利息流水 =====
    if (loan.repaymentMethod === 'custom') {
      const amount = dto.amount;
      const interest = dto.interest ?? 0;
      if (amount <= 0) throw new BadRequestException('请输入提前还款金额');
      if (interest < 0) throw new BadRequestException('提前还息不能为负');
      // 未还本金 = 贷款本金 − 已还本金 − 已还的提前还本金（区分本金/利息 + 已还比例，与 withDerived 口径一致）
      let paidPrincipal = 0;
      let prepayPrincipal = 0;
      for (const r of loan.repayments) {
        if (r.kind === 'prepay') {
          const total = Number(r.totalAmount);
          const ratio = total > 0 ? Number(r.paidAmount) / total : 0;
          const P = Number(r.principalAmount);
          const I = Number(r.interestAmount);
          // 历史提前还款（本金/利息都为 0）全额当本金
          prepayPrincipal += (P === 0 && I === 0 ? total : P) * ratio;
          continue;
        }
        const total = Number(r.totalAmount);
        if (total <= 0) continue;
        const ratio = Number(r.paidAmount) / Math.max(total, 1);
        const P = Number(r.principalAmount);
        const I = Number(r.interestAmount);
        if (P === 0 && I === 0) {
          // 历史合并期：全额当本金
          paidPrincipal += total * ratio;
        } else {
          paidPrincipal += P * ratio;
        }
      }
      const unpaidPrincipal = Math.max(
        0,
        Math.round((Number(loan.principal) - paidPrincipal - prepayPrincipal) * 100) / 100,
      );
      if (amount > unpaidPrincipal + 0.005) {
        throw new BadRequestException(
          `提前还款金额不能超过未还本金 ¥${unpaidPrincipal}`,
        );
      }
      const prepayNo =
        10000 + loan.repayments.filter((r) => r.kind === 'prepay').length + 1;
      // 时间未到（还款日仍在未来）→ 生成「待还的额外计划」，不做已还；
      // 当天/已过 → 保持记作「已还」的提前还款
      const isFuturePrepay = prepayDate > new Date();
      const totalAmount = Math.round((amount + interest) * 100) / 100;
      await this.prisma.$transaction(async (tx) => {
        await tx.loanRepayment.create({
          data: {
            loanId,
            periodNo: prepayNo,
            kind: 'prepay',
            dueDate: prepayDate,
            principalAmount: new Prisma.Decimal(amount),
            interestAmount: new Prisma.Decimal(interest),
            totalAmount: new Prisma.Decimal(totalAmount),
            paidAmount: new Prisma.Decimal(isFuturePrepay ? 0 : totalAmount),
            status: isFuturePrepay ? 'pending' : 'paid',
            paidDate: isFuturePrepay ? null : prepayDate,
            note: '提前还款',
          },
        });
        const principalCategory = await this.findOrCreateCategory(
          tx,
          loan.ledgerId,
          '还款本金',
          'expense',
        );
        if (principalCategory && amount > 0) {
          await tx.transaction.create({
            data: {
              ledgerId: loan.ledgerId,
              categoryId: principalCategory.id,
              userId,
              type: 'expense',
              amount: new Prisma.Decimal(amount),
              note: this.noteWithLoan(`${loan.name} 提前还款`, loan.note),
              occurredAt: prepayDate,
              loanId,
            },
          });
        }
        if (interest > 0) {
          const interestCategory = await this.findOrCreateCategory(
            tx,
            loan.ledgerId,
            '还款利息',
            'expense',
          );
          if (interestCategory) {
            await tx.transaction.create({
              data: {
                ledgerId: loan.ledgerId,
                categoryId: interestCategory.id,
                userId,
                type: 'expense',
                amount: new Prisma.Decimal(interest),
                note: this.noteWithLoan(`${loan.name} 提前还款利息`, loan.note),
                occurredAt: prepayDate,
                loanId,
              },
            });
          }
        }
      });
      return this.findOne(loanId);
    }

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

    const round2 = (n: number) => Math.round(n * 100) / 100;

    // 当期已产生利息：从上一个到期日（或起息日）到提前还款日，按天单利计息。
    // 结清/提前还款时一并收取，避免把已产生的利息凭空抹掉。
    let accruedInterest = 0;
    if (loan.repaymentMethod !== 'custom' && remaining.length > 0) {
      const nextDue = remaining[0].dueDate;
      const prev = loan.repayments.find(
        (r) => r.kind === 'period' && r.periodNo === remaining[0].periodNo - 1,
      );
      const prevDue = prev ? prev.dueDate : loan.startDate;
      const days = Math.floor(
        (prepayDate.getTime() - prevDue.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (days > 0) {
        accruedInterest = round2(
          remainingPrincipal * (Number(loan.annualRate) / 100) * (days / 365),
        );
      }
    }

    const prepayAmount = dto.amount;
    // 结清金额 = 剩余本金 + 当期已产生利息（判定与结清记账统一，不留灰色区间）
    const settleAmount = round2(remainingPrincipal + accruedInterest);
    const isFullSettlement = prepayAmount >= settleAmount - 0.005;
    // 中间区间：≥ 剩余本金 但 < 结清金额（不够还息），作为非法输入拦截
    if (
      !isFullSettlement &&
      prepayAmount >= remainingPrincipal - 0.005
    ) {
      throw new BadRequestException(
        `提前还款金额 ¥${prepayAmount} 未达到结清金额 ¥${settleAmount}（剩余本金 ¥${round2(remainingPrincipal)} + 当期利息 ¥${accruedInterest}），请填写结清金额或小于剩余本金的金额`,
      );
    }
    const remainingDueDates = remaining.map((r) => r.dueDate);
    // 提前还款记录的 periodNo 用大偏移量，避免与正常期数（<=360）冲突，排序时自然排在计划末尾
    const prepayNo =
      10000 + loan.repayments.filter((r) => r.kind === 'prepay').length + 1;

    await this.prisma.$transaction(async (tx) => {
      if (isFullSettlement) {
        // ===== 提前结清 =====
        // 1. 删除剩余期的流水（按到期日精确匹配，保留已还期的流水）
        await tx.transaction.deleteMany({
          where: {
            loanId,
            occurredAt: { in: remainingDueDates },
          },
        });
        // 2. 删除剩余还款计划
        await tx.loanRepayment.deleteMany({
          where: {
            loanId,
            periodNo: { in: remaining.map((r) => r.periodNo) },
          },
        });
        // 3. 提前结清流水（本金 + 当期已产生利息）
        const principalCategory = await this.findOrCreateCategory(
          tx,
          loan.ledgerId,
          '还款本金',
          'expense',
        );
        if (principalCategory) {
          await tx.transaction.create({
            data: {
              ledgerId: loan.ledgerId,
              categoryId: principalCategory.id,
              userId,
              type: 'expense',
              amount: new Prisma.Decimal(remainingPrincipal),
              note: this.noteWithLoan(`${loan.name} 提前结清`, loan.note),
              occurredAt: prepayDate,
              loanId,
            },
          });
        }
        if (accruedInterest > 0) {
          const interestCategory = await this.findOrCreateCategory(
            tx,
            loan.ledgerId,
            '还款利息',
            'expense',
          );
          if (interestCategory) {
            await tx.transaction.create({
              data: {
                ledgerId: loan.ledgerId,
                categoryId: interestCategory.id,
                userId,
                type: 'expense',
                amount: new Prisma.Decimal(accruedInterest),
                note: this.noteWithLoan(`${loan.name} 提前结清利息`, loan.note),
                occurredAt: prepayDate,
                loanId,
              },
            });
          }
        }
        // 4. 提前结清也加入还款计划（还多少记多少：本金 + 当期利息）
        await tx.loanRepayment.create({
          data: {
            loanId,
            periodNo: prepayNo,
            kind: 'prepay',
            dueDate: prepayDate,
            principalAmount: new Prisma.Decimal(remainingPrincipal),
            interestAmount: new Prisma.Decimal(accruedInterest),
            totalAmount: new Prisma.Decimal(round2(remainingPrincipal + accruedInterest)),
            paidAmount: new Prisma.Decimal(round2(remainingPrincipal + accruedInterest)),
            status: 'paid',
            paidDate: prepayDate,
            note: '提前结清',
          },
        });
        // 5. 贷款标记还清
        await tx.loan.update({
          where: { id: loanId },
          data: { status: 'paid_off' },
        });
        return;
      }

      // ===== 部分提前还本金 =====
      const newPrincipal = Math.round((remainingPrincipal - prepayAmount) * 100) / 100;
      const remainTermMonths = remaining.length;
      const method = loan.repaymentMethod;
      const mode: 'reduce_term' | 'reduce_payment' = dto.mode ?? 'reduce_payment';

      // 重新生成剩余还款计划：
      // - 降低月供（默认）：期数不变、每期金额变小
      // - 缩短期限：等额本息保持月供不变、等额本金保持每期本金不变，期数减少
      const shortenTerm =
        mode === 'reduce_term' &&
        (method === 'equal_installment' || method === 'equal_principal');
      const newTerm = shortenTerm
        ? this.reducedTermMonths(loan, remaining, newPrincipal)
        : remainTermMonths;

      const newPlan = generateRepaymentPlan({
        principal: newPrincipal,
        annualRate: Number(loan.annualRate),
        startDate: remaining[0].dueDate,
        termMonths: newTerm,
        repaymentDay: loan.repaymentDay,
        method: method as RepaymentMethod,
        dueDates: remaining.slice(0, newTerm).map((r) => r.dueDate),
      });

      // 首期只覆盖 [提前还款日, 下个到期日]，按天重算首期利息，避免与上面已收的当期利息重复计息
      if (method !== 'custom' && newPlan.length > 0) {
        const daysToNext = Math.max(
          1,
          Math.round(
            (remaining[0].dueDate.getTime() - prepayDate.getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        );
        const firstInterest = round2(
          newPrincipal * (Number(loan.annualRate) / 100) * (daysToNext / 365),
        );
        newPlan[0].interestAmount = firstInterest;
        newPlan[0].totalAmount = round2(newPlan[0].principalAmount + firstInterest);
      }

      // 1. 删除剩余期的流水（按到期日精确匹配，保留已还期的流水）
      await tx.transaction.deleteMany({
        where: {
          loanId,
          occurredAt: { in: remainingDueDates },
        },
      });

      // 2. 删除这些期的还款计划
      await tx.loanRepayment.deleteMany({
        where: {
          loanId,
          periodNo: { in: remaining.map((r) => r.periodNo) },
        },
      });

      // 3. 重建新还款计划（保留原 periodNo 起始、原到期日；部分已还的期保留已还金额）
      await tx.loanRepayment.createMany({
        data: newPlan.map((p, i) => {
          const orig = remaining[i];
          const periodNo = remaining[0].periodNo + i;
          const totalAmount = p.totalAmount;
          const paidAmount = orig ? Number(orig.paidAmount) : 0;
          let status = 'pending';
          if (paidAmount > 0) {
            status = paidAmount >= totalAmount - 0.005 ? 'paid' : 'partial';
          }
          return {
            loanId,
            periodNo,
            dueDate: p.dueDate,
            principalAmount: new Prisma.Decimal(p.principalAmount),
            interestAmount: new Prisma.Decimal(p.interestAmount),
            totalAmount: new Prisma.Decimal(totalAmount),
            paidAmount: new Prisma.Decimal(paidAmount),
            status,
            paidDate: orig?.paidDate ?? null,
          };
        }),
      });

      // 4. 写新流水（只写每期本金/利息支出，不重复写放款收入）
      await this.writeLoanTransactions(
        userId,
        loan.id,
        loan.ledgerId,
        {
          principal: newPrincipal,
          startDate: remaining[0].dueDate,
          plan: newPlan,
          writeIncome: false,
          loanNote: loan.note,
          loanName: loan.name,
        },
        tx,
      );

      // 5. 提前还款本身也记流水（本金 + 当期已产生利息）
      const principalCategory = await this.findOrCreateCategory(
        tx,
        loan.ledgerId,
        '还款本金',
        'expense',
      );
      if (principalCategory) {
        await tx.transaction.create({
          data: {
            ledgerId: loan.ledgerId,
            categoryId: principalCategory.id,
            userId,
            type: 'expense',
            amount: new Prisma.Decimal(prepayAmount),
            note: this.noteWithLoan(`${loan.name} 提前还款`, loan.note),
            occurredAt: prepayDate,
            loanId,
          },
        });
      }
      if (accruedInterest > 0) {
        const interestCategory = await this.findOrCreateCategory(
          tx,
          loan.ledgerId,
          '还款利息',
          'expense',
        );
        if (interestCategory) {
          await tx.transaction.create({
            data: {
              ledgerId: loan.ledgerId,
              categoryId: interestCategory.id,
              userId,
              type: 'expense',
              amount: new Prisma.Decimal(accruedInterest),
              note: this.noteWithLoan(`${loan.name} 提前还款利息`, loan.note),
              occurredAt: prepayDate,
              loanId,
            },
          });
        }
      }

      // 6. 提前还款也加入还款计划（还多少记多少：本金 + 当期利息）
      await tx.loanRepayment.create({
        data: {
          loanId,
          periodNo: prepayNo,
          kind: 'prepay',
          dueDate: prepayDate,
          principalAmount: new Prisma.Decimal(prepayAmount),
          interestAmount: new Prisma.Decimal(accruedInterest),
          totalAmount: new Prisma.Decimal(round2(prepayAmount + accruedInterest)),
          paidAmount: new Prisma.Decimal(round2(prepayAmount + accruedInterest)),
          status: 'paid',
          paidDate: prepayDate,
          note: '提前还款',
        },
      });

      // 7. 缩短期限后同步贷款期数 = 实际剩余期数（保持贷款信息与还款计划一致）
      if (shortenTerm) {
        await tx.loan.update({
          where: { id: loanId },
          data: { termMonths: newTerm },
        });
      }
    });

    return this.findOne(loanId);
  }

  /** 计算「缩短期限」后的剩余期数：等额本息保持月供不变、等额本金保持每期本金不变，期数缩短 */
  private reducedTermMonths(
    loan: { annualRate: Prisma.Decimal; repaymentMethod: string },
    remaining: { principalAmount: Prisma.Decimal; totalAmount: Prisma.Decimal }[],
    newPrincipal: number,
  ): number {
    const total = remaining.length;
    if (total <= 1) return total;
    if (loan.repaymentMethod === 'equal_principal') {
      const perPeriod = Number(remaining[0].principalAmount);
      if (perPeriod <= 0) return total;
      return Math.max(1, Math.min(total, Math.ceil(newPrincipal / perPeriod)));
    }
    // 等额本息：M = 当前月供，n 满足 newPrincipal = M·(1-(1+r)^-n)/r
    const M = Number(remaining[0].totalAmount);
    const r = Number(loan.annualRate) / 100 / 12;
    if (M <= 0) return total;
    if (r === 0) {
      return Math.max(1, Math.min(total, Math.ceil(newPrincipal / M)));
    }
    const x = 1 - (newPrincipal * r) / M;
    if (x <= 0) return total;
    const n = -Math.log(x) / Math.log(1 + r);
    if (!Number.isFinite(n) || n <= 0) return total;
    return Math.max(1, Math.min(total, Math.ceil(n)));
  }

  /** 拼接贷款备注：贷款有备注时以「（备注）」追加到流水备注，无则原样返回 */
  private noteWithLoan(base: string, loanNote?: string | null): string {
    const t = loanNote?.trim();
    return t ? `${base}（${t}）`.slice(0, 191) : base;
  }

  /** 贷款备注变更后，同步所有贷款流水备注：把旧的「（旧备注）」后缀替换为新备注 */
  private async syncLoanNoteToTransactions(
    tx: Prisma.TransactionClient,
    loanId: string,
    oldNote: string | null | undefined,
    newNote: string | undefined,
  ) {
    const oldSuffix = oldNote?.trim();
    const txs = await tx.transaction.findMany({
      where: { loanId },
      select: { id: true, note: true },
    });
    for (const t of txs) {
      const note = t.note ?? '';
      let base: string | null = null;
      if (oldSuffix) {
        // 旧备注非空：去掉末尾「（旧备注）」还原 base
        const suffix = `（${oldSuffix}）`;
        if (note.endsWith(suffix)) {
          base = note.slice(0, note.length - suffix.length);
        }
        // 被截断（>191 才 slice）或手工改写过的备注不再精确匹配 → 保持现状
      } else {
        // 之前无备注：整段备注即 base，直接追加新备注
        base = note;
      }
      if (base === null) continue;
      const rebuilt = this.noteWithLoan(base, newNote);
      if (rebuilt !== note) {
        await tx.transaction.update({
          where: { id: t.id },
          data: { note: rebuilt },
        });
      }
    }
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
      /** 是否写「贷款」收入流水，默认 true；提前还款重算时传 false，避免多记一笔放款 */
      writeIncome?: boolean;
      /** 跳过这些期号的还款流水（编辑计划时传已还期集，已还期的原流水已被保留） */
      skipPeriodNos?: Set<number>;
      /** 贷款备注：非空时追加到每笔流水备注 */
      loanNote?: string | null;
      /** 贷款名称：拼接到流水备注前缀 */
      loanName: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const incomeCategory = await this.findOrCreateCategory(db, ledgerId, '贷款', 'income');
    const principalCategory = await this.findOrCreateCategory(db, ledgerId, '还款本金', 'expense');
    const interestCategory = await this.findOrCreateCategory(db, ledgerId, '还款利息', 'expense');

    const transactions: Prisma.TransactionCreateManyInput[] = [];

    // 放款收入（本金入账）
    if (params.writeIncome !== false && incomeCategory) {
      transactions.push({
        ledgerId,
        categoryId: incomeCategory.id,
        userId,
        type: 'income',
        amount: new Prisma.Decimal(params.principal),
        note: this.noteWithLoan(`${params.loanName} 放款`, params.loanNote),
        occurredAt: params.startDate,
        loanId,
      });
    }

    // 每期还款支出
    for (const [i, p] of params.plan.entries()) {
      // 已还期：原流水已被保留，不重建
      if (params.skipPeriodNos?.has(i + 1)) continue;
      // 自定义方式：本金利息都为0，只写一条总额流水
      if (p.principalAmount === 0 && p.interestAmount === 0 && p.totalAmount > 0) {
        if (principalCategory) {
          transactions.push({
            ledgerId,
            categoryId: principalCategory.id,
            userId,
            type: 'expense',
            amount: new Prisma.Decimal(p.totalAmount),
            note: this.noteWithLoan(`${params.loanName} 第${i + 1}期 还款`, params.loanNote),
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
          note: this.noteWithLoan(`${params.loanName} 第${i + 1}期 还款本金`, params.loanNote),
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
          note: this.noteWithLoan(`${params.loanName} 第${i + 1}期 还款利息`, params.loanNote),
          occurredAt: p.dueDate,
          loanId,
        });
      }
    }

    if (transactions.length > 0) {
      await db.transaction.createMany({ data: transactions });
    }
  }

  /** 查找贷款相关类别，不存在则自动创建（普通账本添加贷款时也会补建） */
  private async findOrCreateCategory(
    db: Prisma.TransactionClient | PrismaService,
    ledgerId: string,
    name: string,
    type: 'income' | 'expense',
  ) {
    const existing = await db.category.findFirst({ where: { ledgerId, name } });
    if (existing) return existing;
    return db.category.create({
      data: { ledgerId, name, type, isBuiltin: true, sortOrder: 99 },
    });
  }

  /** 校验同一账本内贷款名称唯一 */
  private async assertNameUnique(
    ledgerId: string,
    name: string,
    excludeId?: string,
  ) {
    const trimmed = name.trim();
    const existing = await this.prisma.loan.findFirst({
      where: {
        ledgerId,
        name: trimmed,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new BadRequestException('该账本下已存在同名贷款');
    }
  }

  private toCustomPeriodDates(
    customPeriods?: CustomPeriodDto[],
  ): { dueDate: Date; totalAmount: number }[] | undefined {
    if (!customPeriods) return undefined;
    return customPeriods.map((c) => {
      let totalAmount = c.totalAmount ?? 0;
      if (c.principal !== undefined || c.interest !== undefined) {
        totalAmount = (c.principal ?? 0) + (c.interest ?? 0);
      }
      return { dueDate: new Date(c.dueDate), totalAmount };
    });
  }

  async findAll(ledgerId: string) {
    // 先把到期的期自动标记为已还
    await this.autoSettleExpiredByLedger(ledgerId);
    const loans = await this.prisma.loan.findMany({
      where: { ledgerId },
      include: {
        repayments: {
          orderBy: [{ dueDate: 'asc' }, { periodNo: 'asc' }],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return loans.map((l) => this.withDerived(l));
  }

  async findOne(id: string) {
    // 先把到期的期自动标记为已还
    await this.autoSettleExpired(id);
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: { repayments: { orderBy: [{ dueDate: 'asc' }, { periodNo: 'asc' }] } },
    });
    if (!loan) throw new NotFoundException('贷款不存在');
    return this.withDerived(loan);
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

  /** 附加实际年利率（XIRR）与剩余未还本金/利息 */
  private withDerived(loan: {
    principal: Prisma.Decimal;
    startDate: Date;
    repaymentMethod: string;
    repayments: {
      kind: string;
      status: string;
      dueDate: Date;
      paidDate: Date | null;
      principalAmount: Prisma.Decimal;
      interestAmount: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
    }[];
  }) {
    const xirr = calculateXIRR(
      Number(loan.principal),
      loan.startDate,
      loan.repayments.map((r) => ({
        dueDate: r.dueDate,
        totalAmount: Number(r.totalAmount),
      })),
    );

    let remainingPrincipal = 0;
    let remainingInterest = 0;
    if (loan.repaymentMethod === 'custom') {
      // 自定义：剩余未还本金 = 贷款本金 − 已还本金 − 已还的提前还本金（下限 0）
      // 剩余未还利息 = 各期未还利息 − 已还的提前还利息（下限 0）
      // - 已还本金：按各期未还比例倒算（历史合并期全额当本金）
      // - 提前还款拆本金/利息，并按已还比例（paidAmount/totalAmount）计入，未还(pending)不参与
      let prepayPrincipal = 0;
      let prepayInterest = 0;
      let paidPrincipal = 0;
      for (const r of loan.repayments) {
        if (r.kind === 'prepay') {
          const total = Number(r.totalAmount);
          const ratio = total > 0 ? Number(r.paidAmount) / total : 0;
          const P = Number(r.principalAmount);
          const I = Number(r.interestAmount);
          if (P === 0 && I === 0) {
            // 历史提前还款（仅总额）→ 全额当本金
            prepayPrincipal += total * ratio;
          } else {
            prepayPrincipal += P * ratio;
            prepayInterest += I * ratio;
          }
          continue;
        }
        const total = Number(r.totalAmount);
        if (total <= 0) continue;
        const ratio = Number(r.paidAmount) / Math.max(total, 1);
        const factor = 1 - ratio;
        const P = Number(r.principalAmount);
        const I = Number(r.interestAmount);
        if (P === 0 && I === 0) {
          // 历史合并期：全额当本金，利息按 0
          paidPrincipal += total * ratio;
        } else {
          paidPrincipal += P * ratio;
          remainingInterest += I * factor;
        }
      }
      remainingPrincipal = Math.max(
        0,
        Number(loan.principal) - paidPrincipal - prepayPrincipal,
      );
      remainingInterest = Math.max(0, remainingInterest - prepayInterest);
      remainingPrincipal = Math.round(remainingPrincipal * 100) / 100;
      remainingInterest = Math.round(remainingInterest * 100) / 100;
    } else {
      for (const r of loan.repayments) {
        if (r.kind === 'prepay' || r.status === 'paid') continue;
        const ratio = Number(r.paidAmount) / Math.max(Number(r.totalAmount), 1);
        const remaining = 1 - ratio;
        remainingPrincipal += Number(r.principalAmount) * remaining;
        remainingInterest += Number(r.interestAmount) * remaining;
      }
    }

    const fmtDay = (d: Date) => d.toISOString().slice(0, 10);
    // 「操作过」（与计划不一致）：提前还款恒为真；普通期按实际日期/金额偏离判定
    const repayments = loan.repayments.map((r) => ({
      ...r,
      diverged:
        r.kind === 'prepay' ||
        (Number(r.paidAmount) > 0 &&
          ((r.paidDate != null && fmtDay(r.paidDate) !== fmtDay(r.dueDate)) ||
            Number(r.paidAmount) !== Number(r.totalAmount))),
    }));

    return {
      ...loan,
      repayments,
      actualAnnualRate: xirr === null ? null : Math.round(xirr * 10000) / 100,
      remainingPrincipal: Math.round(remainingPrincipal * 100) / 100,
      remainingInterest: Math.round(remainingInterest * 100) / 100,
    };
  }

  async findLoanEntity(id: string) {
    const loan = await this.prisma.loan.findUnique({ where: { id } });
    if (!loan) throw new NotFoundException('贷款不存在');
    return loan;
  }

  /** 更新贷款。
   * - 非自定义贷款：只可改名称/备注/方向；改本金/利率/期数/还款日/开始日期不允许；
   *   还款方式只能「非自定义 → 自定义」（保留已有计划）。
   * - 自定义贷款：可改本金/利率/开始日期/还款日（记录字段），改期数则截断或新增金额 0 的期。
   */
  async update(userId: string, id: string, dto: UpdateLoanDto) {
    const existing = await this.prisma.loan.findUnique({
      where: { id },
      include: { repayments: true },
    });
    if (!existing) throw new NotFoundException('贷款不存在');

    if (dto.name !== undefined) {
      await this.assertNameUnique(existing.ledgerId, dto.name, id);
    }

    const isCustom = existing.repaymentMethod === 'custom';
    const methodChanged =
      dto.repaymentMethod !== undefined &&
      dto.repaymentMethod !== existing.repaymentMethod;
    const targetMethod = dto.repaymentMethod ?? existing.repaymentMethod;

    // 还款方式切换校验
    if (methodChanged) {
      if (isCustom) {
        throw new BadRequestException('自定义贷款不能改为其他还款方式');
      }
      if (targetMethod !== 'custom') {
        throw new BadRequestException('还款方式之间不可互相切换');
      }
    }

    // 非自定义贷款（且不切到自定义）：基础信息不可改
    if (!isCustom && targetMethod !== 'custom') {
      const baseChanged =
        dto.principal !== undefined ||
        dto.annualRate !== undefined ||
        dto.startDate !== undefined ||
        dto.termMonths !== undefined ||
        dto.repaymentDay !== undefined;
      if (baseChanged) {
        throw new BadRequestException(
          '非自定义贷款不可修改本金/年利率/期数/还款日/开始日期',
        );
      }
    }

    const data: Prisma.LoanUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.direction !== undefined) data.direction = dto.direction;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.status !== undefined) data.status = dto.status;
    if (methodChanged && targetMethod === 'custom') {
      data.repaymentMethod = 'custom';
    }

    // 自定义贷款：改记录字段（本金/利率/开始日期/还款日），不影响还款计划
    if (isCustom) {
      if (dto.principal !== undefined) {
        data.principal = new Prisma.Decimal(dto.principal);
      }
      if (dto.annualRate !== undefined) {
        data.annualRate = new Prisma.Decimal(dto.annualRate);
      }
      if (dto.startDate !== undefined) {
        data.startDate = new Date(dto.startDate);
      }
      if (dto.repaymentDay !== undefined) {
        data.repaymentDay = dto.repaymentDay;
      }
    }

    const termChanged =
      isCustom &&
      dto.termMonths !== undefined &&
      dto.termMonths !== existing.termMonths;

    await this.prisma.$transaction(async (tx) => {
      await tx.loan.update({ where: { id }, data });

      // 修改备注 → 同步所有贷款流水备注（把旧的「（旧备注）」后缀替换为新备注）
      if (dto.note !== undefined) {
        await this.syncLoanNoteToTransactions(tx, id, existing.note, dto.note);
      }

      // 非自定义 → 自定义：保留每期原有本金/利息拆分。
      // 早期版本曾把 principal/interest 清零做「归一化」，但 withDerived 已改为
      // 按 repaymentMethod + 贷款本金锚定计算，归一化不再必要；清零反而把
      // 等额/先息后本各期已拆好的本金+利息合并，转自定义后剩余利息丢失、与分账方向矛盾。

      if (termChanged) {
        const newTerm = dto.termMonths!;
        if (newTerm < existing.termMonths) {
          // 截断多余的期（不改保留期金额）。仅删除普通期，绝不删除提前还款记录
          // （prepay 的 periodNo 恒 >= 10000，若无此条件会被 periodNo > newTerm 误删）
          await tx.loanRepayment.deleteMany({
            where: { loanId: id, periodNo: { gt: newTerm }, kind: 'period' },
          });
        } else if (newTerm > existing.termMonths) {
          // 新增期：金额 0，日期按还款日递推
          const plan = generateRepaymentPlan({
            principal: Number(existing.principal),
            annualRate: Number(existing.annualRate),
            startDate: existing.startDate,
            termMonths: newTerm,
            repaymentDay: existing.repaymentDay,
            method: 'equal_installment',
          });
          const newPeriods = plan.filter((p) => p.periodNo > existing.termMonths);
          await tx.loanRepayment.createMany({
            data: newPeriods.map((p) => ({
              loanId: id,
              periodNo: p.periodNo,
              dueDate: p.dueDate,
              principalAmount: new Prisma.Decimal(0),
              interestAmount: new Prisma.Decimal(0),
              totalAmount: new Prisma.Decimal(0),
            })),
          });
        }
        await tx.loan.update({
          where: { id },
          data: { termMonths: newTerm },
        });
      }
    });

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

    const paidAt = dto.paidDate ? new Date(dto.paidDate) : new Date();
    // paidDate 落库为 DATE（截断到当日 00:00），流水时间同步为同一「当日 00:00」，
    // 使 undo 能按 paidDate 精确匹配撤销，且保证标记当日即计入「已支出」。
    const flowOccurredAt = new Date(paidAt);
    flowOccurredAt.setHours(0, 0, 0, 0);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.loanRepayment.update({
        where: { loanId_periodNo: { loanId, periodNo } },
        data: {
          paidAmount: new Prisma.Decimal(newPaid),
          status,
          paidDate: paidAt,
        },
      });

      // 手动标记已还（还款页）：把该期本金/利息流水时间同步为该「当日 00:00」，
      // 账本统计在标记当日即计入「已支出」；取消标记时由 undo 按 paidDate 精确匹配恢复。
      // 备注前缀匹配（贷款有备注时为「还款本金（备注）」等），与 noteWithLoan 拼接口径一致。
      if (dto.syncTransactionsToPaidAt && repayment.dueDate) {
        await tx.transaction.updateMany({
          where: {
            loanId,
            OR: [
              { note: { startsWith: '还款本金' } },
              { note: { startsWith: '还款利息' } },
            ],
            occurredAt: repayment.dueDate,
          },
          data: { occurredAt: flowOccurredAt },
        });
      }

      await this.recalcLoanStatus(loanId, tx);
      return updated;
    });
  }

  /** 撤销某期还款（恢复 pending） */
  async undoRepayment(loanId: string, periodNo: number) {
    return this.prisma.$transaction(async (tx) => {
      const repayment = await tx.loanRepayment.findUnique({
        where: { loanId_periodNo: { loanId, periodNo } },
      });
      if (!repayment) throw new NotFoundException('还款计划不存在');

      const updated = await tx.loanRepayment.update({
        where: { loanId_periodNo: { loanId, periodNo } },
        data: {
          paidAmount: new Prisma.Decimal(0),
          status: 'pending',
          paidDate: null,
        },
      });

      // 若此前手动标记已还把该期本金/利息流水挪到了 paidDate（当日 00:00），
      // 这里按 paidDate 精确匹配、只恢复本期的流水到计划到期日，不影响其它标记期；
      // 普通还款（流水本就在到期日）无匹配、无副作用。
      if (repayment.paidDate) {
        await tx.transaction.updateMany({
          where: {
            loanId,
            OR: [
              { note: { startsWith: '还款本金' } },
              { note: { startsWith: '还款利息' } },
            ],
            occurredAt: repayment.paidDate,
          },
          data: { occurredAt: repayment.dueDate },
        });
      }

      await this.recalcLoanStatus(loanId, tx);
      return updated;
    });
  }

  /** 根据还款进度更新贷款状态 */
  private async recalcLoanStatus(
    loanId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const repayments = await db.loanRepayment.findMany({
      where: { loanId },
    });
    const allPaid = repayments.length > 0 && repayments.every((r) => r.status === 'paid');
    await db.loan.update({
      where: { id: loanId },
      data: { status: allPaid ? 'paid_off' : 'active' },
    });
  }
}
