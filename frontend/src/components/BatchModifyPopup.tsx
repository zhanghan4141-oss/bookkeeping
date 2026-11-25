import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Popup, Radio, Toast } from 'antd-mobile';
import { categoryApi } from '../api/category';
import { ledgerApi } from '../api/ledger';
import { transactionApi } from '../api/transaction';
import type { Category, Ledger } from '../types';
import { usePopupBack } from '../hooks/usePopupBack';

interface BatchModifyPopupProps {
  visible: boolean;
  onClose: () => void;
  /** 当前账本（修改类别目标；批量转移的目标账本会排除它） */
  ledgerId: string;
  /** 选中流水 ids（已排除贷款/支出计划流水） */
  txIds: string[];
  /** 流水类型（转移目标类别/类别列表按此过滤；不传/传 transfer 则列出全部可选类别） */
  txType?: 'expense' | 'income' | 'transfer' | null;
  getContainer?: () => HTMLElement;
  /** keep-alive 页面隐藏时关闭 body 滚动锁（对齐现有弹窗惯例） */
  disableBodyScroll?: boolean;
  /** 任一操作成功后调用：清空选中 + 刷新列表/统计 */
  onChanged: () => void;
}

/**
 * 批量搜索结果的「修改」弹窗：修改类别 / 批量转移 / 修改备注。
 * - 修改备注：备注为空时不提交（不把流水备注清空）；
 * - 批量转移：逐条复用单条 transfer 接口（目标账本 + 可选目标类别，transfer 流水目标归未分类）。
 */
export default function BatchModifyPopup({
  visible,
  onClose,
  ledgerId,
  txIds,
  txType,
  getContainer,
  disableBodyScroll,
  onChanged,
}: BatchModifyPopupProps) {
  const [selCatId, setSelCatId] = useState('');
  const [targetLedger, setTargetLedger] = useState<Ledger | null>(null);
  const [targetCatId, setTargetCatId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  usePopupBack(visible, onClose);

  // 当前账本类别（修改类别选项）
  const { data: cats = [] } = useQuery({
    queryKey: ['categories', ledgerId],
    queryFn: async () => (await categoryApi.list(ledgerId)).data as Category[],
  });
  const categoryOptions =
    txType && txType !== 'transfer' ? cats.filter((c) => c.type === txType) : cats;

  // 批量转移：目标账本（排除当前账本与 viewer）与其类别
  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });
  const available = ledgers.filter((l) => l.id !== ledgerId && l.role !== 'viewer');

  const { data: targetCats = [] } = useQuery({
    queryKey: ['categories', targetLedger?.id],
    queryFn: async () => (await categoryApi.list(targetLedger!.id)).data as Category[],
    enabled: !!targetLedger,
  });
  const transferCats =
    txType && txType !== 'transfer'
      ? targetCats.filter((c) => c.type === txType)
      : targetCats;

  const applyCategory = () => {
    if (!selCatId) {
      Toast.show({ content: '请选择类别' });
      return;
    }
    try {
      transactionApi.updateCategoryMany(ledgerId, txIds, selCatId).then(() => {
        Toast.show({ content: '已修改类别' });
        onChanged();
      });
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '修改失败' });
    }
  };

  const applyTransfer = async () => {
    if (!targetLedger) {
      Toast.show({ content: '请选择目标账本' });
      return;
    }
    const failed: string[] = [];
    for (const id of txIds) {
      try {
        await transactionApi.transfer(id, {
          ledgerId: targetLedger.id,
          categoryId: targetCatId,
        });
      } catch {
        failed.push(id);
      }
    }
    if (failed.length === 0) Toast.show({ content: `已转移 ${txIds.length} 条流水` });
    else if (failed.length === txIds.length) Toast.show({ content: '转移失败' });
    else Toast.show({ content: `部分转移失败（${failed.length}/${txIds.length}）` });
    onChanged();
  };

  const applyNote = async () => {
    if (!note.trim()) {
      Toast.show({ content: '备注为空，未修改（不清空原备注）' });
      return;
    }
    const failed: string[] = [];
    for (const id of txIds) {
      try {
        await transactionApi.update(id, { note: note.trim() });
      } catch {
        failed.push(id);
      }
    }
    if (failed.length === 0) Toast.show({ content: '已更新备注' });
    else if (failed.length === txIds.length) Toast.show({ content: '备注更新失败' });
    else Toast.show({ content: `部分备注更新失败（${failed.length}/${txIds.length}）` });
    onChanged();
  };

  return (
    <Popup
      visible={visible}
      onMaskClick={onClose}
      getContainer={getContainer}
      disableBodyScroll={disableBodyScroll}
      bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
    >
      <div style={{ padding: 24 }}>
        <h3 style={{ marginBottom: 8 }}>修改</h3>
        <div className="text-secondary" style={{ fontSize: 13, marginBottom: 12 }}>
          已选 {txIds.length} 条流水（贷款/支出计划流水不参与）
        </div>

        {/* 修改类别 */}
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>修改类别</div>
        <Radio.Group value={selCatId} onChange={(v) => setSelCatId(String(v))}>
          {categoryOptions.map((c) => (
            <Radio key={c.id} value={c.id} style={{ marginBottom: 6 }}>
              {c.name}
            </Radio>
          ))}
        </Radio.Group>
        <Button block color="primary" onClick={applyCategory} disabled={!selCatId} style={{ marginBottom: 16 }}>
          应用类别
        </Button>

        {/* 批量转移 */}
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>批量转移</div>
        {available.map((l) => (
          <div
            key={l.id}
            onClick={() => {
              setTargetLedger(l);
              setTargetCatId(null);
            }}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              marginBottom: 6,
              background: targetLedger?.id === l.id ? 'var(--primary-weak)' : 'var(--fill)',
              color: targetLedger?.id === l.id ? 'var(--primary)' : 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {l.name}
          </div>
        ))}
        {available.length === 0 && (
          <div className="text-secondary" style={{ fontSize: 12, marginBottom: 6 }}>
            暂无可转入的账本
          </div>
        )}
        {targetLedger && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>目标类别（可选，默认未分类）</div>
            <Radio.Group value={targetCatId ?? ''} onChange={(v) => setTargetCatId(String(v))}>
              {transferCats.map((c) => (
                <Radio key={c.id} value={c.id} style={{ marginBottom: 6 }}>
                  {c.name}
                </Radio>
              ))}
            </Radio.Group>
          </>
        )}
        <Button block color="primary" onClick={applyTransfer} disabled={!targetLedger} style={{ marginBottom: 16 }}>
          批量转移
        </Button>

        {/* 修改备注（空则不修改，不清空原备注） */}
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>修改备注</div>
        <Input
          placeholder="输入新备注（留空则不修改）"
          value={note}
          onChange={setNote}
          style={{ marginBottom: 8 }}
        />
        <Button block color="primary" onClick={applyNote} disabled={!note.trim()}>
          保存备注
        </Button>
      </div>
    </Popup>
  );
}