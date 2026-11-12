import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Dialog, Input, List, NavBar, Popup, Toast } from 'antd-mobile';
import { loanApi } from '../api/loan';
import { ledgerApi } from '../api/ledger';
import { invalidateFinancialData } from '../lib/invalidate';
import { formatMoney } from '../lib/format';
import type { Ledger, Loan, LoanRepayment } from '../types';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待还', color: '#1677ff' },
  partial: { label: '部分还', color: '#faad14' },
  paid: { label: '已还', color: '#52c41a' },
  overdue: { label: '逾期', color: '#ff4d4f' },
};

export default function LoanDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<LoanRepayment | null>(null);
  const [payAmount, setPayAmount] = useState('');
  // 提前还款状态
  const [showPrepay, setShowPrepay] = useState(false);
  const [prepayAmount, setPrepayAmount] = useState('');
  const [prepayDate, setPrepayDate] = useState(() => new Date().toISOString().slice(0, 10));
  // 编辑还款计划状态
  const [editingPlan, setEditingPlan] = useState(false);
  const [editPeriods, setEditPeriods] = useState<{ dueDate: string; totalAmount: string }[]>([]);

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
    if (!prepayAmount || amount < 0) {
      Toast.show({ content: '请输入提前还款金额' });
      return;
    }
    if (!prepayDate) {
      Toast.show({ content: '请选择还款日期' });
      return;
    }
    try {
      await loanApi.prepay(id, { amount, prepayDate });
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
        loan.repayments.map((r) => ({
          dueDate: r.dueDate.slice(0, 10),
          totalAmount: r.totalAmount,
        })),
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
    // 校验
    if (editPeriods.length !== loan?.termMonths) {
      Toast.show({ content: '期数不匹配' });
      return;
    }
    if (editPeriods.some((p) => !p.dueDate || !p.totalAmount)) {
      Toast.show({ content: '请完整填写每期日期和金额' });
      return;
    }
    try {
      await loanApi.updateRepayments(
        id,
        editPeriods.map((p) => ({ dueDate: p.dueDate, totalAmount: Number(p.totalAmount) })),
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
              <div className="text-secondary" style={{ fontSize: 12 }}>
                {isCustom ? '剩余未还本息' : '剩余未还本金'}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1677ff' }}>
                ¥{formatMoney(isCustom ? remainingPrincipal + remainingInterest : remainingPrincipal)}
              </div>
            </div>
            <div>
              {!isCustom && (
                <>
                  <div className="text-secondary" style={{ fontSize: 12 }}>剩余未还利息</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#faad14' }}>
                    ¥{formatMoney(remainingInterest)}
                  </div>
                </>
              )}
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>实际年利率</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1677ff' }}>
                {loan.actualAnnualRate != null ? `${loan.actualAnnualRate}%` : '—'}
              </div>
            </div>
          </div>
          <div className="text-secondary" style={{ fontSize: 13 }}>
            {loan.direction === 'lend' ? '我借入（应还）' : '我借出（应收）'} · 每月 {loan.repaymentDay} 号还款 ·{' '}
            {loan.repaymentMethod === 'equal_installment' ? '等额本息' : loan.repaymentMethod === 'equal_principal' ? '等额本金' : loan.repaymentMethod === 'interest_first' ? '先息后本' : '自定义'}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!isViewer && (
              <>
                <Button size="mini" color="primary" onClick={() => setShowPrepay(true)}>提前还款</Button>
                <Button size="mini" fill="outline" onClick={() => navigate(`/loans/${id}/edit`)}>编辑贷款信息</Button>
              </>
            )}
            <Button size="mini" fill="outline" onClick={() => { window.open(`/api/loans/${id}/export`, '_blank'); }}>导出计划</Button>
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
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ width: 50, fontSize: 13, color: '#666' }}>
                    第{i + 1}期{isPaid ? '✓' : ''}
                  </span>
                  <div style={{ flex: 1 }}>
                    <DatePicker
                      value={p.dueDate ? new Date(p.dueDate) : new Date()}
                      onConfirm={(v) => {
                        const date = v.toISOString().slice(0, 10);
                        setEditPeriods((prev) => prev.map((x, j) => (j === i ? { ...x, dueDate: date } : x)));
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
                      onChange={(v) => setEditPeriods((prev) => prev.map((x, j) => (j === i ? { ...x, totalAmount: v } : x)))}
                      style={{ background: '#f5f5f5', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
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
              return (
                <List.Item
                  key={r.periodNo}
                  description={
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      本金 ¥{formatMoney(Number(r.principalAmount))} · 利息 ¥{formatMoney(Number(r.interestAmount))}
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
              onConfirm={(v) => v && setPrepayDate(v.toISOString().slice(0, 10))}
            >
              {(value, actions) => (
                <div onClick={() => actions.open()} style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}>
                  {value ? value.toISOString().slice(0, 10) : '选择日期'}
                </div>
              )}
            </DatePicker>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>提前还款金额（本金）</div>
            <Input
              type="number"
              placeholder="提前还的本金金额"
              value={prepayAmount}
              onChange={setPrepayAmount}
              style={{ fontSize: 20 }}
            />
          </div>
          <div className="text-secondary" style={{ fontSize: 12, marginBottom: 16 }}>
            小于剩余本金时重算后续每期金额；等于或大于剩余本金时提前结清贷款
          </div>
          <Button block color="primary" onClick={handlePrepay}>确认提前还款</Button>
        </div>
      </Popup>
    </div>
  );
}
