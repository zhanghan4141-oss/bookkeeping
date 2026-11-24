import { useContext, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, Input, Popup, Toast } from 'antd-mobile';
import { TabActiveContext } from './KeepAlive';
import SpaceLedgerPopup from './SpaceLedgerPopup';
import { spaceApi } from '../api/space';
import type { Ledger, UserSpace } from '../types';
import { usePopupBack } from '../hooks/usePopupBack';

interface SpaceDrawerProps {
  open: boolean;
  onClose: () => void;
  spaces: UserSpace[];
  /** 默认分组账本数（共享账本 + 我拥有但未归类） */
  defaultCount: number;
  currentSpaceId: string | null;
  onSelect: (id: string | null) => void;
  ledgers: Ledger[];
}

/**
 * 账本页左侧空间抽屉（antd-mobile 无 Drawer，自定义 fixed 左滑面板）。
 * - 恒挂载，transform translateX 切换，关闭态完全出屏且不可点击
 * - 未盖底部 TabBar（zIndex 90 < 100）；右侧半透明遮罩点击关闭
 */
export default function SpaceDrawer({
  open,
  onClose,
  spaces,
  defaultCount,
  currentSpaceId,
  onSelect,
  ledgers,
}: SpaceDrawerProps) {
  const queryClient = useQueryClient();
  const pageRef = useRef<HTMLDivElement>(null);
  const isActive = useContext(TabActiveContext);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [editing, setEditing] = useState<UserSpace | null>(null);
  const [editName, setEditName] = useState('');
  const [showLedgerGroup, setShowLedgerGroup] = useState(false);
  // 管理模式：标题行「管理/完成」开关，打开后各空间行显示「改名」「删除」
  const [managing, setManaging] = useState(false);

  usePopupBack(open, onClose);
  usePopupBack(showCreate, () => setShowCreate(false));
  usePopupBack(!!editing, () => setEditing(null));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['ledgers'] });
    queryClient.invalidateQueries({ queryKey: ['spaces'] });
    queryClient.invalidateQueries({ queryKey: ['ledger-summaries'] });
    queryClient.invalidateQueries({ queryKey: ['stats', 'overview'] });
  };

  const handleCreate = async () => {
    if (!createName.trim()) {
      Toast.show({ content: '请输入空间名称' });
      return;
    }
    try {
      await spaceApi.create({ name: createName.trim() });
      Toast.show({ content: '已创建空间' });
      setShowCreate(false);
      setCreateName('');
      refresh();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '创建失败' });
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    if (!editName.trim()) {
      Toast.show({ content: '请输入空间名称' });
      return;
    }
    try {
      await spaceApi.update(editing.id, { name: editName.trim() });
      Toast.show({ content: '已保存' });
      setEditing(null);
      refresh();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '保存失败' });
    }
  };

  const handleDelete = async (sp: UserSpace) => {
    const ok = await new Promise((resolve) => {
      Dialog.confirm({
        content: `删除空间「${sp.name}」？该空间的 ${sp.ledgerCount ?? 0} 个账本将回到默认分组，空间删除无法恢复。`,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      await spaceApi.remove(sp.id);
      Toast.show({ content: '已删除空间' });
      refresh();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '删除失败' });
    }
  };

  const top = 'calc(env(safe-area-inset-top) + 45px)';
  const height =
    'calc(100vh - env(safe-area-inset-top) - 45px - 70px - env(safe-area-inset-bottom))';

  return (
    <>
      <div
        ref={pageRef}
        style={{
          position: 'fixed',
          left: 0,
          top,
          height,
          width: 280,
          zIndex: 90,
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform .28s ease',
          pointerEvents: open ? 'auto' : 'none',
          background: '#fff',
          borderRadius: '0 12px 12px 0',
          boxShadow: open ? '0 4px 16px rgba(0,0,0,.15)' : 'none',
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: 16 }}>
          <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 16 }}>空间</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button size="mini" fill="outline" onClick={() => setShowLedgerGroup(true)}>
              账本
            </Button>
            <Button
              size="mini"
              fill={managing ? 'solid' : 'outline'}
              color="primary"
              onClick={() => setManaging((v) => !v)}
            >
              {managing ? '完成' : '管理'}
            </Button>
            <Button size="mini" color="success" onClick={() => setShowCreate(true)}>
              新建
            </Button>
          </div>
        </div>

          {/* 默认分组（固定首位） */}
          <div
            onClick={() => onSelect(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 10,
              background: currentSpaceId === null ? '#e6f4ff' : '#f5f5f5',
              cursor: 'pointer',
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 18 }}>📂</span>
            <span style={{ fontWeight: 600 }}>默认分组</span>
            <span className="text-secondary" style={{ fontSize: 12 }}>{defaultCount}</span>
          </div>

          {/* 我的空间 */}
          {spaces.map((sp) => (
            <div
              key={sp.id}
              onClick={() => onSelect(sp.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 10,
                background: currentSpaceId === sp.id ? '#e6f4ff' : '#f5f5f5',
                cursor: 'pointer',
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 18 }}>{sp.icon || '🗂️'}</span>
              <span style={{ fontWeight: 600 }}>{sp.name}</span>
              <span className="text-secondary" style={{ fontSize: 12 }}>
                {sp.ledgerCount ?? 0}
              </span>
              {managing && (
                <>
                  <Button
                    size="mini"
                    fill="outline"
                    style={{ marginLeft: 4 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(sp);
                      setEditName(sp.name);
                    }}
                  >
                    改名
                  </Button>
                  <Button
                    size="mini"
                    fill="outline"
                    color="danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(sp);
                    }}
                  >
                    删除
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 右侧遮罩（点击关闭） */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            left: 280,
            right: 0,
            top,
            height,
            zIndex: 89,
            background: 'rgba(0,0,0,.25)',
          }}
        />
      )}

      {/* 新建空间 */}
      <Popup
        visible={showCreate}
        onMaskClick={() => setShowCreate(false)}
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>新建空间</h3>
          <Input
            placeholder="如：生活 / 工作 / 父母"
            value={createName}
            onChange={setCreateName}
            style={{ marginBottom: 16 }}
          />
          <Button block color="primary" onClick={handleCreate}>创建</Button>
        </div>
      </Popup>

      {/* 改名空间 */}
      <Popup
        visible={!!editing}
        onMaskClick={() => setEditing(null)}
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>改名空间</h3>
          <Input
            placeholder="空间名称"
            value={editName}
            onChange={setEditName}
            style={{ marginBottom: 16 }}
          />
          <Button block color="primary" onClick={handleUpdate}>保存</Button>
        </div>
      </Popup>

      {/* 账本分组管理 */}
      <SpaceLedgerPopup
        open={showLedgerGroup}
        onClose={() => setShowLedgerGroup(false)}
        ledgers={ledgers}
        spaces={spaces}
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
      />
    </>
  );
}