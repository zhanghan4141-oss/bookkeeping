import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface StatLedgerSelectionState {
  /** 选中的账本（保持「选中顺序」） */
  selectedIds: string[];
  /** 最近取消选中的账本（最新在最前），用于行内灰色区的展示顺序 */
  deselectedIds: string[];
  /** 单选：清空其他，只选这一个（首次进入统计页默认选中最近账本） */
  selectOne: (id: string) => void;
  /** 多选切换（弹窗/行内 chip 点击） */
  toggle: (id: string) => void;
  /** 直接设置选中的集合 */
  setSelected: (ids: string[]) => void;
}

/**
 * 统计页独立的账本筛选状态，与账本列表页（ledgerSelection）分开，互不影响。
 */
export const useStatLedgerSelection = create<StatLedgerSelectionState>()(
  persist(
    (set) => ({
      selectedIds: [],
      deselectedIds: [],
      selectOne: (id) => set({ selectedIds: [id] }),
      toggle: (id) =>
        set((s) =>
          s.selectedIds.includes(id)
            ? {
                selectedIds: s.selectedIds.filter((x) => x !== id),
                deselectedIds: [id, ...s.deselectedIds.filter((x) => x !== id)],
              }
            : {
                selectedIds: [...s.selectedIds, id],
                deselectedIds: s.deselectedIds.filter((x) => x !== id),
              },
        ),
      setSelected: (ids) => set({ selectedIds: ids }),
    }),
    {
      name: 'bookkeeping-stat-ledger-selection',
    },
  ),
);
