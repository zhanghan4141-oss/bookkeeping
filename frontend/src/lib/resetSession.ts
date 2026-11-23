import { queryClient } from './queryClient';
import { useLedgerSelectionStore } from '../stores/ledgerSelection';
import { useStatLedgerSelection } from '../stores/statLedgerSelection';
import { useRepaymentLedgerSelection } from '../stores/repaymentLedgerSelection';
import { useLedgerPeriodStore } from '../stores/ledgerPeriod';
import { useSpaceSelection } from '../stores/spaceSelection';

/**
 * 切换账号时重置所有用户相关的内存/持久化状态：
 * - queryClient 缓存：否则新账号首屏会先用上一个账号的缓存渲染 → 短暂闪现旧数据
 * - 各页账本选择 / 统计周期等用户级偏好（按账号隔离）
 * - 账本详情页右上周期偏好（localStorage）
 */
export function resetUserSession() {
  queryClient.clear();
  useLedgerSelectionStore.setState({ selectedIds: [], deselectedIds: [] });
  useStatLedgerSelection.setState({ selectedIds: [], deselectedIds: [] });
  useRepaymentLedgerSelection.setState({ selectedIds: [], deselectedIds: [] });
  useLedgerPeriodStore.setState({ period: 'month' });
  useSpaceSelection.setState({ selectedSpaceId: null });
  localStorage.removeItem('ledger-detail-period');
  localStorage.removeItem('bookkeeping-repayment-enddate');
}