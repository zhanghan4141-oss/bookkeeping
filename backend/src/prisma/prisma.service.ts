import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
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

/** 根据模型名取对应的 Prisma 委托（如 Loan -> loan） */
function getDelegate(client: any, model: string): any {
  return client[model.charAt(0).toLowerCase() + model.slice(1)];
}

/**
 * 统一审计钩子：只记 update / delete（不记新增/导入）。
 * - 用「基础客户端」取改前值、写日志，避免在钩子内再次触发审计导致递归。
 * - 日志写入失败不影响主操作。
 */
async function runAudit(
  client: any,
  model: string,
  action: 'update' | 'delete',
  args: any,
  query: (a: any) => any,
) {
  if (!AUDIT_MODELS.includes(model)) return query(args);

  const userId = getCurrentUserId();
  if (!userId) return query(args);

  let before: any = null;
  try {
    const delegate = getDelegate(client, model);
    if (delegate?.findUnique) {
      before = await delegate.findUnique({ where: args.where });
    }
  } catch {
    // 取改前值失败则跳过日志
  }

  const result = await query(args);

  if (before) {
    const ledgerId = before.ledgerId ?? result?.ledgerId;
    if (ledgerId) {
      try {
        await client.auditLog.create({
          data: {
            ledgerId,
            userId,
            action,
            entity: model,
            entityId: before.id ?? args.where?.id,
            summary: buildSummary(model, action, before),
            before: JSON.stringify(before),
            after: action === 'update' && result ? JSON.stringify(result) : null,
          },
        });
      } catch {
        // 日志写入失败不影响主操作
      }
    }
  }

  return result;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super();
    // 基础客户端：取改前值、写审计日志用（未扩展，不会递归触发钩子）
    const raw = this;

    const auditExtension = Prisma.defineExtension({
      name: 'audit-log',
      query: {
        $allModels: {
          async update({ model, args, query }: any) {
            return runAudit(raw, model, 'update', args, query);
          },
          async delete({ model, args, query }: any) {
            return runAudit(raw, model, 'delete', args, query);
          },
        },
      },
    });
    const extended = this.$extends(auditExtension);

    // 把模型委托 / $transaction / $connect 等转发到扩展后的客户端，使 update/delete 走审计钩子；
    // 生命周期方法与 constructor 仍指向本实例。
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (
          prop === 'constructor' ||
          prop === 'onModuleInit' ||
          prop === 'onModuleDestroy'
        ) {
          return Reflect.get(target, prop, receiver);
        }
        const extVal = (extended as any)[prop];
        if (extVal !== undefined) {
          return typeof extVal === 'function'
            ? (extVal as (...a: any[]) => any).bind(extended)
            : extVal;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
