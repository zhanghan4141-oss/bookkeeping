import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter | null {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
      return null;
    }
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT ?? 465),
        secure: process.env.SMTP_SECURE !== 'false',
        auth: { user, pass },
      });
    }
    return this.transporter;
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    const transporter = this.getTransporter();
    if (!transporter) {
      this.logger.warn('SMTP 未配置，跳过邮件发送');
      return false;
    }
    try {
      await transporter.sendMail({
        from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
        to,
        subject,
        html,
      });
      return true;
    } catch (e) {
      this.logger.error(`邮件发送失败: ${(e as Error).message}`);
      return false;
    }
  }
}
