import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Form, Input, NavBar, Picker, TextArea, Toast } from 'antd-mobile';
import { categoryApi } from '../api/category';
import { transactionApi } from '../api/transaction';
import { usePersistedState } from '../hooks/usePersistedState';
import { invalidateFinancialData } from '../lib/invalidate';
import type { Category } from '../types';

/** 格式化日期时间（本地时间，精确到分钟） */
function formatDateTime(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

export default function TransactionForm() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft, clearDraft] = usePersistedState<{
    type: 'expense' | 'income' | 'transfer';
    categoryId: string;
    occurredAt: string;
    amount?: string;
    note?: string;
  }>('transactionForm:draft', {
    type: 'expense',
    categoryId: '',
    occurredAt: new Date().toISOString(),
  });

  const type = draft.type;
  const categoryId = draft.categoryId;
  const occurredAt = new Date(draft.occurredAt);
  const setType = (t: 'expense' | 'income' | 'transfer') =>
    setDraft((d) => ({ ...d, type: t }));
  const setCategoryId = (id: string) => setDraft((d) => ({ ...d, categoryId: id }));
  const setOccurredAt = (v: Date) => setDraft((d) => ({ ...d, occurredAt: v.toISOString() }));

  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['categories', id],
    queryFn: async () => (await categoryApi.list(id)).data as Category[],
  });

  const typeCategories = useMemo(
    () => categories.filter((c) => c.type === (type === 'income' ? 'income' : 'expense')),
    [categories, type],
  );

  // 类别加载或类型切换时，默认选中第一个类别
  useEffect(() => {
    if (type === 'transfer' || categoriesLoading) return;
    if (typeCategories.length === 0) {
      setCategoryId('');
      return;
    }
    // 若当前选中类别不在新类型列表中，则重置为第一个
    const exists = typeCategories.some((c) => c.id === categoryId);
    if (!exists) {
      setCategoryId(typeCategories[0].id);
    }
  }, [typeCategories, type, categoryId, categoriesLoading]);

  const onFinish = async (values: {
    amount: number;
    note?: string;
  }) => {
    try {
      if (type !== 'transfer' && !categoryId) {
        Toast.show({ content: '请选择类别' });
        return;
      }
      await transactionApi.create({
        ledgerId: id,
        type,
        amount: Number(values.amount),
        categoryId: type === 'transfer' ? undefined : categoryId,
        note: values.note,
        occurredAt: occurredAt.toISOString(),
      });
      // 失效流水查询 + 统计，让账本详情页立即刷新
      invalidateFinancialData(queryClient);
      clearDraft();
      Toast.show({ content: '已记账' });
      navigate(-1);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '记账失败' });
    }
  };

  return (
    <div className="page" style={{ background: '#fff' }}>
      <NavBar onBack={() => navigate(-1)}>记一笔</NavBar>

      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {[
            { key: 'expense', label: '支出', color: '#ff4d4f' },
            { key: 'income', label: '收入', color: '#52c41a' },
            { key: 'transfer', label: '转账', color: '#1677ff' },
          ].map((t) => (
            <div
              key={t.key}
              onClick={() => setType(t.key as any)}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '10px 0',
                borderRadius: 8,
                background: type === t.key ? t.color : '#f5f5f5',
                color: type === t.key ? '#fff' : '#666',
                fontWeight: type === t.key ? 600 : 400,
              }}
            >
              {t.label}
            </div>
          ))}
        </div>

        <Form
          layout="vertical"
          onFinish={onFinish}
          initialValues={{ amount: draft.amount, note: draft.note }}
          onValuesChange={(_changed, all) =>
            setDraft((d) => ({ ...d, amount: all.amount, note: all.note }))
          }
          footer={
            <Button block type="submit" color="primary" size="large">
              保存
            </Button>
          }
        >
          <Form.Item name="amount" label="金额" rules={[{ required: true, message: '请输入金额' }]}>
            <Input type="number" placeholder="0.00" style={{ fontSize: 32, fontWeight: 700 }} />
          </Form.Item>

          {type !== 'transfer' && (
            <div style={{ marginBottom: 24 }}>
              <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>
                类别 <span style={{ color: '#ff4d4f' }}>*</span>
              </div>
              <Picker
                columns={[typeCategories.map((c) => ({ label: c.name, value: c.id }))]}
                value={categoryId ? [categoryId] : []}
                onConfirm={(v) => setCategoryId(String(v[0] ?? ''))}
              >
                {(items, actions) => (
                  <div onClick={() => actions.open()}>
                    <Input
                      value={String(items[0]?.label ?? '请选择类别')}
                      readOnly
                      placeholder="请选择类别"
                    />
                  </div>
                )}
              </Picker>
            </div>
          )}

          <Form.Item name="note" label="备注">
            <TextArea placeholder="备注（可选）" rows={2} />
          </Form.Item>

          <div style={{ marginBottom: 24 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>日期时间</div>
            <DatePicker
              precision="minute"
              value={occurredAt}
              onConfirm={(v) => v && setOccurredAt(v)}
            >
              {(value, actions) => (
                <div onClick={() => actions.open()}>
                  <Input value={value ? formatDateTime(value) : ''} readOnly placeholder="现在" />
                </div>
              )}
            </DatePicker>
          </div>
        </Form>
      </div>
    </div>
  );
}
