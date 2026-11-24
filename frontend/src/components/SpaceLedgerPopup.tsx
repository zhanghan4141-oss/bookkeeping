import { useQueryClient } from '@tanstack/react-query';
import { List, Picker, Popup, Toast } from 'antd-mobile';
import { ledgerApi } from '../api/ledger';
import type { Ledger, UserSpace } from '../types';
import { usePopupBack } from '../hooks/usePopupBack';

interface SpaceLedgerPopupProps {
  open: boolean;
  onClose: () => void;
  ledgers: Ledger[];
  spaces: UserSpace[];
  getContainer: () => HTMLElement;
  disableBodyScroll?: boolean;
}

const LEDGER_ICON: Record<string, string> = { daily: '📒', loan: '💰', custom: '📁' };

/**
 * 「账本分组」管理：列出账本，每行选择归属空间。
 * - 我拥有的账本：可选 默认分组 / 我的空间（即选即移动）；
 * - 共享账本：固定默认分组，不可操作。
 */
export default function SpaceLedgerPopup({
  open,
  onClose,
  ledgers,
  spaces,
  getContainer,
  disableBodyScroll,
}: SpaceLedgerPopupProps) {
  const queryClient = useQueryClient();

  usePopupBack(open, onClose);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['ledgers'] });
    queryClient.invalidateQueries({ queryKey: ['spaces'] });
    queryClient.invalidateQueries({ queryKey: ['ledger-summaries'] });
    queryClient.invalidateQueries({ queryKey: ['stats', 'overview'] });
  };

  const move = async (l: Ledger, spaceId: string | null) => {
    try {
      await ledgerApi.moveSpace(l.id, spaceId);
      Toast.show({ content: '已调整分组' });
      refresh();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '操作失败' });
    }
  };

  const spaceName = (spaceId?: string | null) =>
    spaceId ? (spaces.find((s) => s.id === spaceId)?.name ?? '默认分组') : '默认分组';
  const options = [
    { label: '默认分组', value: '' },
    ...spaces.map((s) => ({ label: s.name, value: s.id })),
  ];

  return (
    <Popup
      visible={open}
      onMaskClick={onClose}
      getContainer={getContainer}
      disableBodyScroll={disableBodyScroll}
      bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
    >
      <div style={{ padding: 24 }}>
        <h3 style={{ marginBottom: 4 }}>账本分组</h3>
        <div className="text-secondary" style={{ fontSize: 13, marginBottom: 10 }}>
          选择账本所属空间（共享账本固定默认分组）
        </div>
        <List style={{ borderRadius: 12, overflow: 'hidden' }}>
          {ledgers.map((l) => {
            const owned = l.role === 'owner';
            return (
              <List.Item
                key={l.id}
                prefix={
                  <span style={{ fontSize: 24, marginRight: 8 }}>
                    {l.icon || (LEDGER_ICON[l.type] ?? '📒')}
                  </span>
                }
                description={
                  <div className="text-secondary" style={{ fontSize: 12 }}>
                    {owned ? `当前：${spaceName(l.spaceId)}` : '共享账本（固定默认分组）'}
                  </div>
                }
                extra={
                  owned ? (
                    <Picker
                      columns={[options]}
                      value={[l.spaceId ?? '']}
                      getContainer={getContainer}
                      onConfirm={(v) => move(l, String(v[0]) === '' ? null : String(v[0]))}
                    >
                      {(items, actions) => (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            actions.open();
                          }}
                          style={{ fontSize: 13, color: '#1677ff', fontWeight: 600 }}
                        >
                          {items[0]?.label ?? '默认分组'} ▾
                        </span>
                      )}
                    </Picker>
                  ) : (
                    <span className="text-secondary" style={{ fontSize: 12 }}>共享</span>
                  )
                }
              >
                {l.name}
              </List.Item>
            );
          })}
        </List>
      </div>
    </Popup>
  );
}