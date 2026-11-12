import { AsyncLocalStorage } from 'async_hooks';

interface Context {
  userId?: string;
}

const storage = new AsyncLocalStorage<Context>();

/** 在请求生命周期内运行 fn，使后续 Prisma 中间件能拿到当前操作人 userId */
export function runWithContext<T>(ctx: Context, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** 当前请求的操作人 userId（无登录时返回 undefined） */
export function getCurrentUserId(): string | undefined {
  return storage.getStore()?.userId;
}
