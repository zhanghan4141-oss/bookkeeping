import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, List, NavBar, Picker, Popup, Toast } from 'antd-mobile';
import { AddCircleOutline } from 'antd-mobile-icons';
import { ledgerApi } from '../api/ledger';
import { repaymentApi, statApi } from '../api/misc';
import { invalidateFinancialData } from '../lib/invalidate';
import { useAuthStore } from '../stores/auth';
import { useLedgerSelectionStore } from '../stores/ledgerSelection';
import type { Ledger, LedgerSummary } from '../types';

const LEDGER_TYPE_ICON: Record<string, string> = {
  daily: '📒',
  loan: '💰',
  custom: '📁',
};

export default function Ledgers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showCreate, setShowCreate] = useState(false);
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('month');
  const selectedIds = useLedgerSelectionStore((s) => s.selectedIds);
  const selectOne = useLedgerSelectionStore((s) => s.selectOne);

  const { data: ledgers = [], refetch } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });

  const { data: summaries = [] } = useQuery({
    queryKey: ['ledger-summaries', period],
    queryFn: async () => (await statApi.ledgerSummaries(period)).data as LedgerSummary[],
  });

  const summaryMap = useMemo(() => {
    const m = new Map<string, LedgerSummary>();
    summaries.forEach((s) => m.set(s.ledgerId, s));
    return m;
  }, [summaries]);

  const { data: upcoming } = useQuery({
    queryKey: ['repayments', 'upcoming', 7],
    queryFn: async () => (await repaymentApi.upcoming(7)).data,
  });

  // 顶卡：本月总收支（固定按月，与下方周期切换无关）
  const { data: monthSummaries = [] } = useQuery({
    queryKey: ['ledger-summaries', 'month'],
    queryFn: async () => (await statApi.ledgerSummaries('month')).data as LedgerSummary[],
  });

  const monthTotal = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const s of monthSummaries) {
      income += s.income;
      expense += s.expense;
    }
    return {
      income: Math.round(income * 100) / 100,
      expense: Math.round(expense * 100) / 100,
      surplus: Math.round((income - expense) * 100) / 100,
    };
  }, [monthSummaries]);

  // 最近一笔待还（未来 7 天内）
  const nearestDay = upcoming?.daily?.[0];
  const nearestRepayment = nearestDay?.items?.[0];

  // 选中的账本排最上方
  const sortedLedgers = useMemo(() => {
    return [...ledgers].sort((a, b) => {
      const aSel = selectedIds.includes(a.id) ? 1 : 0;
      const bSel = selectedIds.includes(b.id) ? 1 : 0;
      return bSel - aSel;
    });
  }, [ledgers, selectedIds]);

  const handleCreate = async (values: { name: string; type: string[] }) => {
    try {
      await ledgerApi.create({ name: values.name, type: values.type[0] });
      Toast.show({ content: '创建成功' });
      setShowCreate(false);
      refetch();
      invalidateFinancialData(queryClient);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '创建失败' });
    }
  };

  const handleOpenLedger = (l: Ledger) => {
    selectOne(l.id);
    navigate(`/ledgers/${l.id}`);
  };

  return (
    <div className="page">
      <NavBar back={null} style={{ background: '#fff' }}>
        记账本
      </NavBar>

      <div style={{ padding: '16px' }}>
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: '16px 20px',
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 14, color: '#666' }}>你好，{user?.nickname}</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 20 }}>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>本月支出</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#ff4d4f' }}>
                ¥{monthTotal.expense.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>本月收入</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#52c41a' }}>
                ¥{monthTotal.income.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>结余</div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: monthTotal.surplus >= 0 ? '#1677ff' : '#ff4d4f',
                }}
              >
                ¥{monthTotal.surplus.toFixed(2)}
              </div>
            </div>
          </div>
          {nearestRepayment && nearestDay && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
              最近待还 {nearestRepayment.loanName} ¥{nearestRepayment.remain.toFixed(2)}（{nearestDay.date.slice(5)}）
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 16 }}>我的账本</span>
          <Button
            size="mini"
            color="primary"
            fill="outline"
            onClick={() => setShowCreate(true)}
          >
            <AddCircleOutline /> 新建
          </Button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[
            { key: 'month', label: '当月' },
            { key: 'year', label: '当年' },
            { key: 'all', label: '所有' },
          ].map((t) => (
            <div
              key={t.key}
              onClick={() => setPeriod(t.key as 'month' | 'year' | 'all')}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '6px 0',
                borderRadius: 6,
                fontSize: 13,
                background: period === t.key ? '#1677ff' : '#f5f5f5',
                color: period === t.key ? '#fff' : '#666',
              }}
            >
              {t.label}
            </div>
          ))}
        </div>

        <List style={{ borderRadius: 12, overflow: 'hidden' }}>
          {sortedLedgers.map((l) => {
            const isSelected = selectedIds.includes(l.id);
            const s = summaryMap.get(l.id);
            return (
              <List.Item
                key={l.id}
                prefix={
                  <span style={{ fontSize: 28, marginRight: 8 }}>
                    {l.icon || LEDGER_TYPE_ICON[l.type] || '📒'}
                  </span>
                }
                description={
                  <div>
                    <div className="text-secondary" style={{ fontSize: 12 }}>
                      {l.type === 'loan' ? '贷款账本' : l.type === 'daily' ? '日常账本' : '自定义'} · {l.currency}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      收 <span style={{ color: '#52c41a' }}>¥{(s?.income ?? 0).toFixed(2)}</span>
                      {'  '}支 <span style={{ color: '#ff4d4f' }}>¥{(s?.expense ?? 0).toFixed(2)}</span>
                      {'  '}结余{' '}
                      <span style={{ color: (s?.surplus ?? 0) >= 0 ? '#1677ff' : '#ff4d4f' }}>
                        ¥{(s?.surplus ?? 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                }
                onClick={() => handleOpenLedger(l)}
                style={
                  isSelected
                    ? { background: '#e6f4ff' }
                    : undefined
                }
                extra={isSelected ? <span style={{ color: '#1677ff', fontSize: 13 }}>当前</span> : undefined}
              >
                {l.name}
                {(l.memberCount ?? 1) > 1 && (
                  <span style={{ marginLeft: 6, fontSize: 12, color: '#999' }}>
                    👥 {l.memberCount}
                  </span>
                )}
              </List.Item>
            );
          })}
          {ledgers.length === 0 && (
            <List.Item description="点击右上角新建账本开始记账">暂无账本</List.Item>
          )}
        </List>
      </div>

      <Popup
        visible={showCreate}
        onMaskClick={() => setShowCreate(false)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>新建账本</h3>
          <Form
            layout="vertical"
            onFinish={handleCreate}
            initialValues={{ type: ['daily'] }}
            footer={
              <Button block type="submit" color="primary">
                创建
              </Button>
            }
          >
            <Form.Item name="name" label="账本名称" rules={[{ required: true, message: '请输入名称' }]}>
              <Input placeholder="如：家庭日常" />
            </Form.Item>
            <Form.Item name="type" label="类型" trigger="onConfirm">
              <Picker
                columns={[
                  [
                    { label: '日常账本', value: 'daily' },
                    { label: '贷款账本', value: 'loan' },
                    { label: '自定义', value: 'custom' },
                  ],
                ]}
              >
                {(items, actions) => (
                  <div onClick={() => actions.open()}>
                    <Input value={String(items[0]?.label ?? '日常账本')} readOnly />
                  </div>
                )}
              </Picker>
            </Form.Item>
          </Form>
        </div>
      </Popup>
    </div>
  );
}
