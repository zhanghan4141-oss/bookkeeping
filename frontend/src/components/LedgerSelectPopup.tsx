import { useMemo } from 'react';
import { Checkbox, Popup } from 'antd-mobile';
import type { Ledger } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  ledgers: Ledger[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}

/**
 * 账本多选弹窗：用于还款/统计页面选择参与统计的账本。
 * 选中状态由调用方传入（还款页和统计页各用自己的 store）。
 */
export default function LedgerSelectPopup({
  visible,
  onClose,
  ledgers,
  selectedIds,
  onToggle,
}: Props) {
  // 选中的排前面
  const sorted = useMemo(() => {
    return [...ledgers].sort((a, b) => {
      const aSel = selectedIds.includes(a.id) ? 1 : 0;
      const bSel = selectedIds.includes(b.id) ? 1 : 0;
      return bSel - aSel;
    });
  }, [ledgers, selectedIds]);

  return (
    <Popup
      visible={visible}
      onMaskClick={onClose}
      bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
    >
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 16 }}>选择账本</span>
          <span style={{ fontSize: 13, color: '#1677ff' }} onClick={onClose}>完成</span>
        </div>
        <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {sorted.map((l) => (
            <div
              key={l.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 4px',
                borderBottom: '1px solid #f5f5f5',
              }}
              onClick={() => onToggle(l.id)}
            >
              <span style={{ fontSize: 14 }}>{l.name}</span>
              <Checkbox checked={selectedIds.includes(l.id)} />
            </div>
          ))}
          {ledgers.length === 0 && (
            <div className="text-secondary" style={{ padding: 20, textAlign: 'center' }}>暂无账本</div>
          )}
        </div>
      </div>
    </Popup>
  );
}

