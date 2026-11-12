import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface RepaymentLedgerSelectionState {
  /** 选中的账本（保持「选中顺序」） */
  selectedIds: string[];
  /** 最近取消选中的账本（最新在最前），用于行内灰色区的展示顺序 */
  deselectedIds: string[];
  /** 多选切换（弹窗/行内 chip 点击） */
  toggle: (id: string) => void;
  /** 直接设置选中的集合 */
  setSelected: (ids: string[]) => void;
}

/**
 * 还款页独立的账本筛选状态（与账本列表/统计页的选中状态分开）。
 * 默认空 = 统计全部账本。
 */
export const useRepaymentLedgerSelection = create<RepaymentLedgerSelectionState>()(
  persist(
    (set) => ({
      selectedIds: [],
      deselectedIds: [],
      toggle: (id) =>
        set((s) =>
          s.selectedIds.includes(id)
            ? {
                // 取消选中：移出选中队列，放到灰色区最前（紧跟在最后一个选中后面）
                selectedIds: s.selectedIds.filter((x) => x !== id),
                deselectedIds: [id, ...s.deselectedIds.filter((x) => x !== id)],
              }
            : {
                // 选中：追加到选中队列末尾
                selectedIds: [...s.selectedIds, id],
                deselectedIds: s.deselectedIds.filter((x) => x !== id),
              },
        ),
      setSelected: (ids) => set({ selectedIds: ids }),
    }),
    {
      name: 'bookkeeping-repayment-ledger-selection',
    },
  ),
);
