import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, DatePicker, Dialog, Input, NavBar, Popup, Toast } from 'antd-mobile';
import { repaymentApi } from '../api/misc';
import { loanApi } from '../api/loan';
import { expensePlanApi } from '../api/expense';
import { ledgerApi } from '../api/ledger';
import { useRepaymentLedgerSelection } from '../stores/repaymentLedgerSelection';
import LedgerSelectPopup, { NONE_LEDGER_MARKER } from '../components/LedgerSelectPopup';
import ExpandableNote from '../components/ExpandableNote';
import { usePersistedState } from '../hooks/usePersistedState';
import { useBusy } from '../hooks/useBusy';
import { usePopupBack } from '../hooks/usePopupBack';
import type { Ledger } from '../types';
import { formatDate, formatMoney } from '../lib/format';
import { Lunar, LunarMonth, Solar } from 'lunar-javascript';

/** 公历某年底（12-31）→ YYYY-MM-DD */
function solarYearEndOf(year: number): string {
  return formatDate(new Date(year, 11, 31));
}

/** 从 date 推进 months 个月；目标月无同日则取月末（保证含末日整天） */
function addMonthsToEnd(d: Date, months: number): string {
  const total = d.getFullYear() * 12 + d.getMonth() + months;
  const y2 = Math.floor(total / 12);
  const m2 = total % 12;
  const lastDay = new Date(y2, m2 + 1, 0).getDate();
  return formatDate(new Date(y2, m2, Math.min(d.getDate(), lastDay)));
}

/** 当前月份 + offset 月之后的那个月末 */
function monthEndOffset(offsetMonths: number): string {
  const now = new Date();
  return formatDate(new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0));
}

/** 当前季度最后一天（3/6/9/12 月末） */
function quarterEndNow(): string {
  const now = new Date();
  const qEndMonth = (Math.floor(now.getMonth() / 3) + 1) * 3;
  return formatDate(new Date(now.getFullYear(), qEndMonth, 0));
}

/** 农历某年底（腊月最后一天）→ YYYY-MM-DD */
function lunarYearEndOfYear(lunarYear: number): string {
  const dayCount = LunarMonth.fromYm(lunarYear, 12).getDayCount();
  const solar = Lunar.fromYmd(lunarYear, 12, dayCount).getSolar();
  return formatDate(new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay()));
}

/** 统计截止日期快捷预设（分组） */
const END_DATE_GROUPS = [
  {
    title: '按月份',
    buttons: [
      { key: 'm1', label: '1个月后' },
      { key: 'm2', label: '2个月后' },
      { key: 'm3', label: '3个月后' },
      { key: 'm6', label: '半年后' },
      { key: 'm12', label: '一年后' },
    ],
  },
  {
    title: '月末',
    buttons: [
      { key: 'me0', label: '本月末' },
      { key: 'me1', label: '下月末' },
      { key: 'me2', label: '+2月末' },
      { key: 'me3', label: '+3月末' },
      { key: 'me4', label: '+4月末' },
      { key: 'me5', label: '+5月末' },
    ],
  },
  {
    title: '季末·年末',
    buttons: [
      { key: 'q0', label: '本季末' },
      { key: 'y0', label: '本年末' },
      { key: 'y1', label: '明年末' },
      { key: 'y2', label: '后年末' },
      { key: 'y3', label: '+3年末' },
    ],
  },
  {
    title: '农历年末',
    buttons: [
      { key: 'ly0', label: '今年农历年底' },
      { key: 'ly1', label: '明年农历年底' },
      { key: 'ly2', label: '后年农历年底' },
    ],
  },
];

