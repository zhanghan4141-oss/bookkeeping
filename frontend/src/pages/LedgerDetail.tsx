import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  DatePicker,
  Dialog,
  FloatingBubble,
  Input,
  List,
  NavBar,
  Picker,
  Popup,
  SwipeAction,
  Toast,
} from 'antd-mobile';
import { AddOutline, PayCircleOutline, TagOutline } from 'antd-mobile-icons';
import { ledgerApi } from '../api/ledger';
import { categoryApi } from '../api/category';
import { transactionApi } from '../api/transaction';
import type { Category, Transaction } from '../types';

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
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [editForm, setEditForm] = useState({
    type: 'expense',
    categoryId: '',
    amount: '',
    note: '',
    occurredAt: '',
  });

  const { data: ledger } = useQuery({
    queryKey: ['ledger', id],
    queryFn: async () => (await ledgerApi.get(id)).data,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', id],
    queryFn: async () => (await categoryApi.list(id)).data as Category[],
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

  // 复制流水
  const handleCopy = async (t: Transaction) => {
    try {
      await transactionApi.copy({
        ledgerId: t.ledgerId,
        categoryId: t.categoryId,
        type: t.type,
        amount: Number(t.amount),
        note: t.note,
        occurredAt: t.occurredAt,
      });
      Toast.show({ content: '已复制' });
      refetch();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '复制失败' });
    }
  };

  // 删除流水
  const handleDelete = async (t: Transaction) => {
    const ok = await new Promise((resolve) => {
      Dialog.confirm({
        content: '删除这条流水？',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      await transactionApi.remove(t.id);
      Toast.show({ content: '已删除' });
      refetch();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '删除失败' });
    }
  };

  // 打开编辑弹窗
  const openEdit = (t: Transaction) => {
    setEditing(t);
    setEditForm({
      type: t.type,
      categoryId: t.categoryId ?? '',
      amount: t.amount,
      note: t.note ?? '',
      occurredAt: t.occurredAt.slice(0, 10),
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      const data: Record<string, unknown> = {
        type: editForm.type,
        amount: Number(editForm.amount),
        note: editForm.note || undefined,
        occurredAt: editForm.occurredAt
          ? new Date(editForm.occurredAt).toISOString()
          : undefined,
      };
      if (editForm.categoryId) {
        data.categoryId = editForm.categoryId;
      }
      await transactionApi.update(editing.id, data);
      Toast.show({ content: '已保存' });
      setEditing(null);
      refetch();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '保存失败' });
    }
  };

  const typeCategories = categories.filter(
    (c) => c.type === (editForm.type === 'income' ? 'income' : 'expense'),
  );

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
              {items.map((t) => {
                const isLoanTx = !!t.loanId;
                const content = (
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
                    description={
                      <span>
                        {t.note}
                        {isLoanTx && <span style={{ marginLeft: 6, color: '#1677ff', fontSize: 12 }}>〔贷款〕</span>}
                      </span>
                    }
                    onClick={() => !isLoanTx && openEdit(t)}
                  >
                    {t.category?.name ?? (t.type === 'transfer' ? '转账' : '未分类')}
                  </List.Item>
                );

                // 贷款流水只读，不可左滑操作
                if (isLoanTx) return content;

                return (
                  <SwipeAction
                    key={t.id}
                    rightActions={[
                      {
                        key: 'copy',
                        text: '复制',
                        color: 'primary',
                        onClick: () => handleCopy(t),
                      },
                      {
                        key: 'delete',
                        text: '删除',
                        color: 'danger',
                        onClick: () => handleDelete(t),
                      },
                    ]}
                  >
                    {content}
                  </SwipeAction>
                );
              })}
            </div>
          );
        })}
        {transactions.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            本月暂无流水，点击右下角记一笔
          </div>
        )}
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

      {/* 编辑流水弹窗 */}
      <Popup
        visible={!!editing}
        onMaskClick={() => setEditing(null)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>编辑流水</h3>

          {/* 类型切换 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[
              { key: 'expense', label: '支出', color: '#ff4d4f' },
              { key: 'income', label: '收入', color: '#52c41a' },
              { key: 'transfer', label: '转账', color: '#1677ff' },
            ].map((t) => (
              <div
                key={t.key}
                onClick={() => setEditForm((f) => ({ ...f, type: t.key, categoryId: '' }))}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '8px 0',
                  borderRadius: 8,
                  background: editForm.type === t.key ? t.color : '#f5f5f5',
                  color: editForm.type === t.key ? '#fff' : '#666',
                  fontWeight: editForm.type === t.key ? 600 : 400,
                }}
              >
                {t.label}
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 12 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>金额</div>
            <Input
              type="number"
              value={editForm.amount}
              onChange={(v) => setEditForm((f) => ({ ...f, amount: v }))}
              style={{ fontSize: 24 }}
            />
          </div>

          {editForm.type !== 'transfer' && (
            <div style={{ marginBottom: 12 }}>
              <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>类别</div>
              <Picker
                columns={[typeCategories.map((c) => ({ label: c.name, value: c.id }))]}
                value={editForm.categoryId ? [editForm.categoryId] : []}
                onConfirm={(v) => setEditForm((f) => ({ ...f, categoryId: String(v[0] ?? '') }))}
              >
                {(items, actions) => (
                  <div
                    onClick={() => actions.open()}
                    style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}
                  >
                    {items[0]?.label ?? '选择类别'}
                  </div>
                )}
              </Picker>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>日期</div>
            <DatePicker
              value={editForm.occurredAt ? new Date(editForm.occurredAt) : new Date()}
              onConfirm={(v) => setEditForm((f) => ({ ...f, occurredAt: v.toISOString().slice(0, 10) }))}
            >
              {(_value, actions) => (
                <div
                  onClick={() => actions.open()}
                  style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}
                >
                  {editForm.occurredAt || '选择日期'}
                </div>
              )}
            </DatePicker>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>备注</div>
            <Input
              value={editForm.note}
              onChange={(v) => setEditForm((f) => ({ ...f, note: v }))}
              placeholder="备注"
            />
          </div>

          <Button block color="primary" onClick={saveEdit}>保存</Button>
        </div>
      </Popup>
    </div>
  );
}
