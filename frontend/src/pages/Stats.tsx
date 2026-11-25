import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Dialog, Input, NavBar, Picker, Popup, SearchBar, SwipeAction, TextArea, Toast } from 'antd-mobile';
import { LeftOutline, RightOutline } from 'antd-mobile-icons';
import { Lunar, LunarMonth, Solar } from 'lunar-javascript';
import { statApi } from '../api/misc';
import { ledgerApi } from '../api/ledger';
import { categoryApi } from '../api/category';
import { transactionApi } from '../api/transaction';
import Chart from '../components/Chart';
import ExpandableNote from '../components/ExpandableNote';
import LedgerSelectPopup, { NONE_LEDGER_MARKER } from '../components/LedgerSelectPopup';
import TransferLedgerPopup from '../components/TransferLedgerPopup';
import BatchModifyPopup from '../components/BatchModifyPopup';
import { useStatLedgerSelection } from '../stores/statLedgerSelection';
import { useThemeStore } from '../stores/themeStore';
import { TabActiveContext } from '../components/KeepAlive';
import type { Category, Ledger, StatSummary, Transaction } from '../types';
import { formatMoney } from '../lib/format';
import { usePopupBack } from '../hooks/usePopupBack';
import { useStuck } from '../hooks/useStuck';

/** 读取 CSS 变量（ECharts option 不解析 var()，需 JS 取当前值） */
function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || '#999';
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 简化横轴标签：按天只显示日，按月只显示月，按年只显示年 */
function shortAxisKey(key: string, period: 'day' | 'month' | 'year'): string {
  if (period === 'day') return key.split('-').pop() ?? key;
  if (period === 'month') return key.split('-')[1] ?? key;
  return key;
}

