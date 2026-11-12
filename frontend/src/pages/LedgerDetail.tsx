import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  DatePicker,
  Dialog,
  FloatingBubble,
  Input,
  NavBar,
  Picker,
  Popup,
  SearchBar,
  SwipeAction,
  Toast,
} from 'antd-mobile';
import { AddOutline, LeftOutline, PayCircleOutline, RightOutline, TagOutline, UserOutline } from 'antd-mobile-icons';
import { ledgerApi } from '../api/ledger';
import { categoryApi } from '../api/category';
import { transactionApi } from '../api/transaction';
import api from '../api/client';
import { invalidateFinancialData } from '../lib/invalidate';
import { formatMoney } from '../lib/format';
import type { Category, Transaction } from '../types';

function groupByDate(list: Transaction[]) {
  const map = new Map<string, Transaction[]>();
  for (const t of list) {
    const key = t.occurredAt.slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return Array.from(map.entries());
}

function groupByMonth(list: Transaction[]) {
  const map = new Map<string, Transaction[]>();
  for (const t of list) {
    const key = t.occurredAt.slice(0, 7);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return Array.from(map.entries());
}

function fmt(n: string | number) {
  return formatMoney(n);
}

/** 格式化日期时间（本地时间，精确到分钟） */
function formatDateTime(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

export default function LedgerDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('month');
  const [searchField, setSearchField] = useState<'all' | 'category' | 'amount' | 'note'>('all');
  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [importResult, setImportResult] = useState<{
    successCount: number;
    errors: { row: number; message: string }[];
  } | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  // 展开的日期集合（默认展开最近一天，其余折叠）
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [editForm, setEditForm] = useState({
    type: 'expense',
    categoryId: '',
    amount: '',
    note: '',
    occurredAt: '',
  });

  const { data: ledger } = useQuery({
    queryKey: ['ledger', id],
    queryFn: async () => (await ledgerApi.get(id)).data,
  });
  const isViewer = ledger?.role === 'viewer';

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', id],
    queryFn: async () => (await categoryApi.list(id)).data as Category[],
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', id, period, month, year],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (period === 'month') params.month = month;
      else if (period === 'year') params.year = year;
      return (await transactionApi.list(id, params)).data as Transaction[];
    },
  });

  // 搜索筛选（前端过滤）
  const filtered = useMemo(() => {
    const kw = keyword.trim();
    if (!kw) return transactions;
    const isNum = /^\d+(\.\d+)?$/.test(kw);
    const num = isNum ? Number(kw) : null;
    return transactions.filter((t) => {
      if (searchField === 'category') return (t.category?.name ?? '').includes(kw);
      if (searchField === 'amount') return num !== null && Number(t.amount) === num;
      if (searchField === 'note') return (t.note ?? '').includes(kw);
      return (
        (t.note ?? '').includes(kw) ||
        (t.category?.name ?? '').includes(kw) ||
        (num !== null && Number(t.amount) === num)
      );
    });
  }, [transactions, keyword, searchField]);

  const groups = useMemo(() => {
    if (period === 'month') return groupByDate(filtered);
    return groupByMonth(filtered);
  }, [filtered, period]);

  // 切换月/年/周期时默认展开最近一个分组；删除流水时不重置（修复删除后聚合收起）
  const groupKey = `${period}-${month}-${year}`;
  const prevGroupKey = useRef('');
  useEffect(() => {
    if (groups.length > 0 && prevGroupKey.current !== groupKey) {
      setExpandedDates(new Set([groups[0][0]]));
      prevGroupKey.current = groupKey;
    }
  }, [groups, groupKey]);

  // 切换某天的展开/折叠
  const toggleDate = (date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  // 切换时间（按月则切换月份，按年/所有则切换年份）
  const shiftTime = (delta: number) => {
    if (period === 'month') {
      setMonth((prev) => {
        const [y, m] = prev.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      });
    } else {
      setYear((prev) => String(Number(prev) + delta));
    }
  };

  const monthTotal = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    let income = 0;
    let expense = 0;
    let pendingExpense = 0;
    for (const t of transactions) {
      const occurred = new Date(t.occurredAt);
      if (t.type === 'income') {
        if (occurred < tomorrow) income += Number(t.amount);
      } else if (t.type === 'expense') {
        if (occurred < tomorrow) expense += Number(t.amount);
        else pendingExpense += Number(t.amount);
      }
    }
    return {
      income,
      expense,
      surplus: income - expense,
      pendingExpense,
      pendingSurplus: income - expense - pendingExpense,
    };
  }, [transactions]);

  const handleExport = async () => {
    try {
      const res = await api.get(`/ledgers/${id}/transactions/export`, {
        params: { month },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `流水_${month}.xlsx`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '导出失败' });
    }
  };

  // 刷新流水 + 相关统计
  const refreshAll = () => invalidateFinancialData(queryClient);

  const downloadTemplate = async () => {
    try {
      const res = await api.get(`/ledgers/${id}/transactions/import-template`, {
        responseType: 'blob',
      });
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '流水导入模板.xlsx';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '模板下载失败' });
    }
  };

  const openImport = () => {
    setImportResult(null);
    setShowImport(true);
  };

  const handleImportFile = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`/api/ledgers/${id}/transactions/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('bookkeeping-auth') ? JSON.parse(localStorage.getItem('bookkeeping-auth')!).state.accessToken : ''}` },
        body: form,
      });
      const data = await res.json();
      setImportResult(data);
      if (!data.errors?.length) {
        refreshAll();
      }
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '导入失败' });
    }
  };

  // 复制流水
  const handleCopy = async (t: Transaction) => {
    try {
      await transactionApi.copy({
        ledgerId: t.ledgerId,
        categoryId: t.categoryId,
        type: t.type,
        amount: Number(t.amount),
        note: t.note,
        occurredAt: t.occurredAt,
      });
      Toast.show({ content: '已复制' });
      refreshAll();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '复制失败' });
    }
  };

  // 删除流水
  const handleDelete = async (t: Transaction) => {
    const ok = await new Promise((resolve) => {
      Dialog.confirm({
        content: '删除这条流水？',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      await transactionApi.remove(t.id);
      Toast.show({ content: '已删除' });
      refreshAll();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '删除失败' });
    }
  };

  // 切换批量勾选
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((t) => t.id)));
    }
  };

  // 批量删除
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    const ok = await new Promise((resolve) => {
      Dialog.confirm({
        content: `删除选中的 ${selectedIds.size} 条流水？`,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      await transactionApi.removeMany([...selectedIds]);
      Toast.show({ content: '已删除' });
      setSelectedIds(new Set());
      refreshAll();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '删除失败' });
    }
  };

  // 打开编辑弹窗
  const openEdit = (t: Transaction) => {
    setEditing(t);
    setEditForm({
      type: t.type,
      categoryId: t.categoryId ?? '',
      amount: t.amount,
      note: t.note ?? '',
      occurredAt: t.occurredAt, // 完整时间戳
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      const data: Record<string, unknown> = {
        type: editForm.type,
        amount: Number(editForm.amount),
        note: editForm.note || undefined,
        occurredAt: editForm.occurredAt
          ? new Date(editForm.occurredAt).toISOString()
          : undefined,
      };
      if (editForm.categoryId) {
        data.categoryId = editForm.categoryId;
      }
      await transactionApi.update(editing.id, data);
      Toast.show({ content: '已保存' });
      setEditing(null);
      refreshAll();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '保存失败' });
    }
  };

  const typeCategories = categories.filter(
    (c) => c.type === (editForm.type === 'income' ? 'income' : 'expense'),
  );

  return (
    <div className="page">
      <NavBar onBack={() => navigate(-1)} style={{ background: '#fff' }}>
        {ledger?.name ?? '账本'}
      </NavBar>

      <div style={{ padding: '16px 16px 0' }}>
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: '16px',
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div onClick={() => shiftTime(-1)} style={{ padding: '2px 6px', cursor: 'pointer' }}>
                <LeftOutline fontSize={14} />
              </div>
              {period === 'month' ? (
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  style={{ border: '1px solid #eee', borderRadius: 6, padding: '4px 8px', fontSize: 14, width: 110 }}
                />
              ) : (
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  style={{ border: '1px solid #eee', borderRadius: 6, padding: '4px 8px', fontSize: 14, width: 80 }}
                />
              )}
              <div onClick={() => shiftTime(1)} style={{ padding: '2px 6px', cursor: 'pointer' }}>
                <RightOutline fontSize={14} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['month', 'year', 'all'] as const).map((p) => (
                  <span
                    key={p}
                    onClick={() => setPeriod(p)}
                    style={{
                      fontSize: 12,
                      padding: '2px 6px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      background: period === p ? '#1677ff' : '#f5f5f5',
                      color: period === p ? '#fff' : '#666',
                    }}
                  >
                    {{ month: '按月', year: '按年', all: '所有' }[p]}
                  </span>
                ))}
              </div>
              <Button size="mini" fill="outline" onClick={handleExport}>导出</Button>
              {!isViewer && (
                <Button size="mini" fill="outline" onClick={openImport}>导入</Button>
              )}
            </div>
          </div>
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              value={searchField}
              onChange={(e) => setSearchField(e.target.value as any)}
              style={{ border: '1px solid #eee', borderRadius: 6, padding: '4px 6px', fontSize: 13, background: '#fff' }}
            >
              <option value="all">所有</option>
              <option value="category">类别</option>
              <option value="amount">金额</option>
              <option value="note">备注</option>
            </select>
            <div style={{ flex: 1 }}>
              <SearchBar
                placeholder="搜索"
                value={keyword}
                onChange={setKeyword}
                onClear={() => setKeyword('')}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', height: 36 }}>
              <div className="text-secondary" style={{ fontSize: 11 }}>收入</div>
              <div style={{ marginTop: 'auto', fontSize: 14, fontWeight: 600, color: '#52c41a' }}>
                ¥{fmt(monthTotal.income)}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', height: 36 }}>
              <div className="text-secondary" style={{ fontSize: 11 }}>支出</div>
              <div style={{ marginTop: 'auto', fontSize: 14, fontWeight: 600, color: '#ff4d4f' }}>
                ¥{fmt(monthTotal.expense)}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', height: 36 }}>
              <div className="text-secondary" style={{ fontSize: 11 }}>结余</div>
              <div style={{ marginTop: 'auto', fontSize: 14, fontWeight: 600, color: '#1677ff' }}>
                ¥{fmt(monthTotal.surplus)}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', height: 36, opacity: 0.45 }}>
                <div className="text-secondary" style={{ fontSize: 10 }}>待支出</div>
                <div style={{ marginTop: 'auto', fontSize: 12, fontWeight: 600, color: '#ff4d4f' }}>
                  ¥{fmt(monthTotal.pendingExpense)}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', height: 36, opacity: 0.45 }}>
                <div className="text-secondary" style={{ fontSize: 10 }}>待结余</div>
                <div style={{ marginTop: 'auto', fontSize: 12, fontWeight: 600, color: '#1677ff' }}>
                  ¥{fmt(monthTotal.pendingSurplus)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Button block fill="outline" onClick={() => navigate(`/ledgers/${id}/members`)}>
            <UserOutline /> 成员
          </Button>
          <Button block fill="outline" onClick={() => navigate(`/ledgers/${id}/categories`)}>
            <TagOutline /> 分类
          </Button>
          <Button block color="primary" onClick={() => navigate(`/ledgers/${id}/loans`)}>
            <PayCircleOutline /> 贷款管理
          </Button>
        </div>

        {keyword.trim() !== '' ? (
          <div>
            {!isViewer && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#666' }}>已选 {selectedIds.size} 条</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button size="mini" fill="outline" onClick={toggleSelectAll}>
                    {selectedIds.size === filtered.length ? '取消全选' : '全选'}
                  </Button>
                  <Button size="mini" color="danger" onClick={handleBatchDelete} disabled={selectedIds.size === 0}>
                    删除选中
                  </Button>
                </div>
              </div>
            )}
            {filtered.map((t) => (
              <div key={t.id} style={{ background: '#fff', marginBottom: 8, borderRadius: 12, padding: '10px 12px', display: 'flex', alignItems: 'center' }}>
                {!isViewer && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(t.id)}
                    onChange={() => toggleSelect(t.id)}
                    style={{ marginRight: 10, width: 18, height: 18 }}
                  />
                )}
                <span style={{ fontSize: 22, marginRight: 10 }}>
                  {t.category?.icon || (t.type === 'expense' ? '💸' : t.type === 'income' ? '💰' : '🔄')}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15 }}>
                    {t.category?.name ?? (t.type === 'transfer' ? '转账' : '未分类')}
                  </div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                    {formatDateTime(new Date(t.occurredAt))}
                    {t.note && <span style={{ marginLeft: 6 }}>{t.note}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 14, fontWeight: 600, color: t.type === 'income' ? '#52c41a' : '#ff4d4f' }}>
                  {t.type === 'income' ? '+' : '-'}¥{fmt(t.amount)}
                </span>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>无搜索结果</div>
            )}
          </div>
        ) : (
          groups.map(([date, items]) => {
          const dayIncome = items.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
          const dayExpense = items.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
          const isExpanded = expandedDates.has(date);
          return (
            <div key={date} style={{ background: '#fff', marginBottom: 8, borderRadius: 12, overflow: 'hidden' }}>
              <div
                onClick={() => toggleDate(date)}
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  color: '#666',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  borderBottom: isExpanded ? '1px solid #f5f5f5' : 'none',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#bbb', fontSize: 12, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>
                    ▶
                  </span>
                  <span>{date}</span>
                  <span style={{ fontSize: 12, color: '#999' }}>{items.length} 笔</span>
                </span>
                <span>
                  {dayExpense > 0 && <span style={{ color: '#999' }}>支 ¥{fmt(dayExpense)} </span>}
                  {dayIncome > 0 && <span style={{ color: '#999' }}>收 ¥{fmt(dayIncome)}</span>}
                </span>
              </div>
              {isExpanded && items.map((t) => {
                const isLoanTx = !!t.loanId;
                const content = (
                  <div
                    key={t.id}
                    onClick={() => !isLoanTx && !isViewer && openEdit(t)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '10px 12px',
                      borderBottom: '1px solid #fafafa',
                      background: '#fff',
                      cursor: isLoanTx || isViewer ? 'default' : 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 22, marginRight: 10 }}>
                      {t.category?.icon || (t.type === 'expense' ? '💸' : t.type === 'income' ? '💰' : '🔄')}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15 }}>
                        {t.category?.name ?? (t.type === 'transfer' ? '转账' : '未分类')}
                      </div>
                      <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                        {formatDateTime(new Date(t.occurredAt))}
                        {t.note && <span style={{ marginLeft: 6 }}>{t.note}</span>}
                        {isLoanTx && (
                          <span style={{ marginLeft: 6, color: '#1677ff' }}>
                            〔{t.loan?.name ?? '贷款'}〕
                          </span>
                        )}
                      </div>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: t.type === 'income' ? '#52c41a' : '#ff4d4f' }}>
                      {t.type === 'income' ? '+' : '-'}¥{fmt(t.amount)}
                    </span>
                  </div>
                );

                // 贷款流水只读，不可左滑操作；viewer 也只读
                if (isLoanTx || isViewer) return content;

                return (
                  <SwipeAction
                    key={t.id}
                    rightActions={[
                      {
                        key: 'copy',
                        text: '复制',
                        color: 'primary',
                        onClick: () => handleCopy(t),
                      },
                      {
                        key: 'delete',
                        text: '删除',
                        color: 'danger',
                        onClick: () => handleDelete(t),
                      },
                    ]}
                  >
                    {content}
                  </SwipeAction>
                );
              })}
            </div>
          );
        })
        )}
        {!keyword.trim() && transactions.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            本月暂无流水，点击右下角记一笔
          </div>
        )}
      </div>

      {!isViewer && (
        <FloatingBubble
          style={{
            '--initial-position-bottom': '90px',
            '--initial-position-right': '20px',
          }}
          onClick={() => navigate(`/ledgers/${id}/record`)}
        >
          <AddOutline fontSize={24} />
        </FloatingBubble>
      )}

      {/* 编辑流水弹窗 */}
      <Popup
        visible={!!editing}
        onMaskClick={() => setEditing(null)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>编辑流水</h3>

          {/* 类型切换 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[
              { key: 'expense', label: '支出', color: '#ff4d4f' },
              { key: 'income', label: '收入', color: '#52c41a' },
              { key: 'transfer', label: '转账', color: '#1677ff' },
            ].map((t) => (
              <div
                key={t.key}
                onClick={() => setEditForm((f) => ({ ...f, type: t.key, categoryId: '' }))}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '8px 0',
                  borderRadius: 8,
                  background: editForm.type === t.key ? t.color : '#f5f5f5',
                  color: editForm.type === t.key ? '#fff' : '#666',
                  fontWeight: editForm.type === t.key ? 600 : 400,
                }}
              >
                {t.label}
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 12 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>金额</div>
            <Input
              type="number"
              value={editForm.amount}
              onChange={(v) => setEditForm((f) => ({ ...f, amount: v }))}
              style={{ fontSize: 24 }}
            />
          </div>

          {editForm.type !== 'transfer' && (
            <div style={{ marginBottom: 12 }}>
              <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>类别</div>
              <Picker
                columns={[typeCategories.map((c) => ({ label: c.name, value: c.id }))]}
                value={editForm.categoryId ? [editForm.categoryId] : []}
                onConfirm={(v) => setEditForm((f) => ({ ...f, categoryId: String(v[0] ?? '') }))}
              >
                {(items, actions) => (
                  <div
                    onClick={() => actions.open()}
                    style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}
                  >
                    {items[0]?.label ?? '选择类别'}
                  </div>
                )}
              </Picker>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>日期时间</div>
            <DatePicker
              precision="minute"
              value={editForm.occurredAt ? new Date(editForm.occurredAt) : new Date()}
              onConfirm={(v) => setEditForm((f) => ({ ...f, occurredAt: v.toISOString() }))}
            >
              {(_value, actions) => (
                <div
                  onClick={() => actions.open()}
                  style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}
                >
                  {editForm.occurredAt ? formatDateTime(new Date(editForm.occurredAt)) : '选择日期时间'}
                </div>
              )}
            </DatePicker>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>备注</div>
            <Input
              value={editForm.note}
              onChange={(v) => setEditForm((f) => ({ ...f, note: v }))}
              placeholder="备注"
            />
          </div>

          <Button block color="primary" onClick={saveEdit}>保存</Button>
        </div>
      </Popup>

      {/* 导入流水弹窗 */}
      <Popup
        visible={showImport}
        onMaskClick={() => setShowImport(false)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Button size="mini" fill="outline" onClick={downloadTemplate}>下载模板</Button>
            <span style={{ fontWeight: 600, fontSize: 16 }}>导入流水</span>
            <span onClick={() => setShowImport(false)} style={{ fontSize: 22, color: '#999', cursor: 'pointer', lineHeight: 1 }}>×</span>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
          />
          <Button block color="primary" onClick={() => fileRef.current?.click()}>
            选择 Excel 文件上传
          </Button>

          {importResult && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                成功 {importResult.successCount} 笔
                {importResult.errors.length > 0 ? `，失败 ${importResult.errors.length} 笔` : ''}
              </div>
              {importResult.errors.length > 0 && (
                <div style={{ maxHeight: '40vh', overflowY: 'auto' }}>
                  {importResult.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 13, color: '#ff4d4f', padding: '4px 0', borderBottom: '1px solid #f5f5f5' }}>
                      第 {e.row} 行：{e.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Popup>
    </div>
  );
}
