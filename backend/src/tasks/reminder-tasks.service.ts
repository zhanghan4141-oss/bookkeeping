import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MailService } from '../common/mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ReminderTasksService {
  private readonly logger = new Logger(ReminderTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /** 每日 08:00 扫描 */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async handleDailyReminder() {
    this.logger.log('开始执行每日还款提醒');
    await this.settleExpired();
    await this.sendReminders();
    this.logger.log('每日还款提醒完成');
  }

  /** 手动触发（测试用），通过 HTTP 调用 */
  async runNow() {
    await this.settleExpired();
    await this.sendReminders();
    return { success: true };
  }

  /** 自动标记到期已还：dueDate < today 且未还清 → 标为已还 */
  private async settleExpired() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.prisma.$executeRaw`
      UPDATE loanrepayment
      SET status = 'paid', paid_amount = total_amount, paid_date = due_date
      WHERE due_date < ${today}
        AND status IN ('pending', 'partial', 'overdue')
    `;
  }

  /** 发送还款提醒：leadDays 内到期且未还清 */
  private async sendReminders() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const settings = await this.prisma.reminderSetting.findMany();
    // 按用户索引设置
    const settingByUser = new Map(settings.map((s) => [s.userId, s]));

    // 找出所有 leadDays 内到期的未还清计划
    const owners = await this.prisma.ledgerMember.findMany({
      where: { role: 'owner' },
      include: { ledger: { include: { loans: true } } },
    });

    for (const owner of owners) {
      const setting = settingByUser.get(owner.userId);
      if (!setting) continue;

      const leadDays = setting.leadDays;
      const deadline = new Date(today);
      deadline.setDate(deadline.getDate() + leadDays);

      const dueRepayments = await this.prisma.loanRepayment.findMany({
        where: {
          loanId: { in: owner.ledger.loans.map((l) => l.id) },
          dueDate: { gte: today, lte: deadline },
          status: { in: ['pending', 'partial'] },
        },
        include: { loan: true },
        orderBy: { dueDate: 'asc' },
      });

      if (dueRepayments.length === 0) continue;

      // 生成站内通知（每个 owner 一条汇总）
      if (setting.inappEnabled) {
        const lines = dueRepayments
          .map((r) => {
            const d = (r.dueDate as Date).toISOString().slice(0, 10);
            const remain = Number(r.totalAmount) - Number(r.paidAmount);
            return `${r.loan.name} 第${r.periodNo}期 应还 ${remain.toFixed(2)} 元（${d}）`;
          })
          .join('；');
        await this.prisma.notification.create({
          data: {
            userId: owner.userId,
            type: 'loan_reminder',
            title: `未来 ${leadDays} 天内有 ${dueRepayments.length} 笔还款到期`,
            content: lines,
            relatedLoanId: dueRepayments[0].loanId,
          },
        });
      }

      // 发邮件
      if (setting.emailEnabled && setting.email) {
        const rows = dueRepayments
          .map((r) => {
            const d = (r.dueDate as Date).toISOString().slice(0, 10);
            const remain = Number(r.totalAmount) - Number(r.paidAmount);
            return `<li>${r.loan.name} 第${r.periodNo}期：应还 ${remain.toFixed(2)} 元，到期日 ${d}</li>`;
          })
          .join('');
        const html = `
          <h3>还款提醒</h3>
          <p>以下 ${dueRepayments.length} 笔还款将在未来 ${leadDays} 天内到期：</p>
          <ul>${rows}</ul>
        `;
        await this.mailService.send(setting.email, '还款提醒', html);
      }
    }
  }
}
