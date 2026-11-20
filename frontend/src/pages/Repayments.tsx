import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, DatePicker, Dialog, Input, NavBar, Popup, Toast } from 'antd-mobile';
import { repaymentApi } from '../api/misc';
import { loanApi } from '../api/loan';
import { ledgerApi } from '../api/ledger';
import { useRepaymentLedgerSelection } from '../stores/repaymentLedgerSelection';
import LedgerSelectPopup from '../components/LedgerSelectPopup';
import ExpandableNote from '../components/ExpandableNote';
import { usePersistedState } from '../hooks/usePersistedState';
import { useBusy } from '../hooks/useBusy';
import type { Ledger } from '../types';
import { formatDate, formatMoney } from '../lib/format';
import { Lunar, LunarMonth, Solar } from 'lunar-javascript';

/** 公历今年年底（12-31）→ YYYY-MM-DD */
function solarYearEnd(): string {
  const now = new Date();
  return formatDate(new Date(now.getFullYear(), 11, 31));
}

/** 公历本月底（当月最后一天）→ YYYY-MM-DD */
function monthEnd(): string {
  const now = new Date();
  // 日传 0 = 下月第 0 天，即本月最后一天
  return formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

/** 农历今年年底（腊月最后一天）→ YYYY-MM-DD */
function lunarYearEnd(): string {
  const now = new Date();
  const lunarYear = Solar.fromDate(now).getLunar().getYear();
  const dayCount = LunarMonth.fromYm(lunarYear, 12).getDayCount();
  const solar = Lunar.fromYmd(lunarYear, 12, dayCount).getSolar();
  return formatDate(new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay()));
}

/** 统计截止日期快捷预设 */
const END_DATE_PRESETS = [
  { key: 'monthend', label: '本月底' },
  { key: '30', label: '30天后' },
  { key: '60', label: '60天后' },
  { key: '90', label: '90天后' },
  { key: '180', label: '180天后' },
  { key: 'yearend', label: '今年底' },
  { key: 'lunaryearend', label: '到农历年底' },
];

/** 按尺度（日/月/年）合并按日分组的数据，并把原始日期注入每个 item（dueDate） */
function groupByScale(
  daily: { date: string; total: number; items: any[] }[],
  scale: 'day' | 'month' | 'year',
): { date: string; total: number; items: any[] }[] {
  const map = new Map<string, { date: string; total: number; items: any[] }>();
  for (const g of daily) {
    const key =
      scale === 'day' ? g.date : scale === 'month' ? g.date.slice(0, 7) : g.date.slice(0, 4);
    if (!map.has(key)) map.set(key, { date: key, total: 0, items: [] });
    const entry = map.get(key)!;
    entry.total += g.total;
    for (const it of g.items) {
      entry.items.push({ ...it, dueDate: g.date });
    }
  }
  return Array.from(map.values());
}

