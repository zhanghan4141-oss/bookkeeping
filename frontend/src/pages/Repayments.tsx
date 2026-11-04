import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavBar } from 'antd-mobile';
import { repaymentApi } from '../api/misc';
import { ledgerApi } from '../api/ledger';
import type { Ledger } from '../types';

export default function Repayments() {
  const [selected, setSelected] = useState<string[]>([]);

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });

  // 最近编辑过的账本（updatedAt 最新，兜底 createdAt 最新）
  const latestLedger = useMemo(() => {
    if (ledgers.length === 0) return null;
    return [...ledgers].sort((a, b) => {
      const ta = a.updatedAt ?? a.createdAt ?? '';
      const tb = b.updatedAt ?? b.createdAt ?? '';
      return tb.localeCompare(ta);
    })[0];
  }, [ledgers]);

  // 初始默认选中最近编辑的账本
  useEffect(() => {
    if (selected.length === 0 && latestLedger) {
      setSelected([latestLedger.id]);
    }
  }, [latestLedger, selected.length]);

  const { data } = useQuery({
    queryKey: ['repayments', 'upcoming', 30, selected],
    queryFn: async () => (await repaymentApi.upcoming(30, selected)).data,
  });

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // 选中的账本排前面
  const sortedLedgers = useMemo(() => {
    return [...ledgers].sort((a, b) => {
      const aSelected = selected.includes(a.id) ? 1 : 0;
      const bSelected = selected.includes(b.id) ? 1 : 0;
      return bSelected - aSelected;
    });
  }, [ledgers, selected]);

  const pendingExpense = data?.pendingExpense;

  return (
    <div className="page">
      <NavBar back={null} style={{ background: '#fff' }}>
        还款计划
      </NavBar>

      <div style={{ padding: 16 }}>
        {/* 账本筛选 */}
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <div className="text-secondary" style={{ fontSize: 13, marginBottom: 8 }}>
            统计账本（可多选）
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {sortedLedgers.map((l) => {
              const isSelected = selected.includes(l.id);
              return (
                <div
                  key={l.id}
                  onClick={() => toggle(l.id)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 16,
                    fontSize: 13,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    background: isSelected ? '#1677ff' : '#f5f5f5',
                    color: isSelected ? '#fff' : '#333',
                    border: isSelected ? '1px solid #1677ff' : '1px solid transparent',
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  {isSelected ? '✓ ' : ''}{l.name}
                </div>
              );
            })}
          </div>
          {ledgers.length === 0 && (
            <div className="text-secondary" style={{ fontSize: 13 }}>暂无账本</div>
          )}
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
    </div>
  );
}
