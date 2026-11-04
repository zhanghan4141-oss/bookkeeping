import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Dialog, List, NavBar, Popup, Input, Toast } from 'antd-mobile';
import { loanApi } from '../api/loan';
import type { Loan, LoanRepayment } from '../types';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待还', color: '#1677ff' },
  partial: { label: '部分还', color: '#faad14' },
  paid: { label: '已还', color: '#52c41a' },
  overdue: { label: '逾期', color: '#ff4d4f' },
};

export default function LoanDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [paying, setPaying] = useState<LoanRepayment | null>(null);
  const [payAmount, setPayAmount] = useState('');

  const { data: loan, refetch } = useQuery({
    queryKey: ['loan', id],
    queryFn: async () => (await loanApi.get(id)).data as Loan,
  });

  const handlePay = async () => {
    if (!paying) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      Toast.show({ content: '请输入金额' });
      return;
    }
    try {
      await loanApi.pay(id, paying.periodNo, { amount });
      Toast.show({ content: '已登记还款' });
      setPaying(null);
      setPayAmount('');
      refetch();
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
      refetch();
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '操作失败' });
    }
  };

  if (!loan) return null;

  return (
    <div className="page">
      <NavBar onBack={() => navigate(-1)} style={{ background: '#fff' }}>
        {loan.name}
      </NavBar>

      <div style={{ padding: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>本金</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>¥{Number(loan.principal).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>年利率</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{loan.annualRate}%</div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>期数</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{loan.termMonths} 期</div>
            </div>
          </div>
          <div className="text-secondary" style={{ fontSize: 13 }}>
            {loan.direction === 'lend' ? '我借入（应还）' : '我借出（应收）'} · 每月 {loan.repaymentDay} 号还款 ·{' '}
            {loan.repaymentMethod === 'equal_installment' ? '等额本息' : loan.repaymentMethod === 'equal_principal' ? '等额本金' : loan.repaymentMethod === 'interest_first' ? '先息后本' : '自定义'}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <Button size="mini" fill="outline" onClick={() => navigate(`/loans/${id}/edit`)}>编辑</Button>
            <Button size="mini" fill="outline" onClick={() => { window.open(`/api/loans/${id}/export`, '_blank'); }}>导出计划</Button>
          </div>
        </div>

        <div style={{ fontWeight: 600, marginBottom: 8 }}>还款计划</div>
        <List style={{ borderRadius: 12, overflow: 'hidden' }}>
          {loan.repayments.map((r) => {
            const st = STATUS_MAP[r.status] ?? STATUS_MAP.pending;
            const remain = Number(r.totalAmount) - Number(r.paidAmount);
            return (
              <List.Item
                key={r.periodNo}
                description={
                  <div style={{ fontSize: 12, marginTop: 2 }}>
                    本金 ¥{Number(r.principalAmount).toFixed(2)} · 利息 ¥{Number(r.interestAmount).toFixed(2)}
                    <span style={{ marginLeft: 8 }}>{r.dueDate.slice(0, 10)}</span>
                  </div>
                }
                extra={
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>¥{Number(r.totalAmount).toFixed(2)}</div>
                    <div style={{ fontSize: 12, color: st.color }}>{st.label}</div>
                  </div>
                }
              >
                第 {r.periodNo} 期
                {r.status !== 'paid' && r.status !== 'overdue' && (
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
                {(r.status === 'paid' || r.status === 'partial') && (
                  <Button size="mini" fill="none" style={{ marginLeft: 8 }} onClick={(e) => { e.stopPropagation(); handleUndo(r); }}>
                    撤销
                  </Button>
                )}
              </List.Item>
            );
          })}
        </List>
      </div>

      <Popup
        visible={!!paying}
        onMaskClick={() => setPaying(null)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 8 }}>第 {paying?.periodNo} 期还款</h3>
          <div className="text-secondary" style={{ fontSize: 13, marginBottom: 16 }}>
            应还 ¥{paying ? (Number(paying.totalAmount) - Number(paying.paidAmount)).toFixed(2) : '0.00'}
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
    </div>
  );
}
