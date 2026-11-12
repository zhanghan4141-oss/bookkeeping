import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LedgerSelectionState {
  /** 选中的账本（保持「选中顺序」） */
  selectedIds: string[];
  /** 最近取消选中的账本（最新在最前），用于行内灰色区的展示顺序 */
  deselectedIds: string[];
  /** 单选：清空其他，只选这一个（点击账本列表时） */
  selectOne: (id: string) => void;
  /** 多选切换（弹窗/行内 chip 点击） */
  toggle: (id: string) => void;
  /** 直接设置选中的集合 */
  setSelected: (ids: string[]) => void;
}

export const useLedgerSelectionStore = create<LedgerSelectionState>()(
  persist(
    (set) => ({
      selectedIds: [],
      deselectedIds: [],
      selectOne: (id) => set({ selectedIds: [id] }),
      toggle: (id) =>
        set((s) =>
          s.selectedIds.includes(id)
            ? {
                // 取消选中：移出选中队列，放到灰色区最前
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
      name: 'bookkeeping-ledger-selection',
    },
  ),
);
