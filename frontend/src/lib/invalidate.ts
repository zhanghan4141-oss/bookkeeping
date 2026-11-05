import type { QueryClient } from '@tanstack/react-query';

/**
 * 财务数据变更后统一失效相关缓存，避免「操作完要手动刷新才显示最新数据」。
 * 覆盖：流水、统计、还款、贷款、账本汇总。
 * 记账、贷款增删改、提前还款、导入导出、分类增删等操作后调用。
 */
export function invalidateFinancialData(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['transactions'] });
  queryClient.invalidateQueries({ queryKey: ['stats'] });
  queryClient.invalidateQueries({ queryKey: ['repayments'] });
  queryClient.invalidateQueries({ queryKey: ['loans'] });
  queryClient.invalidateQueries({ queryKey: ['loan'] });
  queryClient.invalidateQueries({ queryKey: ['ledger-summaries'] });
}
