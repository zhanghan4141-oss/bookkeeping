import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateReminderSettingDto } from './dto/settings.dto.js';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getReminder(userId: string) {
    const setting = await this.prisma.reminderSetting.findUnique({
      where: { userId },
    });
    if (setting) return setting;
    return this.prisma.reminderSetting.create({
      data: { userId },
    });
  }

  async updateReminder(userId: string, dto: UpdateReminderSettingDto) {
    const existing = await this.prisma.reminderSetting.findUnique({
      where: { userId },
    });
    const data: any = { ...dto };
    // 更新邮箱时若 email 未提供，保留原值
    if (existing) {
      return this.prisma.reminderSetting.update({
        where: { userId },
        data,
      });
    }
    return this.prisma.reminderSetting.create({
      data: { userId, ...data },
    });
  }
}
