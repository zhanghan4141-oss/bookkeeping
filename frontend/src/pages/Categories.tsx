import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, Form, Input, List, NavBar, Picker, Popup, Toast } from 'antd-mobile';
import { DeleteOutline } from 'antd-mobile-icons';
import { categoryApi } from '../api/category';
import { ledgerApi } from '../api/ledger';
import { invalidateFinancialData } from '../lib/invalidate';
import type { Category, Ledger } from '../types';

export default function Categories() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);

  const { data: categories = [], refetch } = useQuery({
    queryKey: ['categories', id],
    queryFn: async () => (await categoryApi.list(id)).data as Category[],
  });

  const { data: ledger } = useQuery({
    queryKey: ['ledger', id],
    queryFn: async () => (await ledgerApi.get(id)).data as Ledger,
  });
  const isViewer = ledger?.role === 'viewer';

  const handleAdd = async (values: { name: string; type: string[]; color?: string }) => {
    try {
      await categoryApi.create(id, {
        name: values.name,
        type: values.type[0],
        color: values.color,
      });
      Toast.show({ content: '添加成功' });
      setShowAdd(false);
      refetch();
      invalidateFinancialData(queryClient);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '添加失败' });
    }
  };

  const handleRemove = async (category: Category) => {
    const ok = await new Promise((resolve) => {
      Dialog.confirm({ content: `删除类别「${category.name}」？`, onConfirm: () => resolve(true), onCancel: () => resolve(false) });
    });
    if (!ok) return;
    try {
      await categoryApi.remove(category.id);
      Toast.show({ content: '已删除' });
      refetch();
      invalidateFinancialData(queryClient);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '删除失败' });
    }
  };

  const handleUpdate = async (values: { name: string; type: string[] }) => {
    if (!editing) return;
    try {
      // 原地 Update 同一 id：所有关联流水的 categoryId 不变，
      // 历史流水自动跟随显示新类别（无需迁移流水记录）
      await categoryApi.update(editing.id, { name: values.name, type: values.type[0] });
      Toast.show({ content: '已保存' });
      setEditing(null);
      refetch();
      invalidateFinancialData(queryClient);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '保存失败' });
    }
  };

  const expense = categories.filter((c) => c.type === 'expense');
  const income = categories.filter((c) => c.type === 'income');

  return (
    <div className="page">
      <NavBar onBack={() => navigate(-1)} style={{ background: '#fff' }}>
        分类管理
      </NavBar>

      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontWeight: 600 }}>支出分类</span>
          {!isViewer && (
            <Button size="mini" color="primary" fill="outline" onClick={() => setShowAdd(true)}>
              添加
            </Button>
          )}
        </div>
        <List style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          {expense.map((c) => (
            <List.Item
              key={c.id}
              prefix={<span style={{ color: c.color || '#ff4d4f', fontSize: 20, marginRight: 8 }}>●</span>}
              extra={
                !isViewer ? (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <Button size="mini" fill="none" onClick={() => setEditing(c)}>
                      编辑
                    </Button>
                    <Button size="mini" fill="none" onClick={() => handleRemove(c)}>
                      <DeleteOutline color="#999" />
                    </Button>
                  </div>
                ) : undefined
              }
            >
              {c.name}
            </List.Item>
          ))}
        </List>

        <div style={{ fontWeight: 600, marginBottom: 8 }}>收入分类</div>
        <List style={{ borderRadius: 12, overflow: 'hidden' }}>
          {income.map((c) => (
            <List.Item
              key={c.id}
              prefix={<span style={{ color: c.color || '#52c41a', fontSize: 20, marginRight: 8 }}>●</span>}
              extra={
                !isViewer ? (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <Button size="mini" fill="none" onClick={() => setEditing(c)}>
                      编辑
                    </Button>
                    <Button size="mini" fill="none" onClick={() => handleRemove(c)}>
                      <DeleteOutline color="#999" />
                    </Button>
                  </div>
                ) : undefined
              }
            >
              {c.name}
            </List.Item>
          ))}
        </List>
      </div>

      <Popup
        visible={showAdd}
        onMaskClick={() => setShowAdd(false)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>添加分类</h3>
          <Form
            layout="vertical"
            onFinish={handleAdd}
            initialValues={{ type: ['expense'] }}
            footer={
              <Button block type="submit" color="primary">
                添加
              </Button>
            }
          >
            <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
              <Input placeholder="如：餐饮" />
            </Form.Item>
            <Form.Item name="type" label="类型" trigger="onConfirm">
              <Picker
                columns={[
                  [
                    { label: '支出', value: 'expense' },
                    { label: '收入', value: 'income' },
                  ],
                ]}
              >
                {(items, actions) => (
                  <div onClick={() => actions.open()}>
                    <Input value={String(items[0]?.label ?? '支出')} readOnly />
                  </div>
                )}
              </Picker>
            </Form.Item>
          </Form>
        </div>
      </Popup>

      {/* 编辑分类弹窗 */}
      <Popup
        visible={!!editing}
        onMaskClick={() => setEditing(null)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>编辑分类</h3>
          <Form
            layout="vertical"
            onFinish={handleUpdate}
            key={editing?.id ?? 'none'}
            initialValues={{
              name: editing?.name ?? '',
              type: [editing?.type ?? 'expense'],
            }}
            footer={
              <Button block type="submit" color="primary">
                保存
              </Button>
            }
          >
            <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
              <Input placeholder="如：餐饮" />
            </Form.Item>
            <Form.Item name="type" label="类型" trigger="onConfirm">
              <Picker
                columns={[
                  [
                    { label: '支出', value: 'expense' },
                    { label: '收入', value: 'income' },
                  ],
                ]}
              >
                {(items, actions) => (
                  <div onClick={() => actions.open()}>
                    <Input value={String(items[0]?.label ?? '支出')} readOnly />
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
