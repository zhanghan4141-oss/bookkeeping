import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, FloatingBubble, List, NavBar, Toast } from 'antd-mobile';
import { AddOutline, PayCircleOutline, TagOutline } from 'antd-mobile-icons';
import { ledgerApi } from '../api/ledger';
import { transactionApi } from '../api/transaction';
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

export default function LedgerDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const { data: ledger } = useQuery({
    queryKey: ['ledger', id],
    queryFn: async () => (await ledgerApi.get(id)).data,
  });

  const { data: transactions = [], refetch } = useQuery({
    queryKey: ['transactions', id, month],
    queryFn: async () => (await transactionApi.list(id, { month })).data as Transaction[],
  });

  const groups = useMemo(() => groupByDate(transactions), [transactions]);

  const monthTotal = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of transactions) {
      if (t.type === 'income') income += Number(t.amount);
      else if (t.type === 'expense') expense += Number(t.amount);
    }
    return { income, expense };
  }, [transactions]);

  const handleExport = async () => {
    window.open(`/api/ledgers/${id}/transactions/export?month=${month}`, '_blank');
  };

  const handleImport = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`/api/ledgers/${id}/transactions/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('bookkeeping-auth') ? JSON.parse(localStorage.getItem('bookkeeping-auth')!).state.accessToken : ''}` },
        body: form,
      });
      const data = await res.json();
      if (data.errors?.length) {
        Toast.show({ content: `导入 ${data.successCount} 条，${data.errors.length} 条失败` });
      } else {
        Toast.show({ content: `成功导入 ${data.successCount} 条` });
      }
      refetch();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '导入失败' });
    }
  };

  return (
    <div className="page">
      <NavBar onBack={() => navigate(-1)} style={{ background: '#fff' }}>
        {ledger?.name ?? '账本'}
      </NavBar>

      <div style={{ padding: '16px 16px 0' }}>
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: '16px',
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{ border: '1px solid #eee', borderRadius: 6, padding: '4px 8px', fontSize: 14 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="mini" fill="outline" onClick={handleExport}>导出</Button>
              <Button size="mini" fill="outline" onClick={() => fileRef.current?.click()}>导入</Button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>收入</div>
              <div className="amount-income" style={{ fontSize: 18, fontWeight: 600 }}>
                ¥{fmt(monthTotal.income)}
              </div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>支出</div>
              <div className="amount-expense" style={{ fontSize: 18, fontWeight: 600 }}>
                ¥{fmt(monthTotal.expense)}
              </div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>结余</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>
                ¥{fmt(monthTotal.income - monthTotal.expense)}
              </div>
            </div>
          </div>
        </div>

        {ledger?.type === 'loan' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Button
              block
              color="primary"
              onClick={() => navigate(`/ledgers/${id}/loans`)}
            >
              <PayCircleOutline /> 贷款管理
            </Button>
            <Button block fill="outline" onClick={() => navigate(`/ledgers/${id}/categories`)}>
              <TagOutline /> 分类
            </Button>
          </div>
        )}

        <List style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
          {groups.map(([date, items]) => {
            const dayIncome = items.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
            const dayExpense = items.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
            return (
              <div key={date} style={{ background: '#fff', marginBottom: 8, borderRadius: 12, overflow: 'hidden' }}>
                <div
                  style={{
                    padding: '8px 12px',
                    fontSize: 13,
                    color: '#666',
                    display: 'flex',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid #f5f5f5',
                  }}
                >
                  <span>{date}</span>
                  <span>
                    {dayExpense > 0 && <span style={{ color: '#ff4d4f' }}>支 ¥{fmt(dayExpense)} </span>}
                    {dayIncome > 0 && <span style={{ color: '#52c41a' }}>收 ¥{fmt(dayIncome)}</span>}
                  </span>
                </div>
                {items.map((t) => (
                  <List.Item
                    key={t.id}
                    prefix={
                      <span style={{ fontSize: 22, marginRight: 10 }}>
                        {t.category?.icon || (t.type === 'expense' ? '💸' : t.type === 'income' ? '💰' : '🔄')}
                      </span>
                    }
                    extra={
                      <span className={t.type === 'income' ? 'amount-income' : 'amount-expense'}>
                        {t.type === 'income' ? '+' : '-'}¥{fmt(t.amount)}
                      </span>
                    }
                    description={t.note || undefined}
                  >
                    {t.category?.name ?? (t.type === 'transfer' ? '转账' : '未分类')}
                  </List.Item>
                ))}
              </div>
            );
          })}
          {transactions.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
              本月暂无流水，点击右下角记一笔
            </div>
          )}
        </List>
      </div>

      <FloatingBubble
        style={{
          '--initial-position-bottom': '90px',
          '--initial-position-right': '20px',
        }}
        onClick={() => navigate(`/ledgers/${id}/record`)}
      >
        <AddOutline fontSize={24} />
      </FloatingBubble>
    </div>
  );
}
