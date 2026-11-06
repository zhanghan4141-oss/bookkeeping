import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, Input, List, NavBar, Picker, Popup, Toast } from 'antd-mobile';
import { AddOutline } from 'antd-mobile-icons';
import { ledgerApi } from '../api/ledger';
import { useAuthStore } from '../stores/auth';
import type { Ledger, LedgerMember } from '../types';

const ROLE_OPTIONS = [
  { label: '所有者', value: 'owner' },
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
  const currentUser = useAuthStore((s) => s.user);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');

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

  return (
    <div className="page">
      <NavBar onBack={() => navigate(-1)} style={{ background: '#fff' }}>
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
                    {isSelf && <span style={{ marginLeft: 6, color: '#999' }}>（我）</span>}
                  </span>
                }
                extra={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {canManage ? (
                      <Picker
                        columns={[ROLE_OPTIONS]}
                        value={[m.role]}
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
              columns={[ROLE_OPTIONS]}
              value={[inviteRole]}
              onConfirm={(v) => setInviteRole(String(v[0]))}
            >
              {(items, actions) => (
                <div
                  onClick={() => actions.open()}
                  style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}
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
    </div>
  );
}
