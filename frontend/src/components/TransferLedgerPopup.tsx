import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Popup, Toast } from 'antd-mobile';
import { ledgerApi } from '../api/ledger';
import { categoryApi } from '../api/category';
import { transactionApi } from '../api/transaction';
import { invalidateFinancialData } from '../lib/invalidate';
import { useBusy } from '../hooks/useBusy';
import type { Category, Ledger } from '../types';

interface Props {
  visible: boolean;
  txId: string;
  /** 当前流水所在账本，候选目标账本会排除它 */
  currentLedgerId: string;
  /** 流水类型，目标账本里只展示同类型分类（transfer 类型流水只能归为未分类） */
  txType: 'expense' | 'income' | 'transfer';
  getContainer?: () => HTMLElement;
  onClose: () => void;
}

export default function TransferLedgerPopup({
  visible,
  txId,
  currentLedgerId,
  txType,
  getContainer,
  onClose,
}: Props) {
  const { busy, run } = useBusy();
  const queryClient = useQueryClient();
  // 选中的目标账本（单选）
  const [targetLedger, setTargetLedger] = useState<Ledger | null>(null);
  // 选中的目标分类；null = 未分类
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });
  // 可转入：排除当前账本、排除只看（viewer）的账本
  const available = ledgers.filter(
    (l) => l.id !== currentLedgerId && l.role !== 'viewer',
  );

  const { data: targetCats = [] } = useQuery({
    queryKey: ['categories', targetLedger?.id],
    queryFn: async () =>
      (await categoryApi.list(targetLedger!.id)).data as Category[],
    enabled: !!targetLedger,
  });
  const matchedCats = txType === 'transfer' ? [] : targetCats.filter((c) => c.type === txType);

  const selectLedger = (l: Ledger) => {
    setTargetLedger(l);
    setCategoryId(null);
  };

  const confirm = () => {
    if (!targetLedger) return;
    run(async () => {
      try {
        await transactionApi.transfer(txId, {
          ledgerId: targetLedger.id,
          categoryId,
        });
        Toast.show({ content: '已转移' });
        invalidateFinancialData(queryClient);
        onClose();
      } catch (e: any) {
        Toast.show({ content: e.response?.data?.message ?? '转移失败' });
      }
    });
  };

  return (
    <Popup
      visible={visible}
      onMaskClick={onClose}
      getContainer={getContainer}
      bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
    >
      <div style={{ padding: 24 }}>
        <h3 style={{ marginBottom: 16 }}>转移流水到账本</h3>

        <div className="text-secondary" style={{ fontSize: 13, marginBottom: 12 }}>
          选择目标账本
        </div>
        {available.map((l) => (
          <div
            key={l.id}
            onClick={() => selectLedger(l)}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              marginBottom: 8,
              background: targetLedger?.id === l.id ? '#e6f4ff' : '#f5f5f5',
              color: targetLedger?.id === l.id ? '#1677ff' : '#333',
              cursor: 'pointer',
            }}
          >
            {l.name}
          </div>
        ))}
        {available.length === 0 && (
          <div style={{ color: '#999', fontSize: 13, marginBottom: 8 }}>
            暂无可转入的账本
          </div>
        )}

        {targetLedger && (
          <>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 12, marginTop: 16 }}>
              选择目标分类
            </div>
            <div
              onClick={() => setCategoryId(null)}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                marginBottom: 8,
                background: categoryId === null ? '#e6f4ff' : '#f5f5f5',
                cursor: 'pointer',
              }}
            >
              未分类
            </div>
            {matchedCats.map((c) => (
              <div
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  marginBottom: 8,
                  background: categoryId === c.id ? '#e6f4ff' : '#f5f5f5',
                  cursor: 'pointer',
                }}
              >
                {c.icon} {c.name}
              </div>
            ))}
          </>
        )}

        <Button block color="primary" loading={busy} disabled={!targetLedger} onClick={confirm}>
          确认转移
        </Button>
      </div>
    </Popup>
  );
}