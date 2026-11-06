import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, Input, List, NavBar, Popup, Toast } from 'antd-mobile';
import { ledgerApi } from '../api/ledger';
import type { Ledger } from '../types';

const ICON_OPTIONS = ['📒', '📕', '📗', '📘', '💰', '💳', '📁', '🏠', '🚗', '🛒', '💊', '🎓', '✈️', '🎁'];
const COLOR_OPTIONS = ['#1677ff', '#52c41a', '#faad14', '#ff4d4f', '#722ed1', '#13c2c2', '#eb2f96', '#999999'];

const TYPE_LABEL: Record<string, string> = {
  daily: '日常账本',
  loan: '贷款账本',
  custom: '自定义',
};

export default function LedgerManage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Ledger | null>(null);
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('📒');
  const [editColor, setEditColor] = useState('#1677ff');

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['ledgers'] });
    queryClient.invalidateQueries({ queryKey: ['ledger-summaries'] });
  };

  const openEdit = (l: Ledger) => {
    setEditing(l);
    setEditName(l.name);
    setEditIcon(l.icon || '📒');
    setEditColor(l.color || '#1677ff');
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editName.trim()) {
      Toast.show({ content: '请输入账本名称' });
      return;
    }
    try {
      await ledgerApi.update(editing.id, {
        name: editName.trim(),
        icon: editIcon,
        color: editColor,
      });
      Toast.show({ content: '已保存' });
      setEditing(null);
      refresh();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '保存失败' });
    }
  };

  const handleDelete = async (l: Ledger) => {
    const ok = await new Promise((resolve) => {
      Dialog.confirm({
        content: `删除账本「${l.name}」？该账本的流水、贷款、成员将一并删除，不可恢复。`,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      await ledgerApi.remove(l.id);
      Toast.show({ content: '已删除' });
      refresh();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '删除失败' });
    }
  };

  return (
    <div className="page">
      <NavBar onBack={() => navigate(-1)} style={{ background: '#fff' }}>
        账本管理
      </NavBar>

      <div style={{ padding: 16 }}>
        <List style={{ borderRadius: 12, overflow: 'hidden' }}>
          {ledgers.map((l) => {
            const isOwner = l.role === 'owner';
            return (
              <List.Item
                key={l.id}
                prefix={<span style={{ fontSize: 24, marginRight: 8 }}>{l.icon || '📒'}</span>}
                description={
                  `${TYPE_LABEL[l.type] ?? l.type}${(l.memberCount ?? 1) > 1 ? ` · 👥 ${l.memberCount}` : ''}`
                }
                extra={
                  isOwner ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button
                        size="mini"
                        fill="outline"
                        color="primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(l);
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        size="mini"
                        fill="none"
                        color="danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(l);
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  ) : (
                    <span className="text-secondary" style={{ fontSize: 12 }}>共享账本</span>
                  )
                }
              >
                <span style={{ color: l.color || undefined }}>{l.name}</span>
              </List.Item>
            );
          })}
        </List>

        {ledgers.length === 0 && (
          <div className="text-secondary" style={{ textAlign: 'center', padding: 20 }}>
            暂无账本
          </div>
        )}
      </div>

      {/* 编辑账本弹窗 */}
      <Popup
        visible={!!editing}
        onMaskClick={() => setEditing(null)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>编辑账本</h3>

          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>名称</div>
            <Input value={editName} onChange={setEditName} placeholder="账本名称" />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 8 }}>图标</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ICON_OPTIONS.map((ic) => (
                <div
                  key={ic}
                  onClick={() => setEditIcon(ic)}
                  style={{
                    fontSize: 22,
                    width: 40,
                    height: 40,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    background: editIcon === ic ? '#e6f4ff' : '#f5f5f5',
                    border: editIcon === ic ? '1px solid #1677ff' : '1px solid transparent',
                  }}
                >
                  {ic}
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 8 }}>颜色</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {COLOR_OPTIONS.map((c) => (
                <div
                  key={c}
                  onClick={() => setEditColor(c)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: c,
                    border: editColor === c ? '3px solid #333' : '1px solid #ddd',
                  }}
                />
              ))}
            </div>
          </div>

          <Button block color="primary" onClick={saveEdit}>
            保存
          </Button>
        </div>
      </Popup>
    </div>
  );
}