/** 类别流水按统计粒度分组：day→日 / month→月 / year→年（农历年粒度用农历年号） */
function groupByKey(
  list: Transaction[],
  period: 'day' | 'month' | 'year',
  calendar: 'solar' | 'lunar',
): [string, Transaction[]][] {
  const map = new Map<string, Transaction[]>();
  for (const t of list) {
    const d = new Date(t.occurredAt);
    let key: string;
    if (period === 'day') key = t.occurredAt.slice(0, 10);
    else if (period === 'month') key = t.occurredAt.slice(0, 7);
    else if (calendar === 'lunar') key = `农历${Solar.fromDate(d).getLunar().getYear()}年`;
    else key = String(d.getFullYear());
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return Array.from(map.entries());
}

function formatDateTime(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 稳定的空数组引用，避免 useQuery 默认值每次渲染都新建导致依赖不稳定（引发无限循环） */
const EMPTY_TX: Transaction[] = [];

/** 快捷区间类型（新增 all / cq 本季 / ny 明年 / mo1-12 月份） */
type QuickRangeKey =
  | 'year'
  | 'month'
  | 'q1'
  | 'q2'
  | 'q3'
  | 'q4'
  | 'tmom'
  | 'tye'
  | 'tlye'
  | 'all'
  | 'cq'
  | 'ny'
  | `mo${number}`;

/** 公历某月区间（含月末整天） */
function solarMonthSpan(year: number, month: number): { start: string; end: string } {
  return { start: fmtDate(new Date(year, month - 1, 1)), end: fmtDate(new Date(year, month, 0)) };
}

/** 公历当前季度区间（首日 ~ 季末最后一天） */
function solarQuarterSpan(d: Date): { start: string; end: string } {
  const q = Math.floor(d.getMonth() / 3);
  return {
    start: fmtDate(new Date(d.getFullYear(), q * 3, 1)),
    end: fmtDate(new Date(d.getFullYear(), (q + 1) * 3, 0)),
  };
}

/** 公历某年区间 */
function solarYearSpan(year: number): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

/** 农历某月区间（农历月整月，公历首/末日） */
function lunarMonthSpan(year: number, month: number): { start: string; end: string } {
  const dayCount = LunarMonth.fromYm(year, month).getDayCount();
  const s = Lunar.fromYmd(year, month, 1).getSolar().toYmd();
  const e = Lunar.fromYmd(year, month, dayCount).getSolar().toYmd();
  return { start: s, end: e };
}

/** 农历某年区间（正月首日 ~ 腊月末最后一天） */
function lunarYearSpan(lunarYear: number): { start: string; end: string } {
  const dayCount = LunarMonth.fromYm(lunarYear, 12).getDayCount();
  const s = Lunar.fromYmd(lunarYear, 1, 1).getSolar().toYmd();
  const e = Lunar.fromYmd(lunarYear, 12, dayCount).getSolar().toYmd();
  return { start: s, end: e };
}

/** 快捷区间分组按钮 */
const QUICK_GROUPS: { title: string; buttons: { key: QuickRangeKey; label: string }[] }[] = [
  {
    title: '月份',
    buttons: Array.from({ length: 12 }, (_, i) => ({
      key: `mo${i + 1}` as QuickRangeKey,
      label: `${i + 1}月`,
    })),
  },
  {
    title: '日历单位',
    buttons: [
      { key: 'month', label: '本月' },
      { key: 'cq', label: '本季' },
      { key: 'year', label: '本年' },
      { key: 'ny', label: '明年' },
    ],
  },
  {
    title: '季度',
    buttons: [
      { key: 'q1', label: 'Q1' },
      { key: 'q2', label: 'Q2' },
      { key: 'q3', label: 'Q3' },
      { key: 'q4', label: 'Q4' },
    ],
  },
  {
    title: '截止',
    buttons: [
      { key: 'tmom', label: '明日-月底' },
      { key: 'tye', label: '明日-年底' },
      { key: 'tlye', label: '明日-农历年底' },
    ],
  },
];

/** 「所有」：1900-01-01 ~ 2099-12-31，覆盖全部时间 */
const QUICK_ALL: { key: QuickRangeKey; label: string } = { key: 'all', label: '所有' };

/** 快捷区间：当年/当月/季 + 明日到月底/年底/农历年底，跟随当前历法 */
function quickRange(
  key: 'year' | 'month' | 'q1' | 'q2' | 'q3' | 'q4' | 'tmom' | 'tye' | 'tlye',
  calendar: 'solar' | 'lunar',
): { start: string; end: string } {
  const now = new Date();
  const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  };

  if (calendar === 'lunar') {
    const lunar = Solar.fromDate(now).getLunar();
    const ly = lunar.getYear();
    const lm = lunar.getMonth(); // 负数=闰月
    const monthRange = (year: number, month: number) => {
      const start = Lunar.fromYmd(year, month, 1).getSolar().toYmd();
      const end = Lunar.fromYmd(year, month, LunarMonth.fromYm(year, month).getDayCount()).getSolar().toYmd();
      return { start, end };
    };
    const quarter = (fromMonth: number, toMonth: number) => {
      const start = Lunar.fromYmd(ly, fromMonth, 1).getSolar().toYmd();
      const end = Lunar.fromYmd(ly, toMonth, LunarMonth.fromYm(ly, toMonth).getDayCount()).getSolar().toYmd();
      return { start, end };
    };
    if (key === 'year') {
      const start = Lunar.fromYmd(ly, 1, 1).getSolar().toYmd();
      const end = Lunar.fromYmd(ly, 12, LunarMonth.fromYm(ly, 12).getDayCount()).getSolar().toYmd();
      return { start, end };
    }
    if (key === 'month') return monthRange(ly, lm);
    if (key === 'q1') return quarter(1, 3);
    if (key === 'q2') return quarter(4, 6);
    if (key === 'q3') return quarter(7, 9);
    if (key === 'q4') return quarter(10, 12);
    // 明日到农历月底 / 农历年底（农历日历下月底=农历月末、年底=腊月末）
    if (key === 'tmom') return { start: fmtDate(tomorrow()), end: monthRange(ly, lm).end };
    return {
      start: fmtDate(tomorrow()),
      end: Lunar.fromYmd(ly, 12, LunarMonth.fromYm(ly, 12).getDayCount()).getSolar().toYmd(),
    };
  }

  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const monthRange = (year: number, month: number) => {
    const start = fmtDate(new Date(year, month - 1, 1));
    const end = fmtDate(new Date(year, month, 0));
    return { start, end };
  };
  const quarter = (fromMonth: number, toMonth: number) => {
    const start = fmtDate(new Date(y, fromMonth - 1, 1));
    const end = fmtDate(new Date(y, toMonth, 0));
    return { start, end };
  };
  if (key === 'year') return { start: `${y}-01-01`, end: `${y}-12-31` };
  if (key === 'month') return monthRange(y, m);
  if (key === 'q1') return quarter(1, 3);
  if (key === 'q2') return quarter(4, 6);
  if (key === 'q3') return quarter(7, 9);
  if (key === 'q4') return quarter(10, 12);
  // 明日到月底 / 年底 / 农历年底
  if (key === 'tmom') return { start: fmtDate(tomorrow()), end: monthRange(y, m).end };
  if (key === 'tye') return { start: fmtDate(tomorrow()), end: `${y}-12-31` };
  const lunar = Solar.fromDate(now).getLunar();
  const ly = lunar.getYear();
  const end = Lunar.fromYmd(ly, 12, LunarMonth.fromYm(ly, 12).getDayCount()).getSolar().toYmd();
  return { start: fmtDate(tomorrow()), end };
}

/** 类别列表（统计页饼图下方）：一行一个类别，可点击查看流水 */
function CategoryList({
  title,
  color,
  cats,
  total,
  onOpen,
}: {
  title: string;
  color: string;
  cats: { categoryId: string; name: string; type: string; icon: string | null; amount: number }[];
  total: number;
  onOpen: (c: { categoryId: string; name: string; type: string; icon: string | null }) => void;
}) {
  if (cats.length === 0) return null;
  return (
    <div style={{ background: 'var(--card)', borderRadius: 12, padding: 8, marginTop: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 14, padding: '4px 8px', color }}>{title}</div>
      {cats.map((c) => (
        <div
          key={c.categoryId}
          onClick={() => onOpen(c)}
          style={{ display: 'flex', alignItems: 'center', padding: '12px 8px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
        >
          <span style={{ fontSize: 20, marginRight: 8 }}>{c.icon || '💸'}</span>
          <span style={{ flex: 1, fontSize: 15 }}>{c.name}</span>
          <span style={{ fontSize: 13, color }}>¥{formatMoney(c.amount)}</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 6 }}>
            {total > 0 ? ((c.amount / total) * 100).toFixed(1) : '0.0'}%
          </span>
        </div>
      ))}
    </div>
  );
}

/** 当前历法下，某日期所在「月」的公历区间；offset 用于平移（-1 上一个月，+1 下一个月） */
function monthRangeOf(
  date: Date,
  calendar: 'solar' | 'lunar',
  offset = 0,
): { start: string; end: string } {
  if (calendar === 'solar') {
    const first = new Date(date.getFullYear(), date.getMonth() + offset, 1);
    const last = new Date(date.getFullYear(), date.getMonth() + offset + 1, 0);
    return { start: fmtDate(first), end: fmtDate(last) };
  }
  const lunar = Solar.fromDate(date).getLunar();
  const ym = LunarMonth.fromYm(lunar.getYear(), lunar.getMonth()).next(offset);
  const first = Lunar.fromYmd(ym.getYear(), ym.getMonth(), 1).getSolar();
  const last = Lunar.fromYmd(ym.getYear(), ym.getMonth(), ym.getDayCount()).getSolar();
  return { start: first.toYmd(), end: last.toYmd() };
}

export default function Stats() {
  const navigate = useNavigate();
  const pageRef = useRef<HTMLDivElement>(null);
  const categoryScrollRef = useRef<HTMLDivElement>(null);
  const isActive = useContext(TabActiveContext);
  const themeColor = useThemeStore((s) => s.themeColor);
  const darkMode = useThemeStore((s) => s.darkMode);
  const [calendar, setCalendar] = useState<'solar' | 'lunar'>('solar');
  const [showRangePicker, setShowRangePicker] = useState(false);

  usePopupBack(showRangePicker, () => setShowRangePicker(false));
  const [showLedgerPicker, setShowLedgerPicker] = useState(false);
  const [tempStart, setTempStart] = useState('');
  const [tempEnd, setTempEnd] = useState('');
  // 是否为自定义区间（false = 按当前历法的「月」导航）
  const [isCustom, setIsCustom] = useState(false);
  // 自定义区间周期语义（左右切换按对应周期推进）：month / quarter / year / all / range
  const [rangeMeta, setRangeMeta] = useState<{
    kind: 'month' | 'quarter' | 'year' | 'all' | 'range';
    y: number;
  }>({ kind: 'range', y: new Date().getFullYear() });
  // 快捷按钮选择时的待定周期（「确定」时写入 rangeMeta）
  const [pendingMeta, setPendingMeta] = useState<{
    kind: 'month' | 'quarter' | 'year' | 'all' | 'range';
    y: number;
  } | null>(null);
  const selectedIds = useStatLedgerSelection((s) => s.selectedIds);
  const deselectedIds = useStatLedgerSelection((s) => s.deselectedIds);
  const selectOne = useStatLedgerSelection((s) => s.selectOne);
  const setSelected = useStatLedgerSelection((s) => s.setSelected);

  // 统计日期范围（默认当前公历月）
  const [range, setRange] = useState(() => monthRangeOf(new Date(), 'solar'));

  // 柱状图聚合粒度：auto=按区间自动推断；或强制 日/月/年
  const [trendMode, setTrendMode] = useState<'auto' | 'day' | 'month' | 'year'>('auto');

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });

  // 账本选中切换（「空=全部」模型 + 哨兵「0个」）：
  // 全部→排除该项；0个→只选该项；部分→切换（移除后为空则 0 个）
  const handleToggle = (id: string) => {
    if (selectedIds.length === 0) {
      const rest = ledgers.map((l) => l.id).filter((x) => x !== id);
      setSelected(rest.length ? rest : [NONE_LEDGER_MARKER]);
    } else if (selectedIds[0] === NONE_LEDGER_MARKER) {
      setSelected([id]);
    } else if (selectedIds.includes(id)) {
      const rest = selectedIds.filter((x) => x !== id);
      setSelected(rest.length ? rest : [NONE_LEDGER_MARKER]);
    } else {
      setSelected([...selectedIds, id]);
    }
  };

  // 若没有选中任何账本，默认选中最近编辑的账本
  const latestLedger = useMemo(() => {
    if (ledgers.length === 0) return null;
    return [...ledgers].sort((a, b) => {
      const ta = a.updatedAt ?? a.createdAt ?? '';
      const tb = b.updatedAt ?? b.createdAt ?? '';
      return tb.localeCompare(ta);
    })[0];
  }, [ledgers]);

  // 仅首次（无持久化选择时）默认选中最近编辑的账本；之后允许空选（空选=统计全部账本）
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || !latestLedger) return;
    if (selectedIds.length === 0) {
      selectOne(latestLedger.id);
    }
    initializedRef.current = true;
  }, [latestLedger, selectedIds.length, selectOne]);

  const { data: summary } = useQuery({
    queryKey: ['stats', 'summary', selectedIds, calendar, range.start, range.end, trendMode],
    queryFn: async () => {
      const params: Record<string, string> = {
        calendar,
        startDate: range.start,
        endDate: range.end,
      };
      // 手动切换日/月/年 → 强制趋势粒度（后端 forcePeriod）
      if (trendMode !== 'auto') params.forcePeriod = trendMode;
      if (selectedIds.length) params.ledgerIds = selectedIds.join(',');
      return (await statApi.summary(params)).data as StatSummary;
    },
  });

  // 点开的类别（弹窗用）
  const [showCategoryTx, setShowCategoryTx] = useState(false);

  usePopupBack(showCategoryTx, () => setShowCategoryTx(false));
  const [activeCategory, setActiveCategory] = useState<{
    categoryId: string;
    name: string;
    type: string;
    icon: string | null;
  } | null>(null);

  const { data: categoryTxList = EMPTY_TX } = useQuery({
    queryKey: ['stats', 'category-transactions', activeCategory?.categoryId, range.start, range.end, selectedIds],
    queryFn: async () => {
      if (!activeCategory) return [];
      const params: Record<string, string> = {
        categoryId: activeCategory.categoryId,
        startDate: range.start,
        endDate: range.end,
      };
      if (selectedIds.length) params.ledgerIds = selectedIds.join(',');
      return (await statApi.categoryTransactions(params)).data as Transaction[];
    },
    enabled: !!activeCategory,
  });

  const [categoryKeyword, setCategoryKeyword] = useState('');
  // 搜索框是否聚焦（用于「有内容或聚焦时固定」）
  const [categorySearchFocused, setCategorySearchFocused] = useState(false);

  const filteredCategoryTx = useMemo(() => {
    const kw = categoryKeyword.trim();
    if (!kw) return categoryTxList;
    const isNum = /^\d+(\.\d+)?$/.test(kw);
    const num = isNum ? Number(kw) : null;
    return categoryTxList.filter((t) => {
      if (t.note?.includes(kw)) return true;
      if (t.category?.name?.includes(kw)) return true;
      if (num !== null && Number(t.amount) === num) return true;
      return false;
    });
  }, [categoryTxList, categoryKeyword]);

  // 可删除的流水（贷款/支出计划流水不可删，批量删除时排除）
  const deletableCategoryTx = useMemo(
    () => filteredCategoryTx.filter((t) => !t.loanId && !t.expensePlanId),
    [filteredCategoryTx],
  );

  const queryClient = useQueryClient();
  const showLedgerName = selectedIds.length !== 1;

  // 类别详情：批量选择 + 编辑 + 转移 + 批量改类别
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  // 长按批量选择模式
  const [batchMode, setBatchMode] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef<string | null>(null);

  // 类别流水「合计/笔数」：批量勾选非空 → 只统计勾选流水；否则搜索后的全部
  const categoryTotal = useMemo(
    () =>
      (batchMode && selectedTxIds.size > 0
        ? filteredCategoryTx.filter((t) => selectedTxIds.has(t.id))
        : filteredCategoryTx
      ).reduce((s, t) => s + Number(t.amount), 0),
    [filteredCategoryTx, batchMode, selectedTxIds],
  );
  const categoryCount = useMemo(
    () =>
      batchMode && selectedTxIds.size > 0
        ? filteredCategoryTx.filter((t) => selectedTxIds.has(t.id)).length
        : filteredCategoryTx.length,
    [filteredCategoryTx, batchMode, selectedTxIds],
  );

  // 固定元素「是否已固定」：固定时加底部阴影
  // 搜索框是否处于「固定」状态：有内容或光标聚焦
  const categorySearchActive = categoryKeyword.trim() !== '' || categorySearchFocused;
  const catStatsStuck = useStuck<HTMLDivElement>(0, () => categoryScrollRef.current);
  const catSearchStuck = useStuck<HTMLDivElement>(60, () => categoryScrollRef.current);
  const catBatchStuckSearch = useStuck<HTMLDivElement>(120, () => categoryScrollRef.current);
  const catBatchStuckBatch = useStuck<HTMLDivElement>(categorySearchActive ? 120 : 60, () => categoryScrollRef.current);

  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  usePopupBack(!!editingTx, () => setEditingTx(null));
  const [editForm, setEditForm] = useState({ type: 'expense', amount: '', note: '', categoryId: '' });
  // 编辑流水的类别选项（取该流水所属账本的类别）
  const { data: editCategories = [] } = useQuery({
    queryKey: ['categories', editingTx?.ledgerId],
    queryFn: async () => (await categoryApi.list(editingTx!.ledgerId)).data as Category[],
    enabled: !!editingTx?.ledgerId,
  });
  const [expandedCategoryDates, setExpandedCategoryDates] = useState<Set<string>>(new Set());
  // 转移流水
  const [transferTx, setTransferTx] = useState<Transaction | null>(null);
  // 批量修改（类别/转移/备注，仅单账本显示入口）
  const [batchModifyOpen, setBatchModifyOpen] = useState(false);
  const [batchModifyTxIds, setBatchModifyTxIds] = useState<string[]>([]);

  // 类别流水分组跨度跟随柱状图切换（auto 用后端推断的周期）
  const detailPeriod = trendMode === 'auto' ? summary?.period ?? 'day' : trendMode;
  const categoryGroups = useMemo(
    () => groupByKey(filteredCategoryTx, detailPeriod as 'day' | 'month' | 'year', calendar),
    [filteredCategoryTx, detailPeriod, calendar],
  );

  useEffect(() => {
    setExpandedCategoryDates(categoryGroups.length > 0 ? new Set([categoryGroups[0][0]]) : new Set());
  }, [categoryGroups]);

  const toggleCategoryDate = (date: string) => {
    setExpandedCategoryDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const refreshCategoryTx = () => {
    queryClient.invalidateQueries({ queryKey: ['stats', 'category-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['stats', 'summary'] });
    // 流水增删改/改类别后，分类流水数（_count.transactions）也会变
    queryClient.invalidateQueries({ queryKey: ['categories'] });
  };

  const handleCopyTx = async (t: Transaction) => {
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
      refreshCategoryTx();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '复制失败' });
    }
  };

  const handleDeleteTx = async (t: Transaction) => {
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
      // 若该条在批量删除勾选集中，同步移出，避免「删除选中」再提交已删 id
      setSelectedTxIds((prev) => {
        const next = new Set(prev);
        next.delete(t.id);
        return next;
      });
      refreshCategoryTx();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '删除失败' });
    }
  };

  const toggleSelectTx = (id: string) => {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 长按进入批量选择模式（选中被长按的流水）
  const startLongPress = (t: Transaction) => {
    if (!!t.loanId || !!t.expensePlanId) return;
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      suppressClick.current = t.id;
      setBatchMode(true);
      setSelectedTxIds((prev) => {
        const next = new Set(prev);
        next.add(t.id);
        return next;
      });
    }, 500);
  };
  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const exitBatchMode = () => {
    setBatchMode(false);
    setSelectedTxIds(new Set());
  };
  // 行点击：长按后抑制本次 click；批量模式点击=选中/取消；否则打开编辑
  const handleRowClickTx = (t: Transaction) => {
    if (suppressClick.current === t.id) {
      suppressClick.current = null;
      return;
    }
    if (batchMode) {
      toggleSelectTx(t.id);
      return;
    }
    if (!t.loanId && !t.expensePlanId) openEditTx(t);
  };
  const longPressProps = (t: Transaction) => ({
    onTouchStart: () => startLongPress(t),
    onTouchEnd: clearLongPress,
    onTouchMove: clearLongPress,
    onMouseDown: () => startLongPress(t),
    onMouseUp: clearLongPress,
    onMouseLeave: clearLongPress,
  });

  const toggleSelectAllTx = () => {
    if (selectedTxIds.size === deletableCategoryTx.length) {
      setSelectedTxIds(new Set());
    } else {
      setSelectedTxIds(new Set(deletableCategoryTx.map((t) => t.id)));
    }
  };

  const handleBatchDeleteTx = async () => {
    if (selectedTxIds.size === 0) return;
    const ok = await new Promise((resolve) => {
      Dialog.confirm({
        content: `删除选中的 ${selectedTxIds.size} 条流水？`,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      await transactionApi.removeMany([...selectedTxIds]);
      Toast.show({ content: '已删除' });
      setSelectedTxIds(new Set());
      refreshCategoryTx();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '删除失败' });
    }
  };

  const openEditTx = (t: Transaction) => {
    setEditingTx(t);
    setEditForm({ type: t.type, amount: t.amount, note: t.note ?? '', categoryId: t.categoryId ?? '' });
  };

  // 批量修改（类别/转移/备注）：仅单账本（selectedIds 恰好 1 个账本）时可用；按当前类别类型过滤
  const openBatchModifyTx = () => {
    if (selectedTxIds.size === 0) return;
    const targets = filteredCategoryTx.filter(
      (t) =>
        selectedTxIds.has(t.id) && !t.loanId && !t.expensePlanId && t.type === activeCategory?.type,
    );
    if (!targets.length) {
      Toast.show({ content: '所选流水不支持修改（贷款/支出计划流水除外）' });
      return;
    }
    setBatchModifyTxIds(targets.map((t) => t.id));
    setBatchModifyOpen(true);
  };

  const saveEditTx = async () => {
    if (!editingTx) return;
    try {
      await transactionApi.update(editingTx.id, {
        type: editForm.type,
        amount: Number(editForm.amount),
        note: editForm.note || undefined,
        categoryId: editForm.categoryId || undefined,
      });
      Toast.show({ content: '已保存' });
      setEditingTx(null);
      refreshCategoryTx();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '保存失败' });
    }
  };

  const openCategory = (c: { categoryId: string; name: string; type: string; icon: string | null }) => {
    setActiveCategory(c);
    setShowCategoryTx(true);
  };

  // 左右箭头：整月/整季/整年区间按日历周期推进；普通自定义整体平移；「所有」不推进
  const shift = (delta: number) => {
    setRange((prev) => {
      if (!isCustom) {
        return monthRangeOf(parseDate(prev.start), calendar, delta);
      }
      if (rangeMeta.kind === 'month') {
        return monthRangeOf(parseDate(prev.start), calendar, delta);
      }
      if (rangeMeta.kind === 'quarter') {
        const s = parseDate(prev.start);
        const totalQ = s.getFullYear() * 4 + Math.floor(s.getMonth() / 3) + delta;
        const y2 = Math.floor(totalQ / 4);
        const q2 = totalQ % 4;
        return {
          start: fmtDate(new Date(y2, q2 * 3, 1)),
          end: fmtDate(new Date(y2, (q2 + 1) * 3, 0)),
        };
      }
      if (rangeMeta.kind === 'year') {
        // 农历历法下按农历年推进（正月首日~腊月末）
        if (calendar === 'lunar') {
          const ly = Solar.fromDate(parseDate(prev.start)).getLunar().getYear();
          return lunarYearSpan(ly + delta);
        }
        const y = parseDate(prev.start).getFullYear() + delta;
        return { start: fmtDate(new Date(y, 0, 1)), end: fmtDate(new Date(y, 11, 31)) };
      }
      if (rangeMeta.kind === 'all') {
        return prev; // 「所有」不前后推进
      }
      const start = parseDate(prev.start);
      const end = parseDate(prev.end);
      const duration = end.getTime() - start.getTime() + 86400000;
      return {
        start: fmtDate(new Date(start.getTime() + delta * duration)),
        end: fmtDate(new Date(end.getTime() + delta * duration)),
      };
    });
  };

  // 切换公历/农历：把当前「月」换算到新历法；自定义区间则重置为当前月
  const toggleCalendar = () => {
    const next = calendar === 'solar' ? 'lunar' : 'solar';
    setCalendar(next);
    if (isCustom) {
      setRange(monthRangeOf(new Date(), next));
      setIsCustom(false);
    } else {
      setRange(monthRangeOf(parseDate(range.start), next));
    }
  };

  const openRangePicker = () => {
    setTempStart(range.start);
    setTempEnd(range.end);
    setShowRangePicker(true);
  };

  const confirmRange = () => {
    if (tempStart && tempEnd) {
      // 若起止颠倒，自动交换
      const a = parseDate(tempStart);
      const b = parseDate(tempEnd);
      setRange(a <= b ? { start: tempStart, end: tempEnd } : { start: tempEnd, end: tempStart });
      setIsCustom(true);
      // 写入快捷按钮的周期语义（未选快捷 = 普通自定义区间）
      setRangeMeta({
        kind: pendingMeta?.kind ?? 'range',
        y: pendingMeta?.y ?? new Date().getFullYear(),
      });
      setPendingMeta(null);
    }
    setShowRangePicker(false);
  };

  // 快捷区间按钮：只填入起止日期，用户点「确定」后生效；同时记录周期语义供左右切换
  const applyQuickRange = (key: QuickRangeKey) => {
    const now = new Date();
    let r: { start: string; end: string };
    let kind: 'month' | 'quarter' | 'year' | 'all' | 'range' = 'range';

    if (key === 'all') {
      r = { start: '1900-01-01', end: '2099-12-31' };
      kind = 'all';
    } else if (key === 'cq') {
      // 农历历法下「本季」按农历季（与 Q1~Q4 一致：正月~三月 / 四月~六月 / 七月~九月 / 十月~腊月）
      if (calendar === 'lunar') {
        const lunar = Solar.fromDate(now).getLunar();
        const q = Math.floor((Math.abs(lunar.getMonth()) - 1) / 3);
        const from = q * 3 + 1;
        const to = q * 3 + 3;
        const endDay = LunarMonth.fromYm(lunar.getYear(), to).getDayCount();
        r = {
          start: Lunar.fromYmd(lunar.getYear(), from, 1).getSolar().toYmd(),
          end: Lunar.fromYmd(lunar.getYear(), to, endDay).getSolar().toYmd(),
        };
      } else {
        r = solarQuarterSpan(now);
      }
      kind = 'quarter';
    } else if (key === 'ny') {
      if (calendar === 'lunar') {
        r = lunarYearSpan(Solar.fromDate(now).getLunar().getYear() + 1);
      } else {
        r = solarYearSpan(now.getFullYear() + 1);
      }
      kind = 'year';
    } else if (/^mo\d+$/.test(key)) {
      const n = Number(key.slice(2));
      if (calendar === 'lunar') {
        r = lunarMonthSpan(Solar.fromDate(now).getLunar().getYear(), n);
      } else {
        r = solarMonthSpan(now.getFullYear(), n);
      }
      kind = 'month';
    } else {
      // else 分支必然落在原有 9 键（TS 无法自动收窄，显式断言）
      r = quickRange(
        key as 'year' | 'month' | 'q1' | 'q2' | 'q3' | 'q4' | 'tmom' | 'tye' | 'tlye',
        calendar,
      );
      if (key === 'year') kind = 'year';
      else if (key === 'month') kind = 'month';
      else if (key.startsWith('q')) kind = 'quarter';
      else kind = 'range';
    }

    setTempStart(r.start);
    setTempEnd(r.end);
    // 快捷按钮直接生效：立即应用区间 + 周期语义（供左右切换按周期推进 / 农历标识显示），
    // 不再需要再点「确定」；手选起止日期仍走 confirmRange
    setRange(r);
    setIsCustom(true);
    setRangeMeta({ kind, y: now.getFullYear() });
    setPendingMeta(null);
    setShowRangePicker(false);
  };

  // 行内队列顺序：选中（按选中顺序）→ 最近取消选中（最新在前）→ 其余（原顺序）
  const orderedLedgers = useMemo(() => {
    const byId = new Map(ledgers.map((l) => [l.id, l] as const));
    const seen = new Set<string>();
    const result: Ledger[] = [];
    const push = (id: string) => {
      if (seen.has(id)) return;
      const l = byId.get(id);
      if (l) {
        result.push(l);
        seen.add(id);
      }
    };
    selectedIds.forEach(push);
    deselectedIds.forEach(push);
    ledgers.forEach((l) => push(l.id));
    return result;
  }, [ledgers, selectedIds, deselectedIds]);

  const pieOption = useMemo(() => {
    const expenseCats = (summary?.byCategory ?? []).filter((c) => c.type === 'expense');
    const total = expenseCats.reduce((s, c) => s + c.amount, 0);
    return {
      tooltip: { trigger: 'item' as const },
      legend: { bottom: 0, type: 'scroll' as const },
      title: {
        text: `支出构成 ¥${formatMoney(total)}`,
        left: 'center',
        top: 0,
        textStyle: { fontSize: 13, color: cssVar('--text') },
      },
      series: [
        {
          type: 'pie' as const,
          radius: ['38%', '62%'],
          center: ['50%', '55%'],
          data: expenseCats.map((c) => ({ name: c.name, value: c.amount })),
          label: { formatter: '{b}: {d}%' },
        },
      ],
    };
  }, [summary, themeColor, darkMode]);

  const lunarRangeText = useMemo(() => {
    /** 农历日期 → yyyy-mm-dd（闰月月位用 r 前缀，避免与平月混淆） */
    const lunarYmd = (l: any) => {
      const m = l.getMonth();
      const mm = String(Math.abs(m)).padStart(2, '0');
      const dd = String(l.getDay()).padStart(2, '0');
      return m < 0 ? `${l.getYear()}-r${mm}-${dd}` : `${l.getYear()}-${mm}-${dd}`;
    };
    const s = lunarYmd(Solar.fromDate(parseDate(range.start)).getLunar());
    const e = lunarYmd(Solar.fromDate(parseDate(range.end)).getLunar());
    return `（${s} ~ ${e}）`;
  }, [range.start, range.end]);

  const trendOption = useMemo(() => {
    const trend = summary?.trend ?? [];
    const moneyLabel = {
      show: true,
      position: 'top' as const,
      fontSize: 9,
      color: 'var(--text-muted)',
      formatter: (p: any) => (p.value ? `¥${formatMoney(Number(p.value))}` : ''),
    };
    return {
      tooltip: { trigger: 'axis' as const },
      legend: { bottom: 0 },
      grid: { left: 40, right: 16, top: 28, bottom: 40 },
      xAxis: { type: 'category' as const, data: trend.map((t) => shortAxisKey(t.key, summary?.period ?? 'month')) },
      yAxis: { type: 'value' as const },
      series: [
        { name: '收入', type: 'bar' as const, data: trend.map((t) => t.income), itemStyle: { color: cssVar('--income') }, label: moneyLabel },
        { name: '支出', type: 'bar' as const, data: trend.map((t) => t.expense), itemStyle: { color: cssVar('--expense') }, label: moneyLabel },
      ],
    };
  }, [summary, themeColor, darkMode]);

  return (
    <div className="page" ref={pageRef}>
      <NavBar
        back={null}
        style={{ background: 'var(--card)' }}
        right={
          <span
            style={{ fontSize: 14, color: 'var(--primary)' }}
            onClick={toggleCalendar}
          >
            {calendar === 'lunar' ? '农历' : '公历'}
          </span>
        }
      >
        统计
      </NavBar>

      <div style={{ padding: 16 }}>
        {/* 日期范围（左右平移 + 点击中间设置起止） */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--card)',
            borderRadius: 12,
            padding: '10px 16px',
            marginBottom: 12,
          }}
        >
          <div onClick={() => shift(-1)} style={{ padding: '4px 8px', cursor: 'pointer' }}>
            <LeftOutline />
          </div>
          <div onClick={openRangePicker} style={{ fontWeight: 700, fontSize: 15, cursor: 'pointer', textAlign: 'center' }}>
            <div>{range.start} ~ {range.end}</div>
            {/* 周期文字下方：公历对应的农历日期 */}
            <div style={{ fontSize: 12, color: 'var(--purple)', marginTop: 2 }}>{lunarRangeText}</div>
          </div>
          <div onClick={() => shift(1)} style={{ padding: '4px 8px', cursor: 'pointer' }}>
            <RightOutline />
          </div>
        </div>

        {/* 账本选择（折叠显示，点开弹窗多选） */}
        <div
          style={{
            background: 'var(--card)',
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
          onClick={() => setShowLedgerPicker(true)}
        >
          <div className="hide-scrollbar" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <span className="text-secondary" style={{ fontSize: 13, flexShrink: 0 }}>账本</span>
            {orderedLedgers.map((l) => {
              const selected = selectedIds.length === 0 || selectedIds.includes(l.id);
              return (
                <span
                  key={l.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggle(l.id);
                  }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 12,
                    background: selected ? 'var(--primary-weak)' : 'var(--fill)',
                    color: selected ? 'var(--primary)' : 'var(--text-muted)',
                    fontSize: 13,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                >
                  {l.name}
                </span>
              );
            })}
          </div>
          <span style={{ fontSize: 13, color: 'var(--primary)' }}>选择</span>
        </div>

        {/* 收支总览：金额过大时整体横向滑动查看（隐藏滚动条） */}
        <div className="hide-scrollbar" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { label: '收入', value: summary?.totalIncome ?? 0, color: 'var(--income)' },
              { label: '支出', value: summary?.totalExpense ?? 0, color: 'var(--expense)' },
              { label: '盈余', value: summary?.surplus ?? 0, color: 'var(--primary)' },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  flexGrow: 1,
                  flexShrink: 0,
                  flexBasis: 'auto',
                  minWidth: 120,
                  background: 'var(--card)',
                  borderRadius: 12,
                  padding: 12,
                  textAlign: 'center',
                }}
              >
                <div className="text-secondary" style={{ fontSize: 12 }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: s.color, whiteSpace: 'nowrap' }}>
                  ¥{formatMoney(s.value)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: 'var(--card)', borderRadius: 12, padding: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4, gap: 4 }}>
            {([
              ['auto', '自动'],
              ['day', '按日'],
              ['month', '按月'],
              ['year', '按年'],
            ] as const).map(([k, label]) => (
              <Button
                key={k}
                size="mini"
                color={trendMode === k ? 'primary' : 'default'}
                onClick={() => setTrendMode(k)}
              >
                {label}
              </Button>
            ))}
          </div>
          <Chart option={trendOption} height={240} />
        </div>

        <div style={{ background: 'var(--card)', borderRadius: 12, padding: 8 }}>
          <Chart option={pieOption} height={280} />
        </div>

        <CategoryList
          title="收入类别"
          color="var(--income)"
          cats={(summary?.byCategory ?? []).filter((c) => c.type === 'income')}
          total={summary?.totalIncome ?? 0}
          onOpen={openCategory}
        />
        <CategoryList
          title="支出类别"
          color="var(--expense)"
          cats={(summary?.byCategory ?? []).filter((c) => c.type === 'expense')}
          total={summary?.totalExpense ?? 0}
          onOpen={openCategory}
        />
      </div>

      {/* 自定义日期范围弹窗 */}
      <Popup
        visible={showRangePicker}
        onMaskClick={() => setShowRangePicker(false)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>设置统计区间</h3>

          {/* 所有：覆盖全部时间 */}
          <div style={{ marginBottom: 12 }}>
            <Button size="mini" color="primary" fill="outline" onClick={() => applyQuickRange(QUICK_ALL.key)}>
              {QUICK_ALL.label}
            </Button>
          </div>

          {QUICK_GROUPS.map((g) => (
            <div key={g.title} style={{ marginBottom: 10 }}>
              <div className="text-secondary" style={{ fontSize: 12, marginBottom: 4 }}>{g.title}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {g.buttons.map((b) => (
                  <Button key={b.key} size="mini" fill="outline" onClick={() => applyQuickRange(b.key)}>
                    {b.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}

          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>起始日期</div>
            <DatePicker
              precision="day"
              value={tempStart ? parseDate(tempStart) : new Date()}
              onConfirm={(v) => setTempStart(fmtDate(v))}
            >
              {(value, actions) => (
                <div
                  onClick={() => actions.open()}
                  style={{ background: 'var(--fill)', borderRadius: 8, padding: '10px 12px' }}
                >
                  {value ? fmtDate(value) : '选择日期'}
                </div>
              )}
            </DatePicker>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>结束日期</div>
            <DatePicker
              precision="day"
              value={tempEnd ? parseDate(tempEnd) : new Date()}
              onConfirm={(v) => setTempEnd(fmtDate(v))}
            >
              {(value, actions) => (
                <div
                  onClick={() => actions.open()}
                  style={{ background: 'var(--fill)', borderRadius: 8, padding: '10px 12px' }}
                >
                  {value ? fmtDate(value) : '选择日期'}
                </div>
              )}
            </DatePicker>
          </div>
          <Button block color="primary" onClick={confirmRange}>确定</Button>
        </div>
      </Popup>

      <LedgerSelectPopup
        visible={showLedgerPicker}
        onClose={() => setShowLedgerPicker(false)}
        ledgers={ledgers}
        selectedIds={selectedIds}
        onToggle={handleToggle}
        onSelectAll={() => setSelected([])}
        onSelectNone={() => setSelected([NONE_LEDGER_MARKER])}
        getContainer={() => pageRef.current ?? document.body}
      />

      {/* 类别流水弹窗 */}
      <Popup
        visible={showCategoryTx}
        onMaskClick={() => setShowCategoryTx(false)}
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div ref={categoryScrollRef} style={{ padding: 16, maxHeight: '85vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 16 }}>
              {activeCategory?.icon} {activeCategory?.name} 流水
            </span>
            <span onClick={() => setShowCategoryTx(false)} style={{ fontSize: 22, color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1 }}>
              ×
            </span>
          </div>

          <div ref={catStatsStuck.ref} style={{ display: 'flex', gap: 8, marginBottom: 12, position: 'sticky', top: 0, background: 'var(--card)', zIndex: 40, paddingTop: 4, boxShadow: catStatsStuck.stuck ? '0 2px 8px rgba(0,0,0,.08)' : undefined }}>
            <div style={{ flex: 1, background: 'var(--fill)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
              <div className="text-secondary" style={{ fontSize: 11 }}>合计</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: activeCategory?.type === 'income' ? 'var(--income)' : 'var(--expense)' }}>
                ¥{formatMoney(categoryTotal)}
              </div>
            </div>
            <div style={{ flex: 1, background: 'var(--fill)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
              <div className="text-secondary" style={{ fontSize: 11 }}>笔数</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{categoryCount} 笔</div>
            </div>
          </div>

          <div ref={catSearchStuck.ref} style={{ display: 'flex', alignItems: 'center', gap: 8, position: categorySearchActive ? 'sticky' : 'static', top: categorySearchActive ? 60 : undefined, background: 'var(--card)', zIndex: 40, borderRadius: 12, padding: '8px 12px', marginBottom: 8, boxShadow: catSearchStuck.stuck ? '0 2px 8px rgba(0,0,0,.08)' : undefined }}>
            <SearchBar
              placeholder="搜索备注、类别或金额"
              value={categoryKeyword}
              onChange={setCategoryKeyword}
              onClear={() => setCategoryKeyword('')}
              onFocus={() => setCategorySearchFocused(true)}
              onBlur={() => setCategorySearchFocused(false)}
              style={{ '--background': 'var(--fill)', '--border-radius': '8px', flex: 1 }}
            />
          </div>

          {categoryKeyword.trim() !== '' ? (
            <div>
              <div ref={catBatchStuckSearch.ref} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, position: 'sticky', top: 120, background: 'var(--card)', zIndex: 40, boxShadow: catBatchStuckSearch.stuck ? '0 2px 8px rgba(0,0,0,.08)' : undefined }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>已选 {selectedTxIds.size} 条</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button size="mini" fill="outline" onClick={toggleSelectAllTx}>
                    {selectedTxIds.size === deletableCategoryTx.length ? '取消全选' : '全选'}
                  </Button>
                  {selectedIds.length === 1 && (
                    <Button size="mini" fill="outline" onClick={openBatchModifyTx} disabled={selectedTxIds.size === 0}>
                      修改
                    </Button>
                  )}
                  <Button size="mini" color="danger" onClick={handleBatchDeleteTx} disabled={selectedTxIds.size === 0}>
                    删除选中
                  </Button>
                  {batchMode && (
                    <Button size="mini" onClick={exitBatchMode}>取消</Button>
                  )}
                </div>
              </div>
              {filteredCategoryTx.map((t) => {
                const isLoanTx = !!t.loanId;
                const isLockedTx = isLoanTx || !!t.expensePlanId; // 贷款/支出计划流水不可编辑、不可批量
                const content = (
                  <div
                    onClick={() => handleRowClickTx(t)}
                    {...longPressProps(t)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '10px 12px',
                      borderRadius: 12,
                      background: isLockedTx ? 'var(--row)' : 'var(--card)',
                      cursor: isLockedTx ? 'default' : 'pointer',
                    }}
                  >
                    {!isLockedTx ? (
                      <input
                        type="checkbox"
                        checked={selectedTxIds.has(t.id)}
                        onChange={() => toggleSelectTx(t.id)}
                        // 停止冒泡，避免勾选操作同时触发行点击打开编辑
                        onClick={(e) => e.stopPropagation()}
                        style={{ marginRight: 10, width: 18, height: 18, flexShrink: 0 }}
                      />
                    ) : (
                      <span style={{ marginRight: 10, width: 18, flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: 22, marginRight: 10 }}>{t.category?.icon || (t.type === 'expense' ? '💸' : t.type === 'income' ? '💰' : '🔄')}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15 }}>{t.category?.name ?? (t.type === 'transfer' ? '转账' : '未分类')}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        <span style={{ color: isLoanTx ? '#ff8f1f' : '#ffa94d' }}>{formatDateTime(new Date(t.occurredAt))}</span>
                        {t.note && <ExpandableNote text={t.note} />}
                        {isLoanTx && (
                          <span onClick={(e) => { e.stopPropagation(); navigate(`/loans/${t.loanId}`); }} style={{ marginLeft: 6, color: 'var(--primary)', cursor: 'pointer' }}>〔{t.loan?.name ?? '贷款'}〕</span>
                        )}
                        {showLedgerName && t.ledger?.name && <span style={{ marginLeft: 6, color: '#ff8f1f' }}>〔{t.ledger.name}〕</span>}
                      </div>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: t.type === 'income' ? 'var(--income)' : 'var(--expense)' }}>{t.type === 'income' ? '+' : '-'}¥{formatMoney(t.amount)}</span>
                  </div>
                );
                return (
                  <div key={t.id} style={{ marginBottom: 8 }}>
                    <SwipeAction
                      rightActions={
                        isLockedTx
                          ? [{ key: 'copy', text: '复制', color: 'primary', onClick: () => handleCopyTx(t) }]
                          : [
                              { key: 'transfer', text: '转移', color: 'warning', onClick: () => setTransferTx(t) },
                              { key: 'copy', text: '复制', color: 'primary', onClick: () => handleCopyTx(t) },
                              { key: 'delete', text: '删除', color: 'danger', onClick: () => handleDeleteTx(t) },
                            ]
                      }
                    >
                      {content}
                    </SwipeAction>
                  </div>
                );
              })}
              {filteredCategoryTx.length === 0 && (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>无搜索结果</div>
              )}
            </div>
          ) : (
            <div>
              {batchMode && (
                <div ref={catBatchStuckBatch.ref} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, position: 'sticky', top: categorySearchActive ? 120 : 60, background: 'var(--card)', zIndex: 40, boxShadow: catBatchStuckBatch.stuck ? '0 2px 8px rgba(0,0,0,.08)' : undefined }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>已选 {selectedTxIds.size} 条</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button size="mini" fill="outline" onClick={toggleSelectAllTx}>
                      {selectedTxIds.size === deletableCategoryTx.length ? '取消全选' : '全选'}
                    </Button>
                    {selectedIds.length === 1 && (
                      <Button size="mini" fill="outline" onClick={openBatchModifyTx} disabled={selectedTxIds.size === 0}>修改</Button>
                    )}
                    <Button size="mini" color="danger" onClick={handleBatchDeleteTx} disabled={selectedTxIds.size === 0}>删除选中</Button>
                    <Button size="mini" onClick={exitBatchMode}>取消</Button>
                  </div>
                </div>
              )}
              {categoryGroups.map(([date, items]) => {
                const dayIncome = items.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
                const dayExpense = items.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
                const isExpanded = expandedCategoryDates.has(date);
                return (
                  <div key={date} style={{ background: 'var(--card)', marginBottom: 8, borderRadius: 12, overflow: 'hidden' }}>
                    <div onClick={() => toggleCategoryDate(date)} style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: isExpanded ? '1px solid var(--border)' : 'none' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#bbb', fontSize: 12, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>▶</span>
                        <span>{date}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{items.length} 笔</span>
                      </span>
                      <span>
                        {dayExpense > 0 && <span style={{ color: 'var(--text-muted)' }}>支 ¥{formatMoney(dayExpense)} </span>}
                        {dayIncome > 0 && <span style={{ color: 'var(--text-muted)' }}>收 ¥{formatMoney(dayIncome)}</span>}
                      </span>
                    </div>
                    {isExpanded && items.map((t) => {
                      const isLoanTx = !!t.loanId;
                      const isLockedTx = isLoanTx || !!t.expensePlanId; // 贷款/支出计划流水不可编辑
                      const content = (
                        <div
                          key={t.id}
                          onClick={() => handleRowClickTx(t)}
                          {...longPressProps(t)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '10px 12px',
                            borderBottom: '1px solid var(--border)',
                            background: isLockedTx ? 'var(--row)' : 'var(--card)',
                            cursor: isLockedTx ? 'default' : 'pointer',
                          }}
                        >
                          {batchMode && !isLockedTx && (
                            <input
                              type="checkbox"
                              checked={selectedTxIds.has(t.id)}
                              onChange={() => toggleSelectTx(t.id)}
                              onClick={(e) => e.stopPropagation()}
                              style={{ marginRight: 10, width: 18, height: 18, flexShrink: 0 }}
                            />
                          )}
                          {batchMode && isLockedTx && <span style={{ marginRight: 10, width: 18, flexShrink: 0 }} />}
                          <span style={{ fontSize: 22, marginRight: 10 }}>{t.category?.icon || (t.type === 'expense' ? '💸' : t.type === 'income' ? '💰' : '🔄')}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15 }}>{t.category?.name ?? (t.type === 'transfer' ? '转账' : '未分类')}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                              <span style={{ color: isLoanTx ? '#ff8f1f' : '#ffa94d' }}>{formatDateTime(new Date(t.occurredAt))}</span>
                              {t.note && <ExpandableNote text={t.note} />}
                              {isLoanTx && (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/loans/${t.loanId}`);
                                  }}
                                  style={{ marginLeft: 6, color: 'var(--primary)', cursor: 'pointer' }}
                                >
                                  〔{t.loan?.name ?? '贷款'}〕
                                </span>
                              )}
                              {showLedgerName && t.ledger?.name && <span style={{ marginLeft: 6, color: '#ff8f1f' }}>〔{t.ledger.name}〕</span>}
                            </div>
                          </div>
                          <span style={{ fontSize: 14, fontWeight: 600, color: t.type === 'income' ? 'var(--income)' : 'var(--expense)' }}>{t.type === 'income' ? '+' : '-'}¥{formatMoney(t.amount)}</span>
                        </div>
                      );
                      return (
                        <SwipeAction
                          key={t.id}
                          rightActions={
                            isLockedTx
                              ? [{ key: 'copy', text: '复制', color: 'primary', onClick: () => handleCopyTx(t) }]
                              : [
                                  { key: 'transfer', text: '转移', color: 'warning', onClick: () => setTransferTx(t) },
                                  { key: 'copy', text: '复制', color: 'primary', onClick: () => handleCopyTx(t) },
                                  { key: 'delete', text: '删除', color: 'danger', onClick: () => handleDeleteTx(t) },
                                ]
                          }
                        >
                          {content}
                        </SwipeAction>
                      );
                    })}
                  </div>
                );
              })}
              {filteredCategoryTx.length === 0 && (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>该类别暂无流水</div>
              )}
            </div>
          )}
        </div>
      </Popup>

      {/* 批量修改弹窗（类别/转移/备注，仅单账本） */}
      <BatchModifyPopup
        visible={batchModifyOpen}
        onClose={() => setBatchModifyOpen(false)}
        ledgerId={selectedIds.length === 1 ? selectedIds[0] : ''}
        txIds={batchModifyTxIds}
        txType={(activeCategory?.type as 'expense' | 'income' | 'transfer' | null | undefined) ?? null}
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
        onChanged={() => {
          setSelectedTxIds(new Set());
          refreshCategoryTx();
        }}
      />

      {/* 转移流水弹窗 */}
      <TransferLedgerPopup
        visible={!!transferTx}
        txId={transferTx?.id ?? ''}
        currentLedgerId={transferTx?.ledgerId ?? ''}
        txType={(transferTx?.type as 'expense' | 'income' | 'transfer') ?? 'expense'}
        getContainer={() => pageRef.current ?? document.body}
        onClose={() => setTransferTx(null)}
      />

      {/* 编辑流水弹窗 */}
      <Popup
        visible={!!editingTx}
        onMaskClick={() => setEditingTx(null)}
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>编辑流水</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[
              { key: 'expense', label: '支出', color: 'var(--expense)' },
              { key: 'income', label: '收入', color: 'var(--income)' },
              { key: 'transfer', label: '转账', color: '#1677ff' },
            ].map((x) => (
              <div
                key={x.key}
                onClick={() => setEditForm((f) => ({ ...f, type: x.key }))}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '8px 0',
                  borderRadius: 8,
                  background: editForm.type === x.key ? x.color : 'var(--fill)',
                  color: editForm.type === x.key ? '#fff' : 'var(--text-secondary)',
                  fontWeight: editForm.type === x.key ? 600 : 400,
                }}
              >
                {x.label}
              </div>
            ))}
          </div>
          {editForm.type !== 'transfer' && (
            <div style={{ marginBottom: 12 }}>
              <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>类别</div>
              <Picker
                columns={[
                  editCategories
                    .filter((c) => c.type === editForm.type)
                    .map((c) => ({ label: c.name, value: c.id })),
                ]}
                value={editForm.categoryId ? [editForm.categoryId] : []}
                onConfirm={(v) => setEditForm((f) => ({ ...f, categoryId: String(v[0]) }))}
              >
                {(items, actions) => (
                  <div onClick={() => actions.open()} style={{ background: 'var(--fill)', borderRadius: 8, padding: '10px 12px' }}>
                    {items[0]?.label ?? '选择类别'}
                  </div>
                )}
              </Picker>
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>金额</div>
            <Input type="number" value={editForm.amount} onChange={(v) => setEditForm((f) => ({ ...f, amount: v }))} style={{ fontSize: 24 }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>备注</div>
            <TextArea placeholder="可选" value={editForm.note} onChange={(v) => setEditForm((f) => ({ ...f, note: v }))} maxLength={191} autoSize={{ minRows: 2 }} />
          </div>
          <Button block color="primary" onClick={saveEditTx}>保存</Button>
        </div>
      </Popup>
    </div>
  );
}