/** 「所有」：截止到 2099-12-31，覆盖全部时间 */
const END_DATE_ALL = { key: 'all', label: '所有' };

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
  const navigate = useNavigate();
  const selectedIds = useRepaymentLedgerSelection((s) => s.selectedIds);
  const deselectedIds = useRepaymentLedgerSelection((s) => s.deselectedIds);
  const setSelected = useRepaymentLedgerSelection((s) => s.setSelected);
  const [showPicker, setShowPicker] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  // 截止日期选择弹窗
  const [showEndPicker, setShowEndPicker] = useState(false);

  usePopupBack(showEndPicker, () => setShowEndPicker(false));
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
    const now = new Date();
    switch (key) {
      case END_DATE_ALL.key:
        // 所有：覆盖全部时间
        setTempEnd('2099-12-31');
        return;
      case 'me0':
      case 'me1':
      case 'me2':
      case 'me3':
      case 'me4':
      case 'me5':
        setTempEnd(monthEndOffset(Number(key.slice(-1))));
        return;
      case 'm1':
      case 'm2':
      case 'm3':
      case 'm6':
      case 'm12':
        setTempEnd(addMonthsToEnd(now, Number(key.slice(1))));
        return;
      case 'q0':
        setTempEnd(quarterEndNow());
        return;
      case 'y0':
      case 'y1':
      case 'y2':
      case 'y3':
        setTempEnd(solarYearEndOf(now.getFullYear() + Number(key.slice(1))));
        return;
      case 'ly0':
      case 'ly1':
      case 'ly2':
        {
          const ly = Solar.fromDate(now).getLunar().getYear();
          setTempEnd(lunarYearEndOfYear(ly + Number(key.slice(2))));
        }
        return;
      default:
        return;
    }
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

  usePopupBack(!!markItem, () => setMarkItem(null));
  const [markAmount, setMarkAmount] = useState('');
  const [markDate, setMarkDate] = useState(''); // 空 = 今天（后端取标记时刻，含时间）

  // 点「标记已还/标记支出」：提前 >3 天先二次确认，再打开标记弹窗
  const handleMarkClick = (it: any, dueDate: string) => {
    const daysN = daysUntil(dueDate);
    const isPlan = !!it.expensePlanId;
    const openMark = () => {
      setMarkItem(it);
      setMarkAmount(String(it.totalAmount ?? it.amount ?? 0));
      setMarkDate('');
    };
    if (daysN > 3) {
      Dialog.confirm({
        title: '提前标记确认',
        content: isPlan
          ? `该期还有 ${daysN} 天才到期，标记支出会把这笔支出记到今天 ${formatDate(new Date())}，确定继续吗？`
          : `该期还有 ${daysN} 天才到期，标记为已还会把该笔支出记到标记时刻（今天 ${formatDate(new Date())}），确定继续吗？`,
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
        // 支出计划来源 → 标记支出（后端同步流水时间/金额）；否则走贷款标记已还
        if (markItem.expensePlanId) {
          await expensePlanApi.mark(markItem.expensePlanId, markItem.expensePeriodNo, {
            amount,
            paidDate: payload.paidDate,
          });
          Toast.show({ content: '已标记支出' });
        } else {
          await loanApi.pay(markItem.loanId, markItem.periodNo, payload);
          Toast.show({ content: '已标记已还' });
        }
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
      <NavBar back={null} style={{ background: 'var(--card)' }}>
        还款计划
      </NavBar>

      <div style={{ padding: 16 }}>
        {/* 统计截止时间（置于账本选择上方） */}
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
        >
          <span className="text-secondary" style={{ fontSize: 13 }}>统计截止时间</span>
          <div
            onClick={openEndPicker}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--primary)',
              fontSize: 13,
            }}
          >
            {endDate}（约 {days} 天）
          </div>
        </div>

        {/* 账本筛选（横向滑动浏览，点开弹窗多选） */}
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
          onClick={() => setShowPicker(true)}
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

        {/* 汇总卡片 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div
            style={{
              flex: 1,
              background: 'var(--card)',
              borderRadius: 12,
              padding: '16px',
              textAlign: 'center',
            }}
          >
            <div className="text-secondary" style={{ fontSize: 13 }}>待还款</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--income)' }}>
              ¥{formatMoney(data?.totalAmount ?? 0)}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              background: 'var(--card)',
              borderRadius: 12,
              padding: '16px',
              textAlign: 'center',
            }}
          >
            <div className="text-secondary" style={{ fontSize: 13 }}>待支出</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--income)' }}>
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
            <div key={d.date} style={{ background: 'var(--card)', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
              <div
                onClick={() => toggleRepay(d.date)}
                style={{
                  padding: '10px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  borderBottom: isExpanded ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#bbb', fontSize: 12, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>
                    ▶
                  </span>
                  <span style={{ fontWeight: 600 }}>{d.date}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.items.length} 笔</span>
                </span>
                <span style={{ fontWeight: 700, color: 'var(--text-muted)' }}>¥{formatMoney(d.total)}</span>
              </div>
              {isExpanded && d.items.map((it: any) => (
                <div key={it.repaymentId} style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                  {repayScale !== 'day' && (
                    <span style={{ color: '#ff8f1f', marginRight: 6 }}>{it.dueDate}</span>
                  )}
                  <span
                    style={{ color: 'var(--primary)', cursor: 'pointer' }}
                    onClick={() => it.loanId && navigate(`/loans/${it.loanId}`)}
                  >
                    {it.loanName}
                  </span>{' '}
                  {it.kind === 'prepay' ? '提前还款' : `第${it.periodNo}期`} · 剩余{' '}
                  <span style={{ color: 'var(--expense)' }}>¥{formatMoney(it.remainingPrincipal)}</span>
                  /{it.remainingPeriods}期、本期{' '}
                  <span style={{ color: 'var(--income)' }}>¥{formatMoney(it.totalAmount)}</span>
                  <span style={{ marginLeft: 6, color: it.status === 'overdue' ? 'var(--expense)' : 'var(--text-muted)' }}>
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
          <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)', marginBottom: 16 }}>未来 30 天暂无待还款</div>
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
            <div key={d.date} style={{ background: 'var(--card)', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
              <div
                onClick={() => toggleExpense(d.date)}
                style={{
                  padding: '10px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  borderBottom: isExpanded ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#bbb', fontSize: 12, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>
                    ▶
                  </span>
                  <span style={{ fontWeight: 600 }}>{d.date}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.items.length} 笔</span>
                </span>
                <span style={{ fontWeight: 700, color: 'var(--text-muted)' }}>¥{formatMoney(d.total)}</span>
              </div>
              {isExpanded && d.items.map((it: any) => (
                <div key={it.transactionId} style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                  {repayScale !== 'day' && (
                    <span style={{ color: '#ff8f1f', marginRight: 6 }}>{it.dueDate}</span>
                  )}
                  {it.expensePlanId ? (
                    <>
                      <span
                        style={{ color: 'var(--primary)', cursor: 'pointer' }}
                        onClick={() => it.expensePlanId && navigate(`/expense-plans/${it.expensePlanId}`)}
                      >
                        {it.expensePlanName}
                      </span>{' '}
                      第{it.expensePeriodNo}期 ·{' '}
                      <span style={{ color: 'var(--income)' }}>¥{formatMoney(it.amount)}</span>
                      <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>待支出</span>
                      <Button size="mini" color="success" fill="outline" style={{ marginLeft: 8 }} onClick={() => handleMarkClick(it, it.dueDate)}>
                        支出
                      </Button>
                    </>
                  ) : (
                    <>
                      {it.categoryIcon || '💸'} {it.categoryName} · <span style={{ color: 'var(--income)' }}>¥{formatMoney(it.amount)}</span>
                      {it.note && <ExpandableNote text={it.note} />}
                    </>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        {!groupedExpense.length && (
          <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>未来 30 天暂无待支出</div>
        )}
      </div>

      <LedgerSelectPopup
        visible={showPicker}
        getContainer={() => pageRef.current ?? document.body}
        onClose={() => setShowPicker(false)}
        ledgers={ledgers}
        selectedIds={selectedIds}
        onToggle={handleToggle}
        onSelectAll={() => setSelected([])}
        onSelectNone={() => setSelected([NONE_LEDGER_MARKER])}
      />

      {/* 统计截止时间选择弹窗 */}
      <Popup
        visible={showEndPicker}
        onMaskClick={() => setShowEndPicker(false)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>设置统计截止日期</h3>

          {/* 所有：覆盖全部时间 */}
          <div style={{ marginBottom: 12 }}>
            <Button size="mini" color="primary" fill="outline" onClick={() => applyEndPreset(END_DATE_ALL.key)}>
              {END_DATE_ALL.label}
            </Button>
          </div>

          {END_DATE_GROUPS.map((g) => (
            <div key={g.title} style={{ marginBottom: 10 }}>
              <div className="text-secondary" style={{ fontSize: 12, marginBottom: 4 }}>{g.title}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {g.buttons.map((b) => (
                  <Button key={b.key} size="mini" fill="outline" onClick={() => applyEndPreset(b.key)}>
                    {b.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}

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
                  style={{ background: 'var(--fill)', borderRadius: 8, padding: '10px 12px' }}
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
          <h3 style={{ marginBottom: 8 }}>{markItem?.expensePlanId ? '标记支出' : '标记为已还'}</h3>
          <div className="text-secondary" style={{ fontSize: 13, marginBottom: 16 }}>
            {markItem?.expensePlanId
              ? `${markItem.expensePlanName} 第${markItem.expensePeriodNo}期 · 金额 ¥${formatMoney(Number(markItem?.amount ?? 0))}`
              : `${markItem?.loanName} 第${markItem?.periodNo}期 · 应还 ¥${formatMoney(Number(markItem?.totalAmount ?? 0))}`}
          </div>
          <div style={{ marginBottom: 16 }}>
            <Input
              type="number"
              placeholder="还款金额"
              value={markAmount}
              onChange={setMarkAmount}
              style={{ fontSize: 24, marginBottom: 12 }}
            />
            <DatePicker precision="day" value={markDate ? new Date(markDate) : new Date()} max={new Date()} onConfirm={(v) => setMarkDate(formatDate(v))}>
              {(_value, actions) => (
                <div onClick={() => actions.open()} style={{ background: 'var(--fill)', borderRadius: 8, padding: '10px 12px' }}>
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
