import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Form, Input, List, NavBar, Picker, Popup, Toast } from 'antd-mobile';
import { AddCircleOutline } from 'antd-mobile-icons';
import { ledgerApi } from '../api/ledger';
import { repaymentApi } from '../api/misc';
import { useAuthStore } from '../stores/auth';
import { useLedgerSelectionStore } from '../stores/ledgerSelection';
import type { Ledger } from '../types';

const LEDGER_TYPE_ICON: Record<string, string> = {
  daily: '📒',
  loan: '💰',
  custom: '📁',
};

export default function Ledgers() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [showCreate, setShowCreate] = useState(false);
  const selectedIds = useLedgerSelectionStore((s) => s.selectedIds);
  const selectOne = useLedgerSelectionStore((s) => s.selectOne);

  const { data: ledgers = [], refetch } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });

  const { data: upcoming } = useQuery({
    queryKey: ['repayments', 'upcoming', 7],
    queryFn: async () => (await repaymentApi.upcoming(7)).data,
  });

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
            background: 'linear-gradient(135deg, #1677ff, #69b1ff)',
            borderRadius: 12,
            color: '#fff',
            padding: '16px 20px',
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 14, opacity: 0.9 }}>你好，{user?.nickname}</div>
          {upcoming?.totalAmount > 0 ? (
            <div style={{ marginTop: 8, fontSize: 15 }}>
              未来 7 天待还款{' '}
              <span style={{ fontWeight: 700, fontSize: 20 }}>
                ¥{upcoming.totalAmount.toFixed(2)}
              </span>
            </div>
          ) : (
            <div style={{ marginTop: 8, fontSize: 15, opacity: 0.9 }}>
              未来 7 天暂无待还款
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

        <List style={{ borderRadius: 12, overflow: 'hidden' }}>
          {sortedLedgers.map((l) => {
            const isSelected = selectedIds.includes(l.id);
            return (
              <List.Item
                key={l.id}
                prefix={
                  <span style={{ fontSize: 28, marginRight: 8 }}>
                    {l.icon || LEDGER_TYPE_ICON[l.type] || '📒'}
                  </span>
                }
                description={`${l.type === 'loan' ? '贷款账本' : l.type === 'daily' ? '日常账本' : '自定义'} · ${l.currency}`}
                onClick={() => handleOpenLedger(l)}
                style={
                  isSelected
                    ? { background: '#e6f4ff' }
                    : undefined
                }
                extra={isSelected ? <span style={{ color: '#1677ff', fontSize: 13 }}>当前</span> : undefined}
              >
                {l.name}
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
