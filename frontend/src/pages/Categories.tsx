import { useContext, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, List, NavBar, Picker, Popup, Toast } from 'antd-mobile';
import { DeleteOutline } from 'antd-mobile-icons';
import { TabActiveContext } from '../components/KeepAlive';
import { categoryApi } from '../api/category';
import { ledgerApi } from '../api/ledger';
import { invalidateFinancialData } from '../lib/invalidate';
import { usePopupBack } from '../hooks/usePopupBack';
import type { Category, Ledger } from '../types';

export default function Categories() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pageRef = useRef<HTMLDivElement>(null);
  const isActive = useContext(TabActiveContext);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  // 删除类别：目标类别选择（空 = 未分类）
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [deleteTarget, setDeleteTarget] = useState('');

  usePopupBack(!!deleting, () => setDeleting(null));

  usePopupBack(showAdd, () => setShowAdd(false));
  usePopupBack(!!editing, () => setEditing(null));

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

  const handleRemove = (category: Category) => {
    setDeleting(category);
    setDeleteTarget('');
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await categoryApi.remove(deleting.id, deleteTarget || null);
      Toast.show({ content: '已删除' });
      setDeleting(null);
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
    <div className="page" ref={pageRef}>
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
              <span className="text-secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                {c._count?.transactions ?? 0} 笔
              </span>
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
              <span className="text-secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                {c._count?.transactions ?? 0} 笔
              </span>
            </List.Item>
          ))}
        </List>
      </div>

      <Popup
        visible={showAdd}
        onMaskClick={() => setShowAdd(false)}
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
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
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
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

      {/* 删除类别弹窗：有流水时选择迁移目标类别 */}
      <Popup
        visible={!!deleting}
        onMaskClick={() => setDeleting(null)}
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 8 }}>删除类别</h3>
          <div className="text-secondary" style={{ fontSize: 13, marginBottom: 12 }}>
            删除类别「{deleting?.name}」？
            {(deleting?._count?.transactions ?? 0) > 0 && (
              <>该类别下有 <span style={{ color: '#ff4d4f' }}>{deleting?._count?.transactions}</span> 条流水，请选择这些流水的去向：</>
            )}
          </div>
          {(deleting?._count?.transactions ?? 0) > 0 && (
            <Picker
              columns={[
                [
                  { label: '未分类', value: '' },
                  ...categories
                    .filter((c) => c.id !== deleting?.id && c.type === deleting?.type)
                    .map((c) => ({ label: c.name, value: c.id })),
                ],
              ]}
              value={deleteTarget ? [deleteTarget] : ['']}
              onConfirm={(v) => setDeleteTarget(String(v[0]))}
            >
              {(items, actions) => (
                <div
                  onClick={() => actions.open()}
                  style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px', marginBottom: 16 }}
                >
                  {items[0]?.label ?? '未分类'}
                </div>
              )}
            </Picker>
          )}
          <Button block color="danger" onClick={confirmDelete}>确认删除</Button>
        </div>
      </Popup>
    </div>
  );
}
