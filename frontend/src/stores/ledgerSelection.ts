import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LedgerSelectionState {
  selectedIds: string[];
  /** 单选：清空其他，只选这一个（点击账本列表时） */
  selectOne: (id: string) => void;
  /** 多选切换（弹窗里） */
  toggle: (id: string) => void;
  /** 直接设置选中的集合 */
  setSelected: (ids: string[]) => void;
}

export const useLedgerSelectionStore = create<LedgerSelectionState>()(
  persist(
    (set) => ({
      selectedIds: [],
      selectOne: (id) => set({ selectedIds: [id] }),
      toggle: (id) =>
        set((s) => ({
          selectedIds: s.selectedIds.includes(id)
            ? s.selectedIds.filter((x) => x !== id)
            : [...s.selectedIds, id],
        })),
      setSelected: (ids) => set({ selectedIds: ids }),
    }),
    {
      name: 'bookkeeping-ledger-selection',
    },
  ),
);
