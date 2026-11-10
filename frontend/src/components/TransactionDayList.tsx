import { useEffect, useMemo, useState } from 'react';
import type { Transaction } from '../types';

function groupByDate(list: Transaction[]) {
  const map = new Map<string, Transaction[]>();
  for (const t of list) {
    const key = t.occurredAt.slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return Array.from(map.entries());
}

function fmt(n: string | number) {
  return Number(n).toFixed(2);
}

function formatDateTime(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface Props {
  transactions: Transaction[];
  /** 多账本统计时显示账本名 */
  showLedgerName?: boolean;
  emptyText?: string;
}

/** 只读流水列表：按天折叠展示，无复制/删除/编辑按钮 */
export default function TransactionDayList({
  transactions,
  showLedgerName,
  emptyText = '暂无流水',
}: Props) {
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupByDate(transactions), [transactions]);

  useEffect(() => {
    setExpandedDates(groups.length > 0 ? new Set([groups[0][0]]) : new Set());
  }, [groups]);

  const toggleDate = (date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  return (
    <div>
      {groups.map(([date, items]) => {
        const dayIncome = items.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const dayExpense = items.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
        const isExpanded = expandedDates.has(date);
        return (
          <div key={date} style={{ background: '#fff', marginBottom: 8, borderRadius: 12, overflow: 'hidden' }}>
            <div
              onClick={() => toggleDate(date)}
              style={{
                padding: '8px 12px',
                fontSize: 13,
                color: '#666',
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
                <span>{date}</span>
                <span style={{ fontSize: 12, color: '#999' }}>{items.length} 笔</span>
              </span>
              <span>
                {dayExpense > 0 && <span style={{ color: '#999' }}>支 ¥{fmt(dayExpense)} </span>}
                {dayIncome > 0 && <span style={{ color: '#999' }}>收 ¥{fmt(dayIncome)}</span>}
              </span>
            </div>
            {isExpanded &&
              items.map((t) => (
                <div
                  key={t.id}
                  style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #fafafa' }}
                >
                  <span style={{ fontSize: 22, marginRight: 10 }}>
                    {t.category?.icon || (t.type === 'expense' ? '💸' : t.type === 'income' ? '💰' : '🔄')}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15 }}>
                      {t.category?.name ?? (t.type === 'transfer' ? '转账' : '未分类')}
                    </div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                      {formatDateTime(new Date(t.occurredAt))}
                      {t.note && <span style={{ marginLeft: 6 }}>{t.note}</span>}
                      {showLedgerName && t.ledger?.name && (
                        <span style={{ marginLeft: 6, color: '#1677ff' }}>
                          〔{t.ledger.name}〕
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: t.type === 'income' ? '#52c41a' : '#ff4d4f' }}>
                    {t.type === 'income' ? '+' : '-'}¥{fmt(t.amount)}
                  </span>
                </div>
              ))}
          </div>
        );
      })}

      {transactions.length === 0 && (
        <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>{emptyText}</div>
      )}
    </div>
  );
}
