import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, List, NavBar, ProgressBar } from 'antd-mobile';
import { AddOutline } from 'antd-mobile-icons';
import { loanApi } from '../api/loan';
import type { Loan } from '../types';
import { formatMoney } from '../lib/format';

function progress(loan: Loan) {
  const total = loan.repayments.reduce((s, r) => s + Number(r.totalAmount), 0);
  const paid = loan.repayments.reduce((s, r) => s + Number(r.paidAmount), 0);
  return total > 0 ? Math.round((paid / total) * 100) : 0;
}

export default function Loans() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const { data: loans = [] } = useQuery({
    queryKey: ['loans', id],
    queryFn: async () => (await loanApi.list(id)).data as Loan[],
  });

  return (
    <div className="page">
      <NavBar onBack={() => navigate(-1)} style={{ background: '#fff' }}>
        贷款管理
      </NavBar>

      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Button size="mini" color="primary" onClick={() => navigate(`/ledgers/${id}/loans/new`)}>
            <AddOutline /> 添加贷款
          </Button>
        </div>

        <List style={{ borderRadius: 12, overflow: 'hidden' }}>
          {loans.map((loan) => {
            const p = progress(loan);
            return (
              <List.Item
                key={loan.id}
                onClick={() => navigate(`/loans/${loan.id}`)}
                description={
                  <div style={{ marginTop: 4 }}>
                    <div className="text-secondary" style={{ fontSize: 12 }}>
                      本金 ¥{formatMoney(Number(loan.principal))} · 年利率 {loan.annualRate}% · {loan.termMonths}期
                    </div>
                    <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>
                      剩余本金 ¥{formatMoney(loan.remainingPrincipal ?? 0)} · 剩余利息 ¥{formatMoney(loan.remainingInterest ?? 0)}
                    </div>
                    <ProgressBar percent={p} style={{ '--track-width': '4px', marginTop: 6 }} />
                  </div>
                }
                extra={
                  <span style={{ color: loan.status === 'paid_off' ? '#52c41a' : loan.status === 'closed' ? '#999' : '#1677ff' }}>
                    {loan.status === 'paid_off' ? '已还清' : loan.status === 'closed' ? '已关闭' : '进行中'}
                  </span>
                }
              >
                {loan.name}
              </List.Item>
            );
          })}
          {loans.length === 0 && (
            <List.Item description="点击右上角添加第一笔贷款">暂无贷款</List.Item>
          )}
        </List>
      </div>
    </div>
  );
}
