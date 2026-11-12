import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getCurrentUserId } from '../common/request-context.js';

/** 需要记录日志的模型（有 ledgerId 字段） */
const AUDIT_MODELS = ['Transaction', 'Loan', 'Category', 'Ledger', 'LedgerMember'];

const ENTITY_LABEL: Record<string, string> = {
  Transaction: '流水',
  Loan: '贷款',
  Category: '分类',
  Ledger: '账本',
  LedgerMember: '成员',
};

function buildSummary(entity: string, action: string, before: any): string {
  const label = ENTITY_LABEL[entity] ?? entity;
  const verb = action === 'delete' ? '删除' : '修改';
  const name = before?.name ?? before?.note ?? '';
  return `${verb}了${label}${name ? `「${name}」` : ''}`;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    this.registerAuditMiddleware();
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private registerAuditMiddleware() {
    (this as any).$use(async (params: any, next: (arg: any) => any) => {
      // 只记录修改和删除（不记录新增）
      if (params.action !== 'update' && params.action !== 'delete') {
        return next(params);
      }
      // 排除日志表本身，避免递归
      if (params.model === 'AuditLog') {
        return next(params);
      }
      if (!AUDIT_MODELS.includes(params.model)) {
        return next(params);
      }

      const userId = getCurrentUserId();
      if (!userId) {
        return next(params);
      }

      // 取改前 / 被删的旧值
      let before: any = null;
      try {
        const delegate = this.getDelegate(params.model);
        before = await delegate.findUnique({ where: params.args.where });
      } catch {
        // 查询失败则跳过日志
      }

      const result = await next(params);

      if (before) {
        const ledgerId = before.ledgerId ?? result?.ledgerId;
        if (ledgerId) {
          try {
            await this.auditLog.create({
              data: {
                ledgerId,
                userId,
                action: params.action,
                entity: params.model,
                entityId: before.id ?? params.args.where?.id,
                summary: buildSummary(params.model, params.action, before),
                before: JSON.stringify(before),
                after:
                  params.action === 'update' && result
                    ? JSON.stringify(result)
                    : null,
              },
            });
          } catch {
            // 日志写入失败不影响主操作
          }
        }
      }

      return result;
    });
  }

  private getDelegate(model: string): any {
    const name = model.charAt(0).toLowerCase() + model.slice(1);
    return (this as any)[name];
  }
}
