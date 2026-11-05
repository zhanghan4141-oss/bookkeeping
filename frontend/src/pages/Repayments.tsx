import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavBar } from 'antd-mobile';
import { repaymentApi } from '../api/misc';
import { ledgerApi } from '../api/ledger';
import { useLedgerSelectionStore } from '../stores/ledgerSelection';
import LedgerSelectPopup from '../components/LedgerSelectPopup';
import type { Ledger } from '../types';

export default function Repayments() {
  const selectedIds = useLedgerSelectionStore((s) => s.selectedIds);
  const [showPicker, setShowPicker] = useState(false);

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });

  // 若没有选中任何账本，默认选中最近编辑的账本
  const latestLedger = useMemo(() => {
    if (ledgers.length === 0) return null;
    return [...ledgers].sort((a, b) => {
      const ta = a.updatedAt ?? a.createdAt ?? '';
      const tb = b.updatedAt ?? b.createdAt ?? '';
      return tb.localeCompare(ta);
    })[0];
  }, [ledgers]);

  const selectOne = useLedgerSelectionStore((s) => s.selectOne);

  useEffect(() => {
    if (selectedIds.length === 0 && latestLedger) {
      selectOne(latestLedger.id);
    }
  }, [latestLedger, selectedIds.length, selectOne]);

  const { data } = useQuery({
    queryKey: ['repayments', 'upcoming', 30, selectedIds],
    queryFn: async () => (await repaymentApi.upcoming(30, selectedIds)).data,
  });

  // 选中的账本对象（按原顺序）
  const selectedLedgers = useMemo(
    () => ledgers.filter((l) => selectedIds.includes(l.id)),
    [ledgers, selectedIds],
  );

  const pendingExpense = data?.pendingExpense;

  return (
    <div className="page">
      <NavBar back={null} style={{ background: '#fff' }}>
        还款计划
      </NavBar>

      <div style={{ padding: 16 }}>
        {/* 账本筛选（折叠显示，点开弹窗多选） */}
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
          onClick={() => setShowPicker(true)}
        >
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, flex: 1 }}>
            <span className="text-secondary" style={{ fontSize: 13 }}>账本</span>
            {selectedLedgers.slice(0, 3).map((l) => (
              <span
                key={l.id}
                style={{
                  padding: '4px 10px',
                  borderRadius: 12,
                  background: '#e6f4ff',
                  color: '#1677ff',
                  fontSize: 13,
                }}
              >
                {l.name}
              </span>
            ))}
            {selectedLedgers.length > 3 && (
              <span style={{ fontSize: 13, color: '#666' }}>+{selectedLedgers.length - 3}</span>
            )}
            {selectedLedgers.length === 0 && (
              <span className="text-secondary" style={{ fontSize: 13 }}>点击选择</span>
            )}
          </div>
          <span style={{ fontSize: 13, color: '#1677ff' }}>选择</span>
        </div>

        {/* 汇总卡片 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div
            style={{
              flex: 1,
              background: 'linear-gradient(135deg, #722ed1, #b37feb)',
              borderRadius: 12,
              color: '#fff',
              padding: '16px',
            }}
          >
            <div style={{ fontSize: 13, opacity: 0.9 }}>待还款</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>¥{(data?.totalAmount ?? 0).toFixed(2)}</div>
          </div>
          <div
            style={{
              flex: 1,
              background: 'linear-gradient(135deg, #1677ff, #69b1ff)',
              borderRadius: 12,
              color: '#fff',
              padding: '16px',
            }}
          >
            <div style={{ fontSize: 13, opacity: 0.9 }}>待支出</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>¥{(pendingExpense?.totalAmount ?? 0).toFixed(2)}</div>
          </div>
        </div>

        {/* 待还款列表 */}
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>待还款</div>
        {data?.daily?.map((d: any) => (
          <div key={d.date} style={{ background: '#fff', borderRadius: 12, padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>{d.date}</span>
              <span style={{ fontWeight: 700, color: '#ff4d4f' }}>¥{d.total.toFixed(2)}</span>
            </div>
            {d.items.map((it: any) => (
              <div key={it.repaymentId} style={{ fontSize: 13, color: '#666', padding: '4px 0' }}>
                {it.loanName} 第{it.periodNo}期 · 剩余 ¥{it.remain.toFixed(2)}
                <span style={{ marginLeft: 6, color: it.status === 'overdue' ? '#ff4d4f' : '#999' }}>
                  {it.status === 'overdue' ? '逾期' : it.status === 'partial' ? '部分还' : '待还'}
                </span>
              </div>
            ))}
          </div>
        ))}
        {!data?.daily?.length && (
          <div style={{ textAlign: 'center', padding: 16, color: '#999', marginBottom: 16 }}>未来 30 天暂无待还款</div>
        )}

        {/* 待支出列表 */}
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8, marginTop: 16 }}>待支出</div>
        {pendingExpense?.daily?.map((d: any) => (
          <div key={d.date} style={{ background: '#fff', borderRadius: 12, padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>{d.date}</span>
              <span style={{ fontWeight: 700, color: '#1677ff' }}>¥{d.total.toFixed(2)}</span>
            </div>
            {d.items.map((it: any) => (
              <div key={it.transactionId} style={{ fontSize: 13, color: '#666', padding: '4px 0' }}>
                {it.categoryIcon || '💸'} {it.categoryName} · ¥{it.amount.toFixed(2)}
                {it.note && <span style={{ marginLeft: 6, color: '#999' }}>（{it.note}）</span>}
              </div>
            ))}
          </div>
        ))}
        {!pendingExpense?.daily?.length && (
          <div style={{ textAlign: 'center', padding: 16, color: '#999' }}>未来 30 天暂无待支出</div>
        )}
      </div>

      <LedgerSelectPopup
        visible={showPicker}
        onClose={() => setShowPicker(false)}
        ledgers={ledgers}
      />
    </div>
  );
}
