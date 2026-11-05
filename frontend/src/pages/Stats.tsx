import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavBar, Picker } from 'antd-mobile';
import { LeftOutline, RightOutline } from 'antd-mobile-icons';
import { statApi } from '../api/misc';
import { ledgerApi } from '../api/ledger';
import Chart from '../components/Chart';
import LedgerSelectPopup from '../components/LedgerSelectPopup';
import { useLedgerSelectionStore } from '../stores/ledgerSelection';
import type { Ledger, StatSummary } from '../types';

export default function Stats() {
  const [calendar, setCalendar] = useState<'solar' | 'lunar'>('solar');
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const [showLedgerPicker, setShowLedgerPicker] = useState(false);
  const selectedIds = useLedgerSelectionStore((s) => s.selectedIds);
  const selectOne = useLedgerSelectionStore((s) => s.selectOne);
  // 当前查看的月份（YYYY-MM）或年份（YYYY）
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

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

  useEffect(() => {
    if (selectedIds.length === 0 && latestLedger) {
      selectOne(latestLedger.id);
    }
  }, [latestLedger, selectedIds.length, selectOne]);

  const { data: summary } = useQuery({
    queryKey: ['stats', 'summary', selectedIds, calendar, period, currentDate],
    queryFn: async () => {
      const params: Record<string, string> = { calendar, period };
      if (selectedIds.length) params.ledgerIds = selectedIds.join(',');
      if (calendar === 'solar') params.date = currentDate;
      return (await statApi.summary(params)).data as StatSummary;
    },
  });

  // 切换月份/年份
  const shift = (delta: number) => {
    setCurrentDate((prev) => {
      if (period === 'month') {
        const [y, m] = prev.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      // 年份：prev 可能是 'YYYY' 或 'YYYY-MM'，取年份部分
      const y = Number(prev.slice(0, 4)) + delta;
      return String(y);
    });
  };

  // 切换周期时，同步调整 currentDate 格式
  const handlePeriodChange = (newPeriod: 'month' | 'year') => {
    setCurrentDate((prev) => {
      if (newPeriod === 'year') {
        // 切到年：取年份部分
        return prev.slice(0, 4);
      }
      // 切到月：如果当前是年份（YYYY），补上当前月份
      if (/^\d{4}$/.test(prev)) {
        const now = new Date();
        return `${prev}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      }
      return prev;
    });
    setPeriod(newPeriod);
  };

  // 显示当前周期标签
  const periodLabel = useMemo(() => {
    if (period === 'month') return currentDate;
    return `${currentDate}`;
  }, [period, currentDate]);

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
    return {
      tooltip: { trigger: 'axis' as const },
      legend: { bottom: 0 },
      grid: { left: 40, right: 16, top: 16, bottom: 40 },
      xAxis: { type: 'category' as const, data: trend.map((t) => t.key) },
      yAxis: { type: 'value' as const },
      series: [
        { name: '收入', type: 'bar' as const, data: trend.map((t) => t.income), itemStyle: { color: '#52c41a' } },
        { name: '支出', type: 'bar' as const, data: trend.map((t) => t.expense), itemStyle: { color: '#ff4d4f' } },
      ],
    };
  }, [summary]);

  return (
    <div className="page">
      <NavBar
        back={null}
        style={{ background: '#fff' }}
        right={
          <span style={{ fontSize: 14, color: '#1677ff' }} onClick={() => setShowPeriodPicker(true)}>
            {calendar === 'lunar' ? '农历' : '公历'}·{period === 'month' ? '月' : '年'}
          </span>
        }
      >
        统计
      </NavBar>

      <div style={{ padding: 16 }}>
        {/* 周期切换（左右滑动） */}
        {calendar === 'solar' && (
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
            <div style={{ fontWeight: 700, fontSize: 16 }}>{periodLabel}</div>
            <div onClick={() => shift(1)} style={{ padding: '4px 8px', cursor: 'pointer' }}>
              <RightOutline />
            </div>
          </div>
        )}

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
              <span className="text-secondary" style={{ fontSize: 13 }}>点击选择</span>
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

      <Picker
        visible={showPeriodPicker}
        onClose={() => setShowPeriodPicker(false)}
        columns={[
          [
            { label: '公历', value: 'solar' },
            { label: '农历', value: 'lunar' },
          ],
          [
            { label: '按月', value: 'month' },
            { label: '按年', value: 'year' },
          ],
        ]}
        value={[calendar, period]}
        onConfirm={(v) => {
          setCalendar(v[0] as 'solar' | 'lunar');
          handlePeriodChange(v[1] as 'month' | 'year');
          setShowPeriodPicker(false);
        }}
      />

      <LedgerSelectPopup
        visible={showLedgerPicker}
        onClose={() => setShowLedgerPicker(false)}
        ledgers={ledgers}
      />
    </div>
  );
}
