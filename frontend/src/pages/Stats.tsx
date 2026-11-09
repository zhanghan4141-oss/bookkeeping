import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, DatePicker, NavBar, Popup } from 'antd-mobile';
import { LeftOutline, RightOutline } from 'antd-mobile-icons';
import { Lunar, LunarMonth, Solar } from 'lunar-javascript';
import { statApi } from '../api/misc';
import { ledgerApi } from '../api/ledger';
import Chart from '../components/Chart';
import LedgerSelectPopup from '../components/LedgerSelectPopup';
import { useLedgerSelectionStore } from '../stores/ledgerSelection';
import type { Ledger, StatSummary } from '../types';

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

  // 选中的账本对象
  const selectedLedgers = useMemo(
    () => ledgers.filter((l) => selectedIds.includes(l.id)),
    [ledgers, selectedIds],
  );

  const pieOption = useMemo(() => {
    const expenseCats = (summary?.byCategory ?? []).filter((c) => c.type === 'expense');
    const total = expenseCats.reduce((s, c) => s + c.amount, 0);
    return {
      tooltip: { trigger: 'item' as const },
      legend: { bottom: 0, type: 'scroll' as const },
      title: {
        text: `支出构成 ¥${total.toFixed(2)}`,
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
      formatter: (p: any) => (p.value ? `¥${Number(p.value).toFixed(2)}` : ''),
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
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, flex: 1 }}>
            <span className="text-secondary" style={{ fontSize: 13 }}>账本</span>
            {selectedLedgers.slice(0, 3).map((l) => (
              <span
                key={l.id}
                style={{
                  padding: '4px 10px',
                  borderRadius: 12,
                  background: '#e6f4ff',
                  color: '#1677ff',
                  fontSize: 13,
                }}
              >
                {l.name}
              </span>
            ))}
            {selectedLedgers.length > 3 && (
              <span style={{ fontSize: 13, color: '#666' }}>+{selectedLedgers.length - 3}</span>
            )}
            {selectedLedgers.length === 0 && (
              <span className="text-secondary" style={{ fontSize: 13 }}>全部账本</span>
            )}
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
              <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>¥{s.value.toFixed(2)}</div>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', borderRadius: 12, padding: 8, marginBottom: 12 }}>
          <Chart option={trendOption} height={240} />
        </div>

        <div style={{ background: '#fff', borderRadius: 12, padding: 8 }}>
          <Chart option={pieOption} height={280} />
        </div>
      </div>

      {/* 自定义日期范围弹窗 */}
      <Popup
        visible={showRangePicker}
        onMaskClick={() => setShowRangePicker(false)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>设置统计区间</h3>
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
    </div>
  );
}
