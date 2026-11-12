import { useContext, useEffect, useMemo, useState } from 'react';
import { Checkbox, Popup } from 'antd-mobile';
import type { Ledger } from '../types';
import { TabActiveContext } from './KeepAlive';

interface Props {
  visible: boolean;
  onClose: () => void;
  ledgers: Ledger[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** 弹窗渲染容器（keep-alive 下渲染回页面内，避免 display:none 藏不住 portal） */
  getContainer?: () => HTMLElement;
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
  getContainer,
}: Props) {
  // 打开弹窗时冻结一次顺序（选中置顶）；打开期间勾选不再重排
  const [sortedIds, setSortedIds] = useState<string[]>([]);

  useEffect(() => {
    if (visible) {
      setSortedIds(
        [...ledgers]
          .sort((a, b) => {
            const aSel = selectedIds.includes(a.id) ? 1 : 0;
            const bSel = selectedIds.includes(b.id) ? 1 : 0;
            return bSel - aSel;
          })
          .map((l) => l.id),
      );
    }
  }, [visible, ledgers]);

  const sorted = useMemo(() => {
    const byId = new Map(ledgers.map((l) => [l.id, l] as const));
    return sortedIds
      .map((id) => byId.get(id))
      .filter((l): l is Ledger => !!l);
  }, [ledgers, sortedIds]);

  const isActive = useContext(TabActiveContext);

  return (
    <Popup
      visible={visible}
      onMaskClick={onClose}
      getContainer={getContainer}
      disableBodyScroll={isActive}
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

