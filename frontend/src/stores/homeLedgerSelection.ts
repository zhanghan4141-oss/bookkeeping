import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface HomeLedgerSelectionState {
  /** 未勾选的账本（统计不计入）；空 = 全部勾选（默认），全部未勾 = 统计 0 */
  deselectedIds: string[];
  toggle: (id: string) => void;
}

/**
 * 账本首页统计栏的「统计勾选」：勾选的账本进统计，默认全部勾选。
 * 仅影响账本页顶部统计栏，与统计页/还款页的选择状态相互独立；改动后本地记住。
 */
export const useHomeLedgerSelection = create<HomeLedgerSelectionState>()(
  persist(
    (set) => ({
      deselectedIds: [],
      toggle: (id) =>
        set((s) => ({
          deselectedIds: s.deselectedIds.includes(id)
            ? s.deselectedIds.filter((x) => x !== id)
            : [...s.deselectedIds, id],
        })),
    }),
    { name: 'bookkeeping-home-ledger-selection' },
  ),
);