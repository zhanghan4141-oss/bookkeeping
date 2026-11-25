import { useContext, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, Input, List, NavBar, Picker, Popup, Toast } from 'antd-mobile';
import { AddOutline } from 'antd-mobile-icons';
import { TabActiveContext } from '../components/KeepAlive';
import { ledgerApi } from '../api/ledger';
import { useAuthStore } from '../stores/auth';
import type { Ledger, LedgerMember } from '../types';
import { usePopupBack } from '../hooks/usePopupBack';

// 可分配的成员角色：owner 不能通过邀请/改角色设置，只能转让产生（账本恒一名 owner）
const ASSIGNABLE_ROLES = [
  { label: '可编辑', value: 'editor' },
  { label: '只读', value: 'viewer' },
];

const ROLE_LABEL: Record<string, string> = {
  owner: '所有者',
  editor: '可编辑',
  viewer: '只读',
};

const ROLE_COLOR: Record<string, string> = {
  owner: '#1677ff',
  editor: '#52c41a',
  viewer: '#999',
};

export default function Members() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pageRef = useRef<HTMLDivElement>(null);
  const isActive = useContext(TabActiveContext);
  const currentUser = useAuthStore((s) => s.user);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  // 转让所有权
  const [transferTarget, setTransferTarget] = useState<LedgerMember | null>(null);
  const [transferText, setTransferText] = useState('');

  usePopupBack(showInvite, () => setShowInvite(false));
  usePopupBack(!!transferTarget, () => setTransferTarget(null));

  const { data: ledger } = useQuery({
    queryKey: ['ledger', id],
    queryFn: async () => (await ledgerApi.get(id)).data as Ledger,
  });

  const { data: members = [], refetch } = useQuery({
    queryKey: ['ledger-members', id],
    queryFn: async () => (await ledgerApi.members(id)).data as LedgerMember[],
  });

  const isOwner = ledger?.role === 'owner';

  const refreshLedgers = () => {
    queryClient.invalidateQueries({ queryKey: ['ledgers'] });
    queryClient.invalidateQueries({ queryKey: ['ledger-summaries'] });
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      Toast.show({ content: '请输入邮箱' });
      return;
    }
    try {
      await ledgerApi.addMember(id, { email: inviteEmail.trim(), role: inviteRole });
      Toast.show({ content: '已邀请' });
      setShowInvite(false);
      setInviteEmail('');
      setInviteRole('editor');
      refetch();
      refreshLedgers();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '邀请失败' });
    }
  };

  const handleChangeRole = async (member: LedgerMember, role: string) => {
    if (role === member.role) return;
    try {
      await ledgerApi.updateMember(id, member.userId, role);
      Toast.show({ content: '已更新' });
      refetch();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '更新失败' });
    }
  };

  const handleRemove = async (member: LedgerMember) => {
    const ok = await new Promise((resolve) => {
      Dialog.confirm({
        content: `移除成员「${member.user.nickname || member.user.email}」？`,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      await ledgerApi.removeMember(id, member.userId);
      Toast.show({ content: '已移除' });
      refetch();
      refreshLedgers();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '移除失败' });
    }
  };

  // 转让所有权（二次确认：输入「转让所有权」文案）+ 转让后本页角色刷新
  const handleTransfer = async () => {
    if (!transferTarget) return;
    if (transferText.trim() !== '转让所有权') {
      Toast.show({ content: '请输入「转让所有权」确认' });
      return;
    }
    try {
      await ledgerApi.transfer(id, transferTarget.userId);
      Toast.show({ content: '所有权已转让' });
      setTransferTarget(null);
      setTransferText('');
      refetch();
      refreshLedgers();
      queryClient.invalidateQueries({ queryKey: ['ledger', id] });
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '转让失败' });
    }
  };

  // 成员自行退出账本（owner 不可退出）
  const handleLeave = async () => {
    const ok = await new Promise((resolve) => {
      Dialog.confirm({
        content: '退出账本后你将无法查看该账本的数据，确定退出？',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      await ledgerApi.leave(id);
      Toast.show({ content: '已退出账本' });
      refreshLedgers();
      queryClient.invalidateQueries({ queryKey: ['ledger', id] });
      navigate(-1);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '退出失败' });
    }
  };

  return (
    <div className="page" ref={pageRef}>
      <NavBar onBack={() => navigate(-1)} style={{ background: 'var(--card)' }}>
        成员管理
      </NavBar>

      <div style={{ padding: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{ledger?.name}</div>
            <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>
              {members.length} 位成员 · 我的角色：
              <span style={{ color: ROLE_COLOR[ledger?.role ?? 'viewer'] }}>
                {ROLE_LABEL[ledger?.role ?? 'viewer'] ?? ledger?.role}
              </span>
            </div>
          </div>
          {isOwner && (
            <Button size="mini" color="primary" onClick={() => setShowInvite(true)}>
              <AddOutline /> 邀请成员
            </Button>
          )}
        </div>

        <List style={{ borderRadius: 12, overflow: 'hidden' }}>
          {members.map((m) => {
            const isSelf = m.userId === currentUser?.id;
            const canManage = isOwner && !isSelf;
            return (
              <List.Item
                key={m.id}
                description={
                  <span>
                    {m.user.email}
                    {isSelf && <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>（我）</span>}
                  </span>
                }
                extra={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {canManage ? (
                      <Picker
                        columns={[ASSIGNABLE_ROLES]}
                        value={[m.role]}
                        getContainer={() => pageRef.current ?? document.body}
                        onConfirm={(v) => handleChangeRole(m, String(v[0]))}
                      >
                        {(items, actions) => (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              actions.open();
                            }}
                            style={{ fontSize: 12, color: ROLE_COLOR[m.role] }}
                          >
                            {items[0]?.label ?? (ROLE_LABEL[m.role] ?? m.role)} ▾
                          </span>
                        )}
                      </Picker>
                    ) : (
                      <span style={{ fontSize: 12, color: ROLE_COLOR[m.role] }}>
                        {ROLE_LABEL[m.role] ?? m.role}
                      </span>
                    )}
                    {canManage && (
                      <Button
                        size="mini"
                        fill="outline"
                        color="warning"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTransferTarget(m);
                          setTransferText('');
                        }}
                      >
                        转让
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        size="mini"
                        fill="none"
                        color="danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemove(m);
                        }}
                      >
                        移除
                      </Button>
                    )}
                    {!isOwner && isSelf && (
                      <Button
                        size="mini"
                        fill="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLeave();
                        }}
                      >
                        退出账本
                      </Button>
                    )}
                  </div>
                }
              >
                {m.user.nickname || m.user.email}
              </List.Item>
            );
          })}
        </List>

        {!isOwner && (
          <div className="text-secondary" style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>
            仅账本所有者可以邀请成员、修改角色或移除成员
          </div>
        )}
      </div>

      {/* 邀请成员弹窗 */}
      <Popup
        visible={showInvite}
        onMaskClick={() => setShowInvite(false)}
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>邀请成员</h3>
          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>
              邮箱（需已注册）
            </div>
            <Input
              placeholder="家人注册用的邮箱"
              value={inviteEmail}
              onChange={setInviteEmail}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>角色</div>
            <Picker
              columns={[ASSIGNABLE_ROLES]}
              value={[inviteRole]}
              onConfirm={(v) => setInviteRole(String(v[0]))}
            >
              {(items, actions) => (
                <div
                  onClick={() => actions.open()}
                  style={{ background: 'var(--fill)', borderRadius: 8, padding: '10px 12px' }}
                >
                  {items[0]?.label ?? (ROLE_LABEL[inviteRole] ?? inviteRole)}
                </div>
              )}
            </Picker>
          </div>
          <Button block color="primary" onClick={handleInvite}>
            邀请
          </Button>
        </div>
      </Popup>

      {/* 转让所有权弹窗（二次确认：输入「转让所有权」文案） */}
      <Popup
        visible={!!transferTarget}
        onMaskClick={() => setTransferTarget(null)}
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>转让所有权</h3>
          <div className="text-secondary" style={{ fontSize: 13, marginBottom: 12 }}>
            转让后「{transferTarget?.user.nickname || transferTarget?.user.email}」将成为账本所有者，
            你将变为可编辑成员（不能再管理成员、转让、删除账本）。账本所有者可以邀请成员、
            修改角色、转让所有权和删除账本。
          </div>
          <Input
            placeholder="输入「转让所有权」确认"
            value={transferText}
            onChange={setTransferText}
            style={{ marginBottom: 16 }}
          />
          <Button block color="warning" onClick={handleTransfer}>
            确认转让
          </Button>
        </div>
      </Popup>
    </div>
  );
}
