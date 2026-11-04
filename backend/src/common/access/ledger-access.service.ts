import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export type LedgerRole = 'owner' | 'editor' | 'viewer';

@Injectable()
export class LedgerAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** 获取用户在账本中的角色，null 表示非成员 */
  async getRole(ledgerId: string, userId: string): Promise<LedgerRole | null> {
    const member = await this.prisma.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId } },
    });
    return (member?.role as LedgerRole) ?? null;
  }

  /** 必须是成员（owner/editor/viewer 均可读） */
  async assertMember(ledgerId: string, userId: string): Promise<void> {
    const role = await this.getRole(ledgerId, userId);
    if (!role) {
      throw new NotFoundException('账本不存在或无权访问');
    }
  }

  /** 必须是 owner 或 editor（可写） */
  async assertWritable(ledgerId: string, userId: string): Promise<void> {
    const role = await this.getRole(ledgerId, userId);
    if (role !== 'owner' && role !== 'editor') {
      throw new ForbiddenException('无操作权限');
    }
  }

  /** 必须是 owner */
  async assertOwner(ledgerId: string, userId: string): Promise<void> {
    const role = await this.getRole(ledgerId, userId);
    if (role !== 'owner') {
      throw new ForbiddenException('仅账本创建者可操作');
    }
  }
}
