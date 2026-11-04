import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Checkbox, NavBar, Picker } from 'antd-mobile';
import { LeftOutline, RightOutline } from 'antd-mobile-icons';
import { statApi } from '../api/misc';
import { ledgerApi } from '../api/ledger';
import Chart from '../components/Chart';
import type { Ledger, StatSummary } from '../types';

export default function Stats() {
  const [calendar, setCalendar] = useState<'solar' | 'lunar'>('solar');
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [selected, setSelected] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  // 当前查看的月份（YYYY-MM）或年份（YYYY）
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });

  const { data: summary } = useQuery({
    queryKey: ['stats', 'summary', selected, calendar, period, currentDate],
    queryFn: async () => {
      const params: Record<string, string> = { calendar, period };
      if (selected.length) params.ledgerIds = selected.join(',');
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
      const y = Number(prev) + delta;
      return String(y);
    });
  };

  // 显示当前周期标签
  const periodLabel = useMemo(() => {
    if (period === 'month') return currentDate;
    return `${currentDate} 年`;
  }, [period, currentDate]);

  const pieOption = useMemo(() => {
    const expenseCats = (summary?.byCategory ?? []).filter((c) => c.type === 'expense');
    const total = expenseCats.reduce((s, c) => s + c.amount, 0);
    return {
      tooltip: { trigger: 'item' as const },
      legend: { bottom: 0, type: 'scroll' as const },
      series: [
        {
          type: 'pie' as const,
          radius: ['35%', '65%'],
          center: ['50%', '45%'],
          data: expenseCats.map((c) => ({ name: c.name, value: c.amount })),
          label: { formatter: '{b}: {d}%' },
        },
      ],
      title: { text: `支出构成 ¥${total.toFixed(2)}`, left: 'center', top: 5, textStyle: { fontSize: 14 } },
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
          <span style={{ fontSize: 14, color: '#1677ff' }} onClick={() => setShowPicker(true)}>
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

        {/* 账本选择 */}
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <div className="text-secondary" style={{ fontSize: 13, marginBottom: 8 }}>
            汇总账本（不选则全部）
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ledgers.map((l) => (
              <Checkbox
                key={l.id}
                checked={selected.includes(l.id)}
                onChange={(checked) =>
                  setSelected((prev) =>
                    checked ? [...prev, l.id] : prev.filter((x) => x !== l.id),
                  )
                }
              >
                {l.name}
              </Checkbox>
            ))}
          </div>
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
        visible={showPicker}
        onClose={() => setShowPicker(false)}
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
          setPeriod(v[1] as 'month' | 'year');
          setShowPicker(false);
        }}
      />
    </div>
  );
}
