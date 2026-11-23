import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SpaceSelectionState {
  /** 账本页当前所选空间；null = 默认分组（共享账本 + 我拥有但未归类的账本） */
  selectedSpaceId: string | null;
  setSpace: (id: string | null) => void;
}

/**
 * 账本页空间选择（个人私有分组）。persist 可能残留已删除空间 id，
 * Ledgers 页用 spaces 列表兜底归 null。退出账号时重置。
 */
export const useSpaceSelection = create<SpaceSelectionState>()(
  persist(
    (set) => ({
      selectedSpaceId: null,
      setSpace: (id) => set({ selectedSpaceId: id }),
    }),
    { name: 'bookkeeping-home-space-selection' },
  ),
);