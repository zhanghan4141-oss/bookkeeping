import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

function safeJson(s: string | null): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ledgerId: string, limit: number, offset: number) {
    const logs = await this.prisma.auditLog.findMany({
      where: { ledgerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const userIds = [...new Set(logs.map((l) => l.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nickname: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.nickname]));

    return logs.map((l) => ({
      id: l.id,
      userId: l.userId,
      nickname: userMap.get(l.userId) ?? '未知用户',
      action: l.action,
      entity: l.entity,
      summary: l.summary,
      before: safeJson(l.before),
      after: safeJson(l.after),
      createdAt: l.createdAt,
    }));
  }
}
