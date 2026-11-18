import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { NavBar, Picker } from 'antd-mobile';
import { auditLogApi } from '../api/misc';
import { categoryApi } from '../api/category';
import { ledgerApi } from '../api/ledger';
import { loanApi } from '../api/loan';
import type { AuditLogItem, Category, Ledger, Loan } from '../types';

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
  categoryId: '类别',
  loanId: '贷款',
  occurredAt: '发生时间',
  startDate: '开始日期',
  repaymentMethod: '还款方式',
  currency: '币种',
  sortOrder: '排序',
};

/** 系统/技术字段：详情中不展示（噪音或内部引用） */
const IGNORED_FIELDS = ['id', 'ledgerId', 'userId', 'createdAt', 'updatedAt', 'passwordHash', 'isBuiltin'];

/** 一条字段差异：字段名 / 原始值 / 修改值（删除场景无修改值） */
interface DiffEntry {
  field: string;
  from?: string;
  to?: string;
}

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
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/**
 * 渲染 before/after 差异，只展示对用户有意义的业务字段：
 * - 跳过系统/技术字段（id / createdAt / updatedAt / ledgerId / userId …）
 * - 外键字段（categoryId / loanId）用 resolve 转成对应名称，可读
 */
function formatDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  resolve: (k: string, v: unknown) => string,
): DiffEntry[] {
  if (!after) {
    // 删除：展示被删内容（只有原始值）
    return before
      ? Object.entries(before)
          .filter(([k]) => !IGNORED_FIELDS.includes(k))
          .map(([k, v]) => ({ field: label(k), from: resolve(k, v), to: undefined }))
      : [];
  }
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  const diffs: DiffEntry[] = [];
  for (const k of keys) {
    if (IGNORED_FIELDS.includes(k)) continue;
    const b = before?.[k];
    const a = after[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      diffs.push({ field: label(k), from: resolve(k, b), to: resolve(k, a) });
    }
  }
  return diffs;
}

export default function AuditLogs() {
  const navigate = useNavigate();
  const pageRef = useRef<HTMLDivElement>(null);
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

  // 类别/贷款名称映射：把 categoryId / loanId 渲染成可读名称
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', activeLedgerId],
    queryFn: async () => (await categoryApi.list(activeLedgerId)).data as Category[],
    enabled: !!activeLedgerId,
  });
  const { data: loans = [] } = useQuery({
    queryKey: ['loans', activeLedgerId],
    queryFn: async () => (await loanApi.list(activeLedgerId)).data as Loan[],
    enabled: !!activeLedgerId,
  });
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const loanName = useMemo(() => new Map(loans.map((l) => [l.id, l.name])), [loans]);

  // 外键 → 名称；找不到说明对应类别/贷款已被删除
  const resolveField = (k: string, v: unknown): string => {
    if (k === 'categoryId' && v != null && v !== '') {
      return catName.get(String(v)) ?? '（类别已删除）';
    }
    if (k === 'loanId' && v != null && v !== '') {
      return loanName.get(String(v)) ?? '（贷款已删除）';
    }
    return formatVal(v);
  };

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
    <div className="page" ref={pageRef}>
      <NavBar onBack={() => navigate(-1)} style={{ background: '#fff' }}>
        日志查询
      </NavBar>

      <div style={{ padding: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: '12px 16px', marginBottom: 12 }}>
          <Picker
            columns={ledgerOptions}
            value={activeLedgerId ? [activeLedgerId] : []}
            getContainer={() => pageRef.current ?? document.body}
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
          const diffs = formatDiff(log.before, log.after, resolveField);
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
                    <div key={i} style={{ fontSize: 13, padding: '3px 0' }}>
                      <span style={{ color: '#999' }}>{d.field}：</span>
                      <span style={{ color: '#ff4d4f' }}>{d.from || '空'}</span>
                      {d.to !== undefined && (
                        <>
                          <span style={{ color: '#bbb', margin: '0 6px' }}>→</span>
                          <span style={{ color: '#52c41a' }}>{d.to || '空'}</span>
                        </>
                      )}
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
