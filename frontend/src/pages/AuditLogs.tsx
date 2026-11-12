import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { NavBar, Picker } from 'antd-mobile';
import { auditLogApi } from '../api/misc';
import { ledgerApi } from '../api/ledger';
import type { AuditLogItem, Ledger } from '../types';

const FIELD_LABEL: Record<string, string> = {
  amount: '金额',
  note: '备注',
  type: '类型',
  name: '名称',
  principal: '本金',
  annualRate: '年利率',
  termMonths: '期数',
  repaymentDay: '还款日',
  direction: '方向',
  role: '角色',
  color: '颜色',
  icon: '图标',
  status: '状态',
};

function formatTime(s: string): string {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function label(key: string): string {
  return FIELD_LABEL[key] ?? key;
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '空';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function formatDiff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  if (!after) {
    // 删除：展示被删内容
    return before ? Object.entries(before).map(([k, v]) => `${label(k)}: ${formatVal(v)}`) : [];
  }
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  const diffs: string[] = [];
  for (const k of keys) {
    const b = before?.[k];
    const a = after[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      diffs.push(`${label(k)}: ${formatVal(b)} → ${formatVal(a)}`);
    }
  }
  return diffs;
}

export default function AuditLogs() {
  const navigate = useNavigate();
  const [ledgerId, setLedgerId] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });

  // 默认选中第一个账本
  const activeLedgerId = ledgerId || ledgers[0]?.id || '';
  const activeLedger = ledgers.find((l) => l.id === activeLedgerId);

  const { data: logs = [] } = useQuery({
    queryKey: ['audit-logs', activeLedgerId],
    queryFn: async () => (await auditLogApi.list(activeLedgerId)).data as AuditLogItem[],
    enabled: !!activeLedgerId,
  });

  const ledgerOptions = useMemo(
    () => [ledgers.map((l) => ({ label: l.name, value: l.id }))],
    [ledgers],
  );

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="page">
      <NavBar onBack={() => navigate(-1)} style={{ background: '#fff' }}>
        日志查询
      </NavBar>

      <div style={{ padding: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: '12px 16px', marginBottom: 12 }}>
          <Picker
            columns={ledgerOptions}
            value={activeLedgerId ? [activeLedgerId] : []}
            onConfirm={(v) => setLedgerId(String(v[0]))}
          >
            {(_items, actions) => (
              <div onClick={() => actions.open()} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14 }}>账本</span>
                <span style={{ color: '#1677ff', fontSize: 14 }}>
                  {activeLedger?.name ?? '选择账本'}
                </span>
              </div>
            )}
          </Picker>
        </div>

        {logs.map((log) => {
          const isExpanded = expanded.has(log.id);
          const diffs = formatDiff(log.before, log.after);
          return (
            <div key={log.id} style={{ background: '#fff', borderRadius: 12, padding: '12px 16px', marginBottom: 8 }}>
              <div onClick={() => toggle(log.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>
                    {log.summary}
                    <span style={{ marginLeft: 8, color: '#999', fontSize: 12 }}>{log.nickname}</span>
                  </div>
                  <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>
                    {formatTime(log.createdAt)}
                  </div>
                </div>
                {diffs.length > 0 && (
                  <span style={{ color: '#bbb', fontSize: 12, marginLeft: 8 }}>
                    {isExpanded ? '收起' : '详情'}
                  </span>
                )}
              </div>
              {isExpanded && diffs.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f5f5f5' }}>
                  {diffs.map((d, i) => (
                    <div key={i} style={{ fontSize: 13, color: '#666', padding: '3px 0' }}>
                      {d}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {logs.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            暂无操作日志
          </div>
        )}
      </div>
    </div>
  );
}
