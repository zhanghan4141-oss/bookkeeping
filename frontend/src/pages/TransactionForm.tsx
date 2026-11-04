import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, DatePicker, Form, Input, NavBar, Picker, TextArea, Toast } from 'antd-mobile';
import { categoryApi } from '../api/category';
import { transactionApi } from '../api/transaction';
import type { Category } from '../types';

export default function TransactionForm() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [type, setType] = useState<'expense' | 'income' | 'transfer'>('expense');

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', id],
    queryFn: async () => (await categoryApi.list(id)).data as Category[],
  });

  const typeCategories = useMemo(
    () => categories.filter((c) => c.type === (type === 'income' ? 'income' : 'expense')),
    [categories, type],
  );

  const onFinish = async (values: {
    amount: number;
    category?: string[];
    note?: string;
    date?: Date;
  }) => {
    try {
      const categoryId = values.category?.[0];
      await transactionApi.create({
        ledgerId: id,
        type,
        amount: Number(values.amount),
        categoryId: categoryId || undefined,
        note: values.note,
        occurredAt: values.date ? new Date(values.date).toISOString() : new Date().toISOString(),
      });
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
          initialValues={{ category: [] }}
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
            <Form.Item name="category" label="类别" trigger="onConfirm">
              <Picker
                columns={[typeCategories.map((c) => ({ label: c.name, value: c.id }))]}
              >
                {(items, actions) => (
                  <div onClick={() => actions.open()}>
                    <Input value={String(items[0]?.label ?? '请选择类别')} readOnly placeholder="请选择类别" />
                  </div>
                )}
              </Picker>
            </Form.Item>
          )}

          <Form.Item name="note" label="备注">
            <TextArea placeholder="备注（可选）" rows={2} />
          </Form.Item>

          <Form.Item name="date" label="日期">
            <DatePicker>
              {(value) => <Input value={value ? value.toISOString().slice(0, 10) : ''} readOnly placeholder="今天" />}
            </DatePicker>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
}
