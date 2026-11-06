import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface RepaymentLedgerSelectionState {
  selectedIds: string[];
  /** 多选切换（弹窗里） */
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
      toggle: (id) =>
        set((s) => ({
          selectedIds: s.selectedIds.includes(id)
            ? s.selectedIds.filter((x) => x !== id)
            : [...s.selectedIds, id],
        })),
      setSelected: (ids) => set({ selectedIds: ids }),
    }),
    {
      name: 'bookkeeping-repayment-ledger-selection',
    },
  ),
);
