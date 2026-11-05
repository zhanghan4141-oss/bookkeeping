import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { generateRepaymentPlan } from '../loan/loan-calculator.js';

const TRANSACTION_COLUMNS = ['日期', '类型', '类别', '金额', '备注', '记录人'];

@Injectable()
export class ImportExportService {
  constructor(private readonly prisma: PrismaService) {}

  /** 导出某账本某月流水为 .xlsx buffer */
  async exportTransactions(
    ledgerId: string,
    month: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const start = new Date(`${month}-01T00:00:00`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const transactions = await this.prisma.transaction.findMany({
      where: { ledgerId, occurredAt: { gte: start, lt: end } },
      include: {
        category: { select: { name: true } },
        user: { select: { nickname: true } },
      },
      orderBy: { occurredAt: 'asc' },
    });

    const ledger = await this.prisma.ledger.findUnique({ where: { id: ledgerId } });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('流水');
    sheet.columns = TRANSACTION_COLUMNS.map((header) => ({
      header,
      key: header,
      width: header === '备注' ? 30 : 15,
    }));

    for (const tx of transactions) {
      sheet.addRow({
        日期: tx.occurredAt.toISOString().slice(0, 10),
        类型: tx.type === 'expense' ? '支出' : tx.type === 'income' ? '收入' : '转账',
        类别: tx.category?.name ?? '',
        金额: Number(tx.amount),
        备注: tx.note ?? '',
        记录人: tx.user.nickname,
      });
    }

    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    return { buffer, filename: `${ledger?.name ?? '流水'}_${month}.xlsx` };
  }

  /** 导入流水：解析 .xlsx，返回成功/失败明细 */
  async importTransactions(
    ledgerId: string,
    userId: string,
    buffer: Buffer,
  ): Promise<{ successCount: number; errors: { row: number; message: string }[] }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('Excel 文件为空');

    // 读取类别映射
    const categories = await this.prisma.category.findMany({ where: { ledgerId } });
    const categoryByName = new Map(categories.map((c) => [c.name, c]));

    const errors: { row: number; message: string }[] = [];
    let successCount = 0;
    const rows: any[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // 表头
      const dateVal = row.getCell(1).value;
      const typeStr = String(row.getCell(2).value ?? '').trim();
      const categoryName = String(row.getCell(3).value ?? '').trim();
      const amount = Number(row.getCell(4).value);
      const note = String(row.getCell(5).value ?? '').trim();

      if (!dateVal || !typeStr || !amount) {
        errors.push({ row: rowNumber, message: '日期/类型/金额不能为空' });
        return;
      }
      const typeMap: Record<string, string> = { 支出: 'expense', 收入: 'income', 转账: 'transfer' };
      const type = typeMap[typeStr];
      if (!type) {
        errors.push({ row: rowNumber, message: `类型「${typeStr}」无效（应为 支出/收入/转账）` });
        return;
      }
      const category = categoryName ? categoryByName.get(categoryName) : undefined;
      if (categoryName && !category) {
        errors.push({ row: rowNumber, message: `类别「${categoryName}」不存在，请先在账本中创建` });
        return;
      }
      const occurredAt = new Date(dateVal as string | Date);
      if (isNaN(occurredAt.getTime())) {
        errors.push({ row: rowNumber, message: `日期「${dateVal}」格式无效` });
        return;
      }
      rows.push({ ledgerId, userId, type, categoryId: category?.id ?? null, amount: new Prisma.Decimal(amount), note, occurredAt });
    });

    if (rows.length > 0) {
      await this.prisma.transaction.createMany({ data: rows });
      successCount = rows.length;
    }

    return { successCount, errors };
  }

  /** 导出贷款还款计划 */
  async exportLoan(loanId: string): Promise<{ buffer: Buffer; filename: string }> {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: { repayments: { orderBy: { periodNo: 'asc' } } },
    });
    if (!loan) throw new NotFoundException('贷款不存在');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('还款计划');
    sheet.columns = [
      { header: '期数', key: 'periodNo', width: 10 },
      { header: '到期日', key: 'dueDate', width: 15 },
      { header: '本金', key: 'principal', width: 15 },
      { header: '利息', key: 'interest', width: 15 },
      { header: '合计', key: 'total', width: 15 },
    ];
    for (const r of loan.repayments) {
      sheet.addRow({
        periodNo: r.periodNo,
        dueDate: (r.dueDate as Date).toISOString().slice(0, 10),
        principal: Number(r.principalAmount),
        interest: Number(r.interestAmount),
        total: Number(r.totalAmount),
      });
    }
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    return { buffer, filename: `${loan.name}_还款计划.xlsx` };
  }

  /** 导入自定义还款计划 */
  async importLoan(
    loanId: string,
    buffer: Buffer,
  ): Promise<{ success: boolean; periods: number }> {
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan) throw new NotFoundException('贷款不存在');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('Excel 文件为空');

    const customPeriods: { dueDate: Date; totalAmount: number }[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const dueDate = new Date(row.getCell(2).value as string | Date);
      const total = Number(row.getCell(5).value);
      if (!isNaN(dueDate.getTime()) && !isNaN(total)) {
        customPeriods.push({ dueDate, totalAmount: total });
      }
    });

    if (customPeriods.length !== loan.termMonths) {
      throw new BadRequestException(
        `期数不匹配：Excel 有 ${customPeriods.length} 期，贷款需要 ${loan.termMonths} 期`,
      );
    }

    const plan = generateRepaymentPlan({
      principal: Number(loan.principal),
      annualRate: Number(loan.annualRate),
      startDate: loan.startDate,
      termMonths: loan.termMonths,
      repaymentDay: loan.repaymentDay,
      method: 'custom',
      customPeriods,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.loanRepayment.deleteMany({ where: { loanId } });
      await tx.loanRepayment.createMany({
        data: plan.map((p) => ({
          loanId,
          periodNo: p.periodNo,
          dueDate: p.dueDate,
          principalAmount: new Prisma.Decimal(p.principalAmount),
          interestAmount: new Prisma.Decimal(p.interestAmount),
          totalAmount: new Prisma.Decimal(p.totalAmount),
        })),
      });
    });

    return { success: true, periods: plan.length };
  }
}