export default function Repayments() {
  const selectedIds = useRepaymentLedgerSelection((s) => s.selectedIds);
  const deselectedIds = useRepaymentLedgerSelection((s) => s.deselectedIds);
  const toggle = useRepaymentLedgerSelection((s) => s.toggle);
  const [showPicker, setShowPicker] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  // 截止日期选择弹窗
  const [showEndPicker, setShowEndPicker] = useState(false);
  // 弹窗内待定的截止日期（点预设/改日期后，点「确定」才生效；打开时同步为当前值）
  const [tempEnd, setTempEnd] = useState('');
  // 截止日期（默认未来 30 天，持久化记住上次选择；切账号会重置）
  const [endDate, setEndDate] = usePersistedState(
    'bookkeeping-repayment-enddate',
    () => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return formatDate(d);
    },
  );

  // 待还款/待支出列表的合并显示尺度：日/月/年（共用，同步切换）
  const [repayScale, setRepayScale] = useState<'day' | 'month' | 'year'>('day');

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });

  // 截止日期 → 天数
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    const diff = Math.ceil((end.getTime() - today.getTime()) / (24 * 3600 * 1000));
    return Math.min(Math.max(diff, 1), 365);
  }, [endDate]);

  // 打开截止日期弹窗：先把当前截止日期填入待定态
  const openEndPicker = () => {
    setTempEnd(endDate);
    setShowEndPicker(true);
  };

  // 预设按钮：填入待定态，点「确定」再生效
  const applyEndPreset = (key: string) => {
    if (key === 'monthend') {
      setTempEnd(monthEnd());
      return;
    }
    if (key === 'yearend') {
      setTempEnd(solarYearEnd());
      return;
    }
    if (key === 'lunaryearend') {
      setTempEnd(lunarYearEnd());
      return;
    }
    const d = new Date();
    d.setDate(d.getDate() + Number(key));
    setTempEnd(formatDate(d));
  };

  const confirmEndDate = () => {
    if (!tempEnd) return;
    setEndDate(tempEnd);
    setShowEndPicker(false);
  };

  const { data, refetch } = useQuery({
    queryKey: ['repayments', 'upcoming', days, selectedIds],
    queryFn: async () => (await repaymentApi.upcoming(days, selectedIds)).data,
  });

  // ===== 手动标记已还 =====
  // 距「今天」的日差（到期日 = 日期分组头的 date 字符串）
  const daysUntil = (dateStr: string) => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Math.ceil((new Date(`${dateStr}T00:00:00`).getTime() - start.getTime()) / 86400000);
  };

  const [markItem, setMarkItem] = useState<any>(null);
  const [markAmount, setMarkAmount] = useState('');
  const [markDate, setMarkDate] = useState(''); // 空 = 今天（后端取标记时刻，含时间）

  // 点「标记已还」：提前 >3 天先二次确认，再打开标记弹窗
  const handleMarkClick = (it: any, dueDate: string) => {
    const daysN = daysUntil(dueDate);
    const openMark = () => {
      setMarkItem(it);
      setMarkAmount(String(it.totalAmount ?? 0));
      setMarkDate('');
    };
    if (daysN > 3) {
      Dialog.confirm({
        title: '提前标记确认',
        content: `该期还有 ${daysN} 天才到期，标记为已还会把该笔支出记到标记时刻（今天 ${formatDate(new Date())}），确定继续吗？`,
        confirmText: '继续标记',
        cancelText: '取消',
        onConfirm: () => openMark(),
      });
      return;
    }
    openMark();
  };

  const { busy: markBusy, run: runMark } = useBusy();
  const submitMark = () => {
    if (!markItem) return;
    runMark(async () => {
      const amount = Number(markAmount);
      if (!markAmount || amount <= 0) {
        Toast.show({ content: '请输入金额' });
        return;
      }
      try {
        const payload: { amount: number; paidDate?: string; syncTransactionsToPaidAt: boolean } = {
          amount,
          syncTransactionsToPaidAt: true,
        };
        // 默认今天 → 不传 paidDate，后端按标记时刻（精确时间）记录流水；
        // 显式选到其它日期才传 paidDate。
        if (markDate && markDate !== formatDate(new Date())) payload.paidDate = markDate;
        await loanApi.pay(markItem.loanId, markItem.periodNo, payload);
        Toast.show({ content: '已标记已还' });
        setMarkItem(null);
        refetch();
      } catch (e: any) {
        Toast.show({ content: e.response?.data?.message ?? '标记失败' });
      }
    });
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

  const pendingExpense = data?.pendingExpense;

  // 按尺度合并分组（注入每笔原始日期 dueDate 供明细展示与标记已还使用）
  const groupedRepay = useMemo(
    () => groupByScale(data?.daily ?? [], repayScale),
    [data?.daily, repayScale],
  );
  const groupedExpense = useMemo(
    () => groupByScale(pendingExpense?.daily ?? [], repayScale),
    [pendingExpense?.daily, repayScale],
  );

  // 折叠展示：默认展开最近一天，其余折叠（待还款 / 待支出各自独立）
  const [expandedRepay, setExpandedRepay] = useState<Set<string>>(new Set());
  const [expandedExpense, setExpandedExpense] = useState<Set<string>>(new Set());

  useEffect(() => {
    const first = groupedRepay[0]?.date;
    if (first) setExpandedRepay(new Set([first]));
  }, [groupedRepay[0]?.date]);

  useEffect(() => {
    const first = groupedExpense[0]?.date;
    if (first) setExpandedExpense(new Set([first]));
  }, [groupedExpense[0]?.date]);

  const toggleRepay = (date: string) => {
    setExpandedRepay((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const toggleExpense = (date: string) => {
    setExpandedExpense((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  return (
    <div className="page" ref={pageRef}>
      <NavBar back={null} style={{ background: '#fff' }}>
        还款计划
      </NavBar>

      <div style={{ padding: 16 }}>
        {/* 账本筛选（折叠显示，点开弹窗多选） */}
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
          onClick={() => setShowPicker(true)}
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

        {/* 截止时间 */}
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
        >
          <span className="text-secondary" style={{ fontSize: 13 }}>统计截止时间</span>
          <div
            onClick={openEndPicker}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: '#1677ff',
              fontSize: 13,
            }}
          >
            {endDate}（约 {days} 天）
          </div>
        </div>

        {/* 汇总卡片 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div
            style={{
              flex: 1,
              background: '#fff',
              borderRadius: 12,
              padding: '16px',
              textAlign: 'center',
            }}
          >
            <div className="text-secondary" style={{ fontSize: 13 }}>待还款</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#52c41a' }}>
              ¥{formatMoney(data?.totalAmount ?? 0)}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              background: '#fff',
              borderRadius: 12,
              padding: '16px',
              textAlign: 'center',
            }}
          >
            <div className="text-secondary" style={{ fontSize: 13 }}>待支出</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#52c41a' }}>
              ¥{formatMoney(pendingExpense?.totalAmount ?? 0)}
            </div>
          </div>
        </div>

        {/* 待还款列表 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>待还款</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['day', 'month', 'year'] as const).map((k) => (
              <Button
                key={k}
                size="mini"
                color={repayScale === k ? 'primary' : 'default'}
                onClick={() => setRepayScale(k)}
              >
                {k === 'day' ? '按日' : k === 'month' ? '按月' : '按年'}
              </Button>
            ))}
          </div>
        </div>
        {groupedRepay.map((d: any) => {
          const isExpanded = expandedRepay.has(d.date);
          return (
            <div key={d.date} style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
              <div
                onClick={() => toggleRepay(d.date)}
                style={{
                  padding: '10px 12px',
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
                  <span style={{ fontWeight: 600 }}>{d.date}</span>
                  <span style={{ fontSize: 12, color: '#999' }}>{d.items.length} 笔</span>
                </span>
                <span style={{ fontWeight: 700, color: '#999' }}>¥{formatMoney(d.total)}</span>
              </div>
              {isExpanded && d.items.map((it: any) => (
                <div key={it.repaymentId} style={{ fontSize: 13, color: '#666', padding: '8px 12px', borderBottom: '1px solid #fafafa', display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                  {repayScale !== 'day' && (
                    <span style={{ color: '#ff8f1f', marginRight: 6 }}>{it.dueDate}</span>
                  )}
                  <span style={{ color: '#1677ff' }}>{it.loanName}</span> {it.kind === 'prepay' ? '提前还款' : `第${it.periodNo}期`} · 剩余{' '}
                  <span style={{ color: '#ff4d4f' }}>¥{formatMoney(it.remainingPrincipal)}</span>
                  /{it.remainingPeriods}期、本期{' '}
                  <span style={{ color: '#52c41a' }}>¥{formatMoney(it.totalAmount)}</span>
                  <span style={{ marginLeft: 6, color: it.status === 'overdue' ? '#ff4d4f' : '#999' }}>
                    {it.status === 'overdue' ? '逾期' : it.status === 'partial' ? '部分还' : '待还'}
                  </span>
                  <Button size="mini" color="primary" fill="outline" style={{ marginLeft: 8 }} onClick={() => handleMarkClick(it, it.dueDate)}>
                    标记已还
                  </Button>
                </div>
              ))}
            </div>
          );
        })}
        {!groupedRepay.length && (
          <div style={{ textAlign: 'center', padding: 16, color: '#999', marginBottom: 16 }}>未来 30 天暂无待还款</div>
        )}

        {/* 待支出列表 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 16 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>待支出</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['day', 'month', 'year'] as const).map((k) => (
              <Button
                key={k}
                size="mini"
                color={repayScale === k ? 'primary' : 'default'}
                onClick={() => setRepayScale(k)}
              >
                {k === 'day' ? '按日' : k === 'month' ? '按月' : '按年'}
              </Button>
            ))}
          </div>
        </div>
        {groupedExpense.map((d: any) => {
          const isExpanded = expandedExpense.has(d.date);
          return (
            <div key={d.date} style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
              <div
                onClick={() => toggleExpense(d.date)}
                style={{
                  padding: '10px 12px',
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
                  <span style={{ fontWeight: 600 }}>{d.date}</span>
                  <span style={{ fontSize: 12, color: '#999' }}>{d.items.length} 笔</span>
                </span>
                <span style={{ fontWeight: 700, color: '#999' }}>¥{formatMoney(d.total)}</span>
              </div>
              {isExpanded && d.items.map((it: any) => (
                <div key={it.transactionId} style={{ fontSize: 13, color: '#666', padding: '8px 12px', borderBottom: '1px solid #fafafa' }}>
                  {repayScale !== 'day' && (
                    <span style={{ color: '#ff8f1f', marginRight: 6 }}>{it.dueDate}</span>
                  )}
                  {it.categoryIcon || '💸'} {it.categoryName} · <span style={{ color: '#52c41a' }}>¥{formatMoney(it.amount)}</span>
                  {it.note && <ExpandableNote text={it.note} />}
                </div>
              ))}
            </div>
          );
        })}
        {!groupedExpense.length && (
          <div style={{ textAlign: 'center', padding: 16, color: '#999' }}>未来 30 天暂无待支出</div>
        )}
      </div>

      <LedgerSelectPopup
        visible={showPicker}
        getContainer={() => pageRef.current ?? document.body}
        onClose={() => setShowPicker(false)}
        ledgers={ledgers}
        selectedIds={selectedIds}
        onToggle={toggle}
      />

      {/* 统计截止时间选择弹窗 */}
      <Popup
        visible={showEndPicker}
        onMaskClick={() => setShowEndPicker(false)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>设置统计截止日期</h3>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {END_DATE_PRESETS.map((b) => (
              <Button key={b.key} size="mini" fill="outline" onClick={() => applyEndPreset(b.key)}>
                {b.label}
              </Button>
            ))}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>截止日期</div>
            <DatePicker
              precision="day"
              value={tempEnd ? new Date(tempEnd) : new Date()}
              min={new Date()}
              onConfirm={(v) => setTempEnd(formatDate(v))}
            >
              {(value, actions) => (
                <div
                  onClick={() => actions.open()}
                  style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}
                >
                  {value ? formatDate(value) : '选择日期'}
                </div>
              )}
            </DatePicker>
          </div>

          <Button block color="primary" onClick={confirmEndDate}>
            确定
          </Button>
        </div>
      </Popup>

      {/* 标记为已还弹窗 */}
      <Popup
        visible={!!markItem}
        onMaskClick={() => setMarkItem(null)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 8 }}>标记为已还</h3>
          <div className="text-secondary" style={{ fontSize: 13, marginBottom: 16 }}>
            {markItem?.loanName} 第{markItem?.periodNo}期 · 应还 ¥{formatMoney(Number(markItem?.totalAmount ?? 0))}
          </div>
          <div style={{ marginBottom: 16 }}>
            <Input
              type="number"
              placeholder="还款金额"
              value={markAmount}
              onChange={setMarkAmount}
              style={{ fontSize: 24, marginBottom: 12 }}
            />
            <DatePicker precision="day" value={markDate ? new Date(markDate) : new Date()} onConfirm={(v) => setMarkDate(formatDate(v))}>
              {(_value, actions) => (
                <div onClick={() => actions.open()} style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}>
                  {markDate || '今天'}
                </div>
              )}
            </DatePicker>
          </div>
          <Button block color="primary" loading={markBusy} onClick={submitMark}>确认标记</Button>
        </div>
      </Popup>
    </div>
  );
}
