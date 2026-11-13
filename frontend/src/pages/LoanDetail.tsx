import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Dialog, Input, List, NavBar, Popup, Radio, Toast } from 'antd-mobile';
import { loanApi } from '../api/loan';
import { ledgerApi } from '../api/ledger';
import { invalidateFinancialData } from '../lib/invalidate';
import { formatDate, formatMoney } from '../lib/format';
import type { Ledger, Loan, LoanRepayment } from '../types';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待还', color: '#1677ff' },
  partial: { label: '部分还', color: '#faad14' },
  paid: { label: '已还', color: '#52c41a' },
  overdue: { label: '逾期', color: '#ff4d4f' },
};

/** 编辑还款计划时的一行：普通期编辑本金/利息，提前还款只编辑金额 */
type EditPlanRow =
  | { kind: 'period'; periodNo?: number; dueDate: string; principal: string; interest: string }
  | { kind: 'prepay'; periodNo?: number; dueDate: string; totalAmount: string };

export default function LoanDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<LoanRepayment | null>(null);
  const [payAmount, setPayAmount] = useState('');
  // 提前还款状态
  const [showPrepay, setShowPrepay] = useState(false);
  const [prepayAmount, setPrepayAmount] = useState('');
  const [prepayDate, setPrepayDate] = useState(() => formatDate(new Date()));
  const [prepayMode, setPrepayMode] = useState<'reduce_payment' | 'reduce_term'>('reduce_payment');
  // 编辑还款计划状态
  const [editingPlan, setEditingPlan] = useState(false);
  const [editPeriods, setEditPeriods] = useState<EditPlanRow[]>([]);

  const { data: loan } = useQuery({
    queryKey: ['loan', id],
    queryFn: async () => (await loanApi.get(id)).data as Loan,
  });

  const { data: ledger } = useQuery({
    queryKey: ['ledger', loan?.ledgerId],
    queryFn: async () => (await ledgerApi.get(loan!.ledgerId)).data as Ledger,
    enabled: !!loan?.ledgerId,
  });
  const isViewer = ledger?.role === 'viewer';

  // 提前还款的当期利息预估（按天单利，仅供展示；以后端实际为准）
  const prepayEstimate = useMemo(() => {
    if (!loan || loan.repaymentMethod === 'custom') return null;
    const dayMs = 24 * 60 * 60 * 1000;
    const pd = new Date(prepayDate);
    const next = loan.repayments.find(
      (r) => r.kind === 'period' && r.status !== 'paid' && new Date(r.dueDate) > pd,
    );
    if (!next) return null;
    const prev = loan.repayments.find(
      (r) => r.kind === 'period' && r.periodNo === next.periodNo - 1,
    );
    const prevDue = prev ? new Date(prev.dueDate) : new Date(loan.startDate);
    const days = Math.floor((pd.getTime() - prevDue.getTime()) / dayMs);
    if (days <= 0) return { interest: 0, total: 0, isFull: false };
    const base = Number(loan.remainingPrincipal ?? 0);
    const interest =
      Math.round(base * (Number(loan.annualRate) / 100) * (days / 365) * 100) / 100;
    const amount = Number(prepayAmount) || 0;
    const isFull = amount >= base - 0.005;
    const principal = isFull ? base : amount;
    return {
      interest,
      total: Math.round((principal + interest) * 100) / 100,
      isFull,
    };
  }, [loan, prepayDate, prepayAmount]);

  // 结清金额（仅非自定义）：剩余本金 + 当期已产生利息（按天），不随输入金额变化
  const prepaySettleAmount = useMemo(() => {
    if (!loan || loan.repaymentMethod === 'custom') return 0;
    const dayMs = 24 * 60 * 60 * 1000;
    const pd = new Date(prepayDate);
    const next = loan.repayments.find(
      (r) => r.kind === 'period' && r.status !== 'paid' && new Date(r.dueDate) > pd,
    );
    if (!next) return 0;
    const prev = loan.repayments.find(
      (r) => r.kind === 'period' && r.periodNo === next.periodNo - 1,
    );
    const prevDue = prev ? new Date(prev.dueDate) : new Date(loan.startDate);
    const days = Math.floor((pd.getTime() - prevDue.getTime()) / dayMs);
    if (days <= 0) return 0;
    const base = Number(loan.remainingPrincipal ?? 0);
    const interest =
      Math.round(base * (Number(loan.annualRate) / 100) * (days / 365) * 100) / 100;
    return Math.round((base + interest) * 100) / 100;
  }, [loan, prepayDate]);

  const showPrepayMode =
    loan?.repaymentMethod === 'equal_installment' ||
    loan?.repaymentMethod === 'equal_principal';

  const handlePay = async () => {
    if (!paying) return;
    const amount = Number(payAmount);
    if (!payAmount || amount < 0) {
      Toast.show({ content: '请输入金额' });
      return;
    }
    try {
      await loanApi.pay(id, paying.periodNo, { amount });
      Toast.show({ content: '已登记还款' });
      setPaying(null);
      setPayAmount('');
      invalidateFinancialData(queryClient);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '操作失败' });
    }
  };

  const handleUndo = async (r: LoanRepayment) => {
    const ok = await new Promise((resolve) => {
      Dialog.confirm({ content: `撤销第${r.periodNo}期还款？`, onConfirm: () => resolve(true), onCancel: () => resolve(false) });
    });
    if (!ok) return;
    try {
      await loanApi.undo(id, r.periodNo);
      Toast.show({ content: '已撤销' });
      invalidateFinancialData(queryClient);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '操作失败' });
    }
  };

  // 导出还款计划（Excel）：走 axios 带 token 拉 blob 再下载。
  // 不能用 window.open —— 浏览器导航不带 Authorization，被全局 JwtAuthGuard 拦截会 401。
  const handleExportPlan = async () => {
    try {
      const res = await loanApi.exportPlan(id);
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${loan?.name ?? '贷款'}_还款计划.xlsx`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      Toast.show({ content: err.response?.data?.message ?? '导出失败' });
    }
  };

  // 删除贷款（二次确认）
  const handleDeleteLoan = async () => {
    const ok = await new Promise((resolve) => {
      Dialog.confirm({
        content: '确定删除该贷款？删除后贷款及其还款计划、相关流水将全部删除，不可恢复。',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      await loanApi.remove(id);
      Toast.show({ content: '已删除' });
      invalidateFinancialData(queryClient);
      navigate(-1);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '删除失败' });
    }
  };

  // 提前还款
  const handlePrepay = async () => {
    const amount = Number(prepayAmount);
    if (!prepayAmount || amount <= 0) {
      Toast.show({ content: '请输入提前还款金额' });
      return;
    }
    if (!prepayDate) {
      Toast.show({ content: '请选择还款日期' });
      return;
    }
    const remainingP = Number(loan?.remainingPrincipal ?? 0);
    // ===== 自定义：纯记账，提前还款金额不能超过未还本金 =====
    if (loan?.repaymentMethod === 'custom') {
      if (remainingP > 0 && amount > remainingP + 0.005) {
        Toast.show({ content: `提前还款金额不能超过未还本金 ¥${formatMoney(remainingP)}` });
        return;
      }
      try {
        await loanApi.prepay(id, { amount, prepayDate, mode: prepayMode });
        Toast.show({ content: '已提前还款' });
        setShowPrepay(false);
        setPrepayAmount('');
        invalidateFinancialData(queryClient);
      } catch (e: any) {
        Toast.show({ content: e.response?.data?.message ?? '提前还款失败' });
      }
      return;
    }
    // ===== 非自定义：结清金额 = 剩余本金 + 当期利息，判定与记账统一 =====
    const settleAmount = Number(prepaySettleAmount);
    if (remainingP > 0 && amount >= remainingP - 0.005) {
      // 灰色区间：≥ 剩余本金 但 < 结清金额（不够还息），直接拦截
      if (settleAmount > 0 && amount < settleAmount - 0.005) {
        Toast.show({
          content: `金额未达到结清金额 ¥${formatMoney(settleAmount)}（剩余本金 ¥${formatMoney(remainingP)} + 当期利息），请填结清金额或小于剩余本金的金额`,
        });
        return;
      }
      // 达到结清金额：弹窗确认直接结清
      Dialog.confirm({
        content:
          `提前还款金额 ¥${formatMoney(amount)}` +
          ` 已达到结清金额（¥${formatMoney(settleAmount || remainingP)}），` +
          '确认后将直接结清贷款，剩余计划将被删除。是否继续？',
        cancelText: '取消',
        okText: '确认结清',
        onConfirm: async () => {
          try {
            await loanApi.prepay(id, { amount, prepayDate, mode: prepayMode });
            Toast.show({ content: '已提前结清贷款' });
            setShowPrepay(false);
            setPrepayAmount('');
            invalidateFinancialData(queryClient);
          } catch (e: any) {
            Toast.show({ content: e.response?.data?.message ?? '提前结清失败' });
          }
        },
      });
      return;
    }
    // 低于剩余本金：部分提前还款，直接提交
    try {
      await loanApi.prepay(id, { amount, prepayDate, mode: prepayMode });
      Toast.show({ content: '已提前还款' });
      setShowPrepay(false);
      setPrepayAmount('');
      invalidateFinancialData(queryClient);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '提前还款失败' });
    }
  };

  // 进入编辑还款计划模式
  const startEditPlan = () => {
    if (!loan) return;
    // 若有已还期，额外确认
    const hasPaid = loan.repayments.some((r) => Number(r.paidAmount) > 0);
    const doStart = () => {
      setEditPeriods(
        loan.repayments.map((r): EditPlanRow => {
          if (r.kind === 'prepay') {
            return { kind: 'prepay', dueDate: r.dueDate.slice(0, 10), totalAmount: r.totalAmount };
          }
          const P = Number(r.principalAmount);
          const I = Number(r.interestAmount);
          // 历史合并期（本金/利息为 0 仅总额）：全额当本金回填，与后端口径一致
          if (P === 0 && I === 0) {
            return {
              kind: 'period',
              periodNo: r.periodNo,
              dueDate: r.dueDate.slice(0, 10),
              principal: r.totalAmount,
              interest: '0',
            };
          }
          return {
            kind: 'period',
            periodNo: r.periodNo,
            dueDate: r.dueDate.slice(0, 10),
            principal: r.principalAmount,
            interest: r.interestAmount,
          };
        }),
      );
      setEditingPlan(true);
    };
    if (hasPaid) {
      Dialog.confirm({
        content: '已有已还的期，修改已还期的金额可能导致还款状态变化，确认继续？',
        onConfirm: doStart,
      });
    } else {
      doStart();
    }
  };

  const saveEditPlan = async () => {
    // 校验（仅统计普通各期，提前还款条目不计入期数）
    if (editPeriods.filter((p) => p.kind === 'period').length !== loan?.termMonths) {
      Toast.show({ content: '期数不匹配' });
      return;
    }
    if (editPeriods.some((p) => !p.dueDate)) {
      Toast.show({ content: '请完整填写每期日期' });
      return;
    }
    for (const p of editPeriods) {
      if (p.kind === 'period' && (p.principal === '' || p.interest === '')) {
        Toast.show({ content: '请完整填写每期本金和利息' });
        return;
      }
      if (p.kind === 'prepay' && p.totalAmount === '') {
        Toast.show({ content: '请完整填写提前还款金额' });
        return;
      }
    }
    try {
      await loanApi.updateRepayments(
        id,
        editPeriods.map((p) =>
          p.kind === 'prepay'
            ? { kind: 'prepay' as const, dueDate: p.dueDate, totalAmount: Number(p.totalAmount) }
            : { kind: 'period' as const, dueDate: p.dueDate, principal: Number(p.principal), interest: Number(p.interest) },
        ),
      );
      Toast.show({ content: '已保存' });
      setEditingPlan(false);
      invalidateFinancialData(queryClient);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '保存失败' });
    }
  };

  if (!loan) return null;

  const isCustom = loan.repaymentMethod === 'custom';
  const remainingPrincipal = Number(loan.remainingPrincipal ?? 0);
  const remainingInterest = Number(loan.remainingInterest ?? 0);

  return (
    <div className="page">
      <NavBar onBack={() => navigate(-1)} style={{ background: '#fff' }}>
        {loan.name}
      </NavBar>

      <div style={{ padding: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', rowGap: 12, marginBottom: 12 }}>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>本金</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>¥{formatMoney(Number(loan.principal))}</div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>期数</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{loan.termMonths} 期</div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>年利率</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{loan.annualRate}%</div>
            </div>

            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>剩余未还本金</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1677ff' }}>
                ¥{formatMoney(remainingPrincipal)}
              </div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>剩余未还利息</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#faad14' }}>
                ¥{formatMoney(remainingInterest)}
              </div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>实际年利率</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1677ff' }}>
                {loan.actualAnnualRate != null ? `${loan.actualAnnualRate}%` : '—'}
              </div>
            </div>
          </div>
          <div className="text-secondary" style={{ fontSize: 13 }}>
            贷款日期 {loan.startDate.slice(0, 10)} · 每月 {loan.repaymentDay} 号还款 ·{' '}
            {loan.repaymentMethod === 'equal_installment' ? '等额本息' : loan.repaymentMethod === 'equal_principal' ? '等额本金' : loan.repaymentMethod === 'interest_first' ? '先息后本' : '自定义'}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* 已提前结清后不再提供提前还款 */}
            {!isViewer && loan.status !== 'paid_off' && (
              <Button size="mini" color="primary" onClick={() => setShowPrepay(true)}>提前还款</Button>
            )}
            {!isViewer && (
              <Button size="mini" fill="outline" onClick={() => navigate(`/loans/${id}/edit`)}>编辑贷款信息</Button>
            )}
            <Button size="mini" fill="outline" onClick={handleExportPlan}>导出计划</Button>
            {!isViewer && (
              <Button size="mini" fill="outline" color="danger" onClick={handleDeleteLoan}>删除</Button>
            )}
          </div>
        </div>

        {/* 还款计划标题 + 编辑计划按钮（仅自定义） */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontWeight: 600 }}>还款计划</span>
          {isCustom && !editingPlan && !isViewer && (
            <Button size="mini" color="primary" fill="outline" onClick={startEditPlan}>编辑计划</Button>
          )}
        </div>

        {/* 编辑模式：每期日期+金额可编辑 */}
        {editingPlan ? (
          <div style={{ background: '#fff', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            {editPeriods.map((p, i) => {
              const orig = loan.repayments[i];
              const isPaid = orig && Number(orig.paidAmount) > 0;
              const setRow = (patch: Partial<EditPlanRow>) =>
                setEditPeriods((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x) as EditPlanRow));
              if (p.kind === 'prepay') {
                return (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ width: 56, fontSize: 13, color: '#52c41a' }}>
                      提前还款
                    </span>
                    <div style={{ flex: 1 }}>
                      <DatePicker
                        value={p.dueDate ? new Date(p.dueDate) : new Date()}
                        onConfirm={(v) => {
                          const date = formatDate(v);
                          setRow({ dueDate: date });
                        }}
                      >
                        {(_value, actions) => (
                          <div onClick={() => actions.open()} style={{ background: '#f5f5f5', borderRadius: 6, padding: '8px 10px', fontSize: 13 }}>
                            {p.dueDate || '日期'}
                          </div>
                        )}
                      </DatePicker>
                    </div>
                    <div style={{ flex: 1 }}>
                      <Input
                        type="number"
                        placeholder="金额"
                        value={p.totalAmount}
                        onChange={(v) => setRow({ totalAmount: v })}
                        style={{ background: '#f5f5f5', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
                      />
                    </div>
                  </div>
                );
              }
              return (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ width: 56, fontSize: 13, color: '#666' }}>
                      第{p.periodNo}期{isPaid ? '✓' : ''}
                    </span>
                    <div style={{ flex: 1 }}>
                      <DatePicker
                        value={p.dueDate ? new Date(p.dueDate) : new Date()}
                        onConfirm={(v) => {
                          const date = formatDate(v);
                          setRow({ dueDate: date });
                        }}
                      >
                        {(_value, actions) => (
                          <div onClick={() => actions.open()} style={{ background: '#f5f5f5', borderRadius: 6, padding: '8px 10px', fontSize: 13 }}>
                            {p.dueDate || '日期'}
                          </div>
                        )}
                      </DatePicker>
                    </div>
                    <span style={{ fontSize: 12, color: '#666' }}>本金</span>
                    <Input
                      type="number"
                      placeholder="本金"
                      value={p.principal}
                      onChange={(v) => setRow({ principal: v })}
                      style={{ width: 70, background: '#f5f5f5', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
                    />
                    <span style={{ fontSize: 12, color: '#666' }}>利息</span>
                    <Input
                      type="number"
                      placeholder="利息"
                      value={p.interest}
                      onChange={(v) => setRow({ interest: v })}
                      style={{ width: 70, background: '#f5f5f5', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
                    />
                  </div>
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button block fill="outline" onClick={() => setEditingPlan(false)}>取消</Button>
              <Button block color="primary" onClick={saveEditPlan}>保存</Button>
            </div>
          </div>
        ) : (
          <List style={{ borderRadius: 12, overflow: 'hidden' }}>
            {/* 贷款（第一笔） */}
            <List.Item
              key="disburse"
              description={
                <div style={{ fontSize: 12, marginTop: 2 }}>
                  贷款
                  <span style={{ marginLeft: 8 }}>{loan.startDate.slice(0, 10)}</span>
                </div>
              }
              extra={
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600, color: '#52c41a' }}>+¥{formatMoney(Number(loan.principal))}</div>
                </div>
              }
            >
              放款
            </List.Item>
            {loan.repayments.map((r) => {
              if (r.kind === 'prepay') {
                return (
                  <List.Item
                    key={r.id}
                    description={
                      <div style={{ fontSize: 12, marginTop: 2 }}>
                        提前还本金
                        <span style={{ marginLeft: 8 }}>{r.dueDate.slice(0, 10)}</span>
                      </div>
                    }
                    extra={
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 600, color: '#52c41a' }}>
                          ¥{formatMoney(Number(r.totalAmount))}
                        </div>
                        <div style={{ fontSize: 12, color: '#52c41a' }}>已还</div>
                      </div>
                    }
                  >
                    <span style={{ color: '#52c41a', fontWeight: 600 }}>
                      {r.note ?? '提前还款'}
                    </span>
                  </List.Item>
                );
              }
              const st = STATUS_MAP[r.status] ?? STATUS_MAP.pending;
              const remain = Number(r.totalAmount) - Number(r.paidAmount);
              const isMerged = isCustom && Number(r.principalAmount) === 0 && Number(r.interestAmount) === 0;
              return (
                <List.Item
                  key={r.periodNo}
                  description={
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      {isMerged
                        ? <>合计 ¥{formatMoney(Number(r.totalAmount))}</>
                        : <>本金 ¥{formatMoney(Number(r.principalAmount))} · 利息 ¥{formatMoney(Number(r.interestAmount))}</>}
                      <span style={{ marginLeft: 8 }}>{r.dueDate.slice(0, 10)}</span>
                    </div>
                  }
                  extra={
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600 }}>¥{formatMoney(Number(r.totalAmount))}</div>
                      <div style={{ fontSize: 12, color: st.color }}>{st.label}</div>
                    </div>
                  }
                >
                  第 {r.periodNo} 期
                  {!isViewer && r.status !== 'paid' && r.status !== 'overdue' && (
                    <Button
                      size="mini"
                      color="primary"
                      fill="none"
                      style={{ marginLeft: 8 }}
                      onClick={(e) => { e.stopPropagation(); setPaying(r); setPayAmount(String(Math.max(remain, 0))); }}
                    >
                      还款
                    </Button>
                  )}
                  {!isViewer && (r.status === 'paid' || r.status === 'partial') && (
                    <Button size="mini" fill="none" style={{ marginLeft: 8 }} onClick={(e) => { e.stopPropagation(); handleUndo(r); }}>
                      撤销
                    </Button>
                  )}
                </List.Item>
              );
            })}
          </List>
        )}
      </div>

      <Popup
        visible={!!paying}
        onMaskClick={() => setPaying(null)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 8 }}>第 {paying?.periodNo} 期还款</h3>
          <div className="text-secondary" style={{ fontSize: 13, marginBottom: 16 }}>
            应还 ¥{paying ? formatMoney(Number(paying.totalAmount) - Number(paying.paidAmount)) : '0.00'}
          </div>
          <Input
            type="number"
            placeholder="还款金额"
            value={payAmount}
            onChange={setPayAmount}
            style={{ fontSize: 24, marginBottom: 16 }}
          />
          <Button block color="primary" onClick={handlePay}>确认还款</Button>
        </div>
      </Popup>

      {/* 提前还款弹窗 */}
      <Popup
        visible={showPrepay}
        onMaskClick={() => setShowPrepay(false)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>提前还款</h3>
          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>还款日期</div>
            <DatePicker
              precision="day"
              value={new Date(prepayDate)}
              onConfirm={(v) => v && setPrepayDate(formatDate(v))}
            >
              {(value, actions) => (
                <div onClick={() => actions.open()} style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}>
                  {value ? formatDate(value) : '选择日期'}
                </div>
              )}
            </DatePicker>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>提前还款金额{isCustom ? '' : '（本金）'}</div>
            <Input
              type="number"
              placeholder="提前还的本金金额"
              value={prepayAmount}
              onChange={setPrepayAmount}
              style={{ fontSize: 20 }}
            />
          </div>
          {showPrepayMode && (
            <div style={{ marginBottom: 16 }}>
              <div className="text-secondary" style={{ fontSize: 13, marginBottom: 8 }}>提前还款方式</div>
              <Radio.Group
                value={prepayMode}
                onChange={(v) => setPrepayMode(v as 'reduce_payment' | 'reduce_term')}
              >
                <Radio value="reduce_payment" style={{ marginRight: 20 }}>降低月供</Radio>
                <Radio value="reduce_term">缩短期限</Radio>
              </Radio.Group>
              <div className="text-secondary" style={{ fontSize: 12, marginTop: 6 }}>
                {prepayMode === 'reduce_term'
                  ? '每月还款额不变，还款期数减少，节省利息更多'
                  : '还款期数不变，每期还款额降低'}
              </div>
            </div>
          )}
          <div className="text-secondary" style={{ fontSize: 12, marginBottom: 16 }}>
            {isCustom ? (
              <>记一笔提前还款，不改变剩余计划，也不自动结清。</>
            ) : (
              <>
                小于剩余本金时重算后续计划；等于或大于剩余本金时提前结清。
                提前还款将按天收取截至还款日的当期利息
                {prepayEstimate && prepayEstimate.interest > 0 && (
                  <>（约 ¥{formatMoney(prepayEstimate.interest)}）</>
                )}
                {prepayEstimate && prepayEstimate.interest > 0 && (
                  <span style={{ color: '#1677ff', fontWeight: 600 }}>
                    ，本次合计约 ¥{formatMoney(prepayEstimate.total)}
                    {prepayEstimate.isFull ? '（含结清）' : ''}
                  </span>
                )}
              </>
            )}
          </div>
          <Button block color="primary" onClick={handlePrepay}>确认提前还款</Button>
        </div>
      </Popup>
    </div>
  );
}
