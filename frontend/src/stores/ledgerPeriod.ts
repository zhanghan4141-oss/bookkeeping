import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LedgerPeriod = 'day' | 'month' | 'year' | 'all';

interface LedgerPeriodState {
  period: LedgerPeriod;
  setPeriod: (period: LedgerPeriod) => void;
}

/** 账本页统计周期：默认「当月」，切换后记住最后一次选择 */
export const useLedgerPeriodStore = create<LedgerPeriodState>()(
  persist(
    (set) => ({
      period: 'month',
      setPeriod: (period) => set({ period }),
    }),
    {
      name: 'bookkeeping-ledger-period',
    },
  ),
);
