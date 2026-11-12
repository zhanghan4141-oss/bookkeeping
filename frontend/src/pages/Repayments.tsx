import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DatePicker, NavBar } from 'antd-mobile';
import { repaymentApi } from '../api/misc';
import { ledgerApi } from '../api/ledger';
import { useRepaymentLedgerSelection } from '../stores/repaymentLedgerSelection';
import LedgerSelectPopup from '../components/LedgerSelectPopup';
import type { Ledger } from '../types';
import { formatMoney } from '../lib/format';

export default function Repayments() {
  const selectedIds = useRepaymentLedgerSelection((s) => s.selectedIds);
  const toggle = useRepaymentLedgerSelection((s) => s.toggle);
  const [showPicker, setShowPicker] = useState(false);
  // 截止日期（默认未来 30 天）
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });

  // 截止日期 → 天数
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    const diff = Math.ceil((end.getTime() - today.getTime()) / (24 * 3600 * 1000));
    return Math.min(Math.max(diff, 1), 365);
  }, [endDate]);

  const { data } = useQuery({
    queryKey: ['repayments', 'upcoming', days, selectedIds],
    queryFn: async () => (await repaymentApi.upcoming(days, selectedIds)).data,
  });

  // 选中的账本对象（按原顺序）
  const selectedLedgers = useMemo(
    () => ledgers.filter((l) => selectedIds.includes(l.id)),
    [ledgers, selectedIds],
  );

  const pendingExpense = data?.pendingExpense;

  // 折叠展示：默认展开最近一天，其余折叠（待还款 / 待支出各自独立）
  const [expandedRepay, setExpandedRepay] = useState<Set<string>>(new Set());
  const [expandedExpense, setExpandedExpense] = useState<Set<string>>(new Set());

  useEffect(() => {
    const first = data?.daily?.[0]?.date;
    if (first) setExpandedRepay(new Set([first]));
  }, [data?.daily?.[0]?.date]);

  useEffect(() => {
    const first = pendingExpense?.daily?.[0]?.date;
    if (first) setExpandedExpense(new Set([first]));
  }, [pendingExpense?.daily?.[0]?.date]);

  const toggleRepay = (date: string) => {
    setExpandedRepay((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const toggleExpense = (date: string) => {
    setExpandedExpense((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

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
              <span className="text-secondary" style={{ fontSize: 13 }}>全部账本</span>
            )}
          </div>
          <span style={{ fontSize: 13, color: '#1677ff' }}>选择</span>
        </div>

        {/* 截止时间 */}
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
        >
          <span className="text-secondary" style={{ fontSize: 13 }}>统计截止时间</span>
          <DatePicker
            value={new Date(endDate)}
            min={new Date()}
            onConfirm={(v) => setEndDate(v.toISOString().slice(0, 10))}
          >
            {(value, actions) => (
              <div
                onClick={() => actions.open()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  color: '#1677ff',
                  fontSize: 13,
                }}
              >
                {value ? value.toISOString().slice(0, 10) : '选择日期'}（约 {days} 天）
              </div>
            )}
          </DatePicker>
        </div>

        {/* 汇总卡片 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div
            style={{
              flex: 1,
              background: '#fff',
              borderRadius: 12,
              padding: '16px',
              textAlign: 'center',
            }}
          >
            <div className="text-secondary" style={{ fontSize: 13 }}>待还款</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#52c41a' }}>
              ¥{formatMoney(data?.totalAmount ?? 0)}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              background: '#fff',
              borderRadius: 12,
              padding: '16px',
              textAlign: 'center',
            }}
          >
            <div className="text-secondary" style={{ fontSize: 13 }}>待支出</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#52c41a' }}>
              ¥{formatMoney(pendingExpense?.totalAmount ?? 0)}
            </div>
          </div>
        </div>

        {/* 待还款列表 */}
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>待还款</div>
        {data?.daily?.map((d: any) => {
          const isExpanded = expandedRepay.has(d.date);
          return (
            <div key={d.date} style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
              <div
                onClick={() => toggleRepay(d.date)}
                style={{
                  padding: '10px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  borderBottom: isExpanded ? '1px solid #f5f5f5' : 'none',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#bbb', fontSize: 12, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>
                    ▶
                  </span>
                  <span style={{ fontWeight: 600 }}>{d.date}</span>
                  <span style={{ fontSize: 12, color: '#999' }}>{d.items.length} 笔</span>
                </span>
                <span style={{ fontWeight: 700, color: '#999' }}>¥{formatMoney(d.total)}</span>
              </div>
              {isExpanded && d.items.map((it: any) => (
                <div key={it.repaymentId} style={{ fontSize: 13, color: '#666', padding: '8px 12px', borderBottom: '1px solid #fafafa' }}>
                  <span style={{ color: '#1677ff' }}>{it.loanName}</span> 第{it.periodNo}期 · 剩余{' '}
                  <span style={{ color: '#ff4d4f' }}>¥{formatMoney(it.remainingPrincipal)}</span>
                  /{it.remainingPeriods}期、本期{' '}
                  <span style={{ color: '#52c41a' }}>¥{formatMoney(it.totalAmount)}</span>
                  <span style={{ marginLeft: 6, color: it.status === 'overdue' ? '#ff4d4f' : '#999' }}>
                    {it.status === 'overdue' ? '逾期' : it.status === 'partial' ? '部分还' : '待还'}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
        {!data?.daily?.length && (
          <div style={{ textAlign: 'center', padding: 16, color: '#999', marginBottom: 16 }}>未来 30 天暂无待还款</div>
        )}

        {/* 待支出列表 */}
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8, marginTop: 16 }}>待支出</div>
        {pendingExpense?.daily?.map((d: any) => {
          const isExpanded = expandedExpense.has(d.date);
          return (
            <div key={d.date} style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
              <div
                onClick={() => toggleExpense(d.date)}
                style={{
                  padding: '10px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  borderBottom: isExpanded ? '1px solid #f5f5f5' : 'none',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#bbb', fontSize: 12, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>
                    ▶
                  </span>
                  <span style={{ fontWeight: 600 }}>{d.date}</span>
                  <span style={{ fontSize: 12, color: '#999' }}>{d.items.length} 笔</span>
                </span>
                <span style={{ fontWeight: 700, color: '#999' }}>¥{formatMoney(d.total)}</span>
              </div>
              {isExpanded && d.items.map((it: any) => (
                <div key={it.transactionId} style={{ fontSize: 13, color: '#666', padding: '8px 12px', borderBottom: '1px solid #fafafa' }}>
                  {it.categoryIcon || '💸'} {it.categoryName} · <span style={{ color: '#52c41a' }}>¥{formatMoney(it.amount)}</span>
                  {it.note && <span style={{ marginLeft: 6, color: '#999' }}>（{it.note}）</span>}
                </div>
              ))}
            </div>
          );
        })}
        {!pendingExpense?.daily?.length && (
          <div style={{ textAlign: 'center', padding: 16, color: '#999' }}>未来 30 天暂无待支出</div>
        )}
      </div>

      <LedgerSelectPopup
        visible={showPicker}
        onClose={() => setShowPicker(false)}
        ledgers={ledgers}
        selectedIds={selectedIds}
        onToggle={toggle}
      />
    </div>
  );
}
