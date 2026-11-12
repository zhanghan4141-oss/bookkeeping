import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, DatePicker, NavBar, Popup, SearchBar } from 'antd-mobile';
import { LeftOutline, RightOutline } from 'antd-mobile-icons';
import { Lunar, LunarMonth, Solar } from 'lunar-javascript';
import { statApi } from '../api/misc';
import { ledgerApi } from '../api/ledger';
import Chart from '../components/Chart';
import LedgerSelectPopup from '../components/LedgerSelectPopup';
import TransactionDayList from '../components/TransactionDayList';
import { useLedgerSelectionStore } from '../stores/ledgerSelection';
import type { Ledger, StatSummary, Transaction } from '../types';
import { formatMoney } from '../lib/format';

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

/** 快捷区间：当年 / 当月 / 四个季度，跟随当前历法（公历/农历） */
function quickRange(
  key: 'year' | 'month' | 'q1' | 'q2' | 'q3' | 'q4',
  calendar: 'solar' | 'lunar',
): { start: string; end: string } {
  const now = new Date();

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
    return quarter(10, 12);
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
  return quarter(10, 12);
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
    <div style={{ background: '#fff', borderRadius: 12, padding: 8, marginTop: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 14, padding: '4px 8px', color }}>{title}</div>
      {cats.map((c) => (
        <div
          key={c.categoryId}
          onClick={() => onOpen(c)}
          style={{ display: 'flex', alignItems: 'center', padding: '12px 8px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}
        >
          <span style={{ fontSize: 20, marginRight: 8 }}>{c.icon || '💸'}</span>
          <span style={{ flex: 1, fontSize: 15 }}>{c.name}</span>
          <span style={{ fontSize: 13, color }}>¥{formatMoney(c.amount)}</span>
          <span style={{ fontSize: 13, color: '#999', marginLeft: 6 }}>
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
  const [calendar, setCalendar] = useState<'solar' | 'lunar'>('solar');
  const [showRangePicker, setShowRangePicker] = useState(false);
  const [showLedgerPicker, setShowLedgerPicker] = useState(false);
  const [tempStart, setTempStart] = useState('');
  const [tempEnd, setTempEnd] = useState('');
  // 是否为自定义区间（false = 按当前历法的「月」导航）
  const [isCustom, setIsCustom] = useState(false);
  const selectedIds = useLedgerSelectionStore((s) => s.selectedIds);
  const deselectedIds = useLedgerSelectionStore((s) => s.deselectedIds);
  const selectOne = useLedgerSelectionStore((s) => s.selectOne);
  const toggle = useLedgerSelectionStore((s) => s.toggle);

  // 统计日期范围（默认当前公历月）
  const [range, setRange] = useState(() => monthRangeOf(new Date(), 'solar'));

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });

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
    queryKey: ['stats', 'summary', selectedIds, calendar, range.start, range.end],
    queryFn: async () => {
      const params: Record<string, string> = {
        calendar,
        startDate: range.start,
        endDate: range.end,
      };
      if (selectedIds.length) params.ledgerIds = selectedIds.join(',');
      return (await statApi.summary(params)).data as StatSummary;
    },
  });

  // 点开的类别（弹窗用）
  const [showCategoryTx, setShowCategoryTx] = useState(false);
  const [activeCategory, setActiveCategory] = useState<{
    categoryId: string;
    name: string;
    type: string;
    icon: string | null;
  } | null>(null);

  const { data: categoryTxList = [] } = useQuery({
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

  const categoryTotal = useMemo(
    () => filteredCategoryTx.reduce((s, t) => s + Number(t.amount), 0),
    [filteredCategoryTx],
  );

  const openCategory = (c: { categoryId: string; name: string; type: string; icon: string | null }) => {
    setActiveCategory(c);
    setShowCategoryTx(true);
  };

  // 左右箭头：按月导航（自定义区间则整体平移）
  const shift = (delta: number) => {
    setRange((prev) => {
      if (!isCustom) {
        return monthRangeOf(parseDate(prev.start), calendar, delta);
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
    }
    setShowRangePicker(false);
  };

  // 快捷区间按钮：只填入起止日期，用户点「确定」后生效
  const applyQuickRange = (key: 'year' | 'month' | 'q1' | 'q2' | 'q3' | 'q4') => {
    const r = quickRange(key, calendar);
    setTempStart(r.start);
    setTempEnd(r.end);
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
        textStyle: { fontSize: 13, color: '#333' },
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
  }, [summary]);

  const trendOption = useMemo(() => {
    const trend = summary?.trend ?? [];
    const moneyLabel = {
      show: true,
      position: 'top' as const,
      fontSize: 9,
      color: '#999',
      formatter: (p: any) => (p.value ? `¥${formatMoney(Number(p.value))}` : ''),
    };
    return {
      tooltip: { trigger: 'axis' as const },
      legend: { bottom: 0 },
      grid: { left: 40, right: 16, top: 28, bottom: 40 },
      xAxis: { type: 'category' as const, data: trend.map((t) => shortAxisKey(t.key, summary?.period ?? 'month')) },
      yAxis: { type: 'value' as const },
      series: [
        { name: '收入', type: 'bar' as const, data: trend.map((t) => t.income), itemStyle: { color: '#52c41a' }, label: moneyLabel },
        { name: '支出', type: 'bar' as const, data: trend.map((t) => t.expense), itemStyle: { color: '#ff4d4f' }, label: moneyLabel },
      ],
    };
  }, [summary]);

  return (
    <div className="page">
      <NavBar
        back={null}
        style={{ background: '#fff' }}
        right={
          <span
            style={{ fontSize: 14, color: '#1677ff' }}
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
            background: '#fff',
            borderRadius: 12,
            padding: '10px 16px',
            marginBottom: 12,
          }}
        >
          <div onClick={() => shift(-1)} style={{ padding: '4px 8px', cursor: 'pointer' }}>
            <LeftOutline />
          </div>
          <div onClick={openRangePicker} style={{ fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
            {range.start} ~ {range.end}
          </div>
          <div onClick={() => shift(1)} style={{ padding: '4px 8px', cursor: 'pointer' }}>
            <RightOutline />
          </div>
        </div>

        {/* 账本选择（折叠显示，点开弹窗多选） */}
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
          onClick={() => setShowLedgerPicker(true)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, overflow: 'hidden' }}>
            <span className="text-secondary" style={{ fontSize: 13, flexShrink: 0 }}>账本</span>
            {orderedLedgers.map((l) => {
              const selected = selectedIds.includes(l.id);
              return (
                <span
                  key={l.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(l.id);
                  }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 12,
                    background: selected ? '#e6f4ff' : '#f5f5f5',
                    color: selected ? '#1677ff' : '#999',
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
          <span style={{ fontSize: 13, color: '#1677ff' }}>选择</span>
        </div>

        {/* 收支总览 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[
            { label: '收入', value: summary?.totalIncome ?? 0, color: '#52c41a' },
            { label: '支出', value: summary?.totalExpense ?? 0, color: '#ff4d4f' },
            { label: '盈余', value: summary?.surplus ?? 0, color: '#1677ff' },
          ].map((s) => (
            <div key={s.label} style={{ flex: 1, background: '#fff', borderRadius: 12, padding: 12, textAlign: 'center' }}>
              <div className="text-secondary" style={{ fontSize: 12 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>¥{formatMoney(s.value)}</div>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', borderRadius: 12, padding: 8, marginBottom: 12 }}>
          <Chart option={trendOption} height={240} />
        </div>

        <div style={{ background: '#fff', borderRadius: 12, padding: 8 }}>
          <Chart option={pieOption} height={280} />
        </div>

        <CategoryList
          title="收入类别"
          color="#52c41a"
          cats={(summary?.byCategory ?? []).filter((c) => c.type === 'income')}
          total={summary?.totalIncome ?? 0}
          onOpen={openCategory}
        />
        <CategoryList
          title="支出类别"
          color="#ff4d4f"
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

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {([
              { key: 'year', label: '当年' },
              { key: 'month', label: '当月' },
              { key: 'q1', label: 'Q1' },
              { key: 'q2', label: 'Q2' },
              { key: 'q3', label: 'Q3' },
              { key: 'q4', label: 'Q4' },
            ] as const).map((b) => (
              <Button key={b.key} size="mini" fill="outline" onClick={() => applyQuickRange(b.key)}>
                {b.label}
              </Button>
            ))}
          </div>

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
                  style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}
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
                  style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}
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
        onToggle={toggle}
      />

      {/* 类别流水弹窗 */}
      <Popup
        visible={showCategoryTx}
        onMaskClick={() => setShowCategoryTx(false)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 16, maxHeight: '75vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 16 }}>
              {activeCategory?.icon} {activeCategory?.name} 流水
            </span>
            <span onClick={() => setShowCategoryTx(false)} style={{ fontSize: 22, color: '#999', cursor: 'pointer', lineHeight: 1 }}>
              ×
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div style={{ flex: 1, background: '#f5f6f8', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
              <div className="text-secondary" style={{ fontSize: 11 }}>合计</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: activeCategory?.type === 'income' ? '#52c41a' : '#ff4d4f' }}>
                ¥{formatMoney(categoryTotal)}
              </div>
            </div>
            <div style={{ flex: 1, background: '#f5f6f8', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
              <div className="text-secondary" style={{ fontSize: 11 }}>笔数</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#333' }}>{filteredCategoryTx.length} 笔</div>
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <SearchBar
              placeholder="搜索备注、类别或金额"
              value={categoryKeyword}
              onChange={setCategoryKeyword}
              onClear={() => setCategoryKeyword('')}
            />
          </div>

          <TransactionDayList
            transactions={filteredCategoryTx}
            showLedgerName={selectedIds.length !== 1}
            emptyText="该类别暂无流水"
          />
        </div>
      </Popup>
    </div>
  );
}
