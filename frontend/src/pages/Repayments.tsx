import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Checkbox, NavBar } from 'antd-mobile';
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

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) =>
      checked ? [...prev, id] : prev.filter((x) => x !== id),
    );
  };

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
            {ledgers.map((l) => (
              <Checkbox
                key={l.id}
                checked={selected.includes(l.id)}
                onChange={(checked) => toggle(l.id, checked)}
              >
                {l.name}
              </Checkbox>
            ))}
          </div>
          {ledgers.length === 0 && (
            <div className="text-secondary" style={{ fontSize: 13 }}>暂无账本</div>
          )}
        </div>

        <div
          style={{
            background: 'linear-gradient(135deg, #722ed1, #b37feb)',
            borderRadius: 12,
            color: '#fff',
            padding: '20px',
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 13, opacity: 0.9 }}>未来 30 天待还总额</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>¥{(data?.totalAmount ?? 0).toFixed(2)}</div>
        </div>

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
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>未来 30 天暂无待还款</div>
        )}
      </div>
    </div>
  );
}
