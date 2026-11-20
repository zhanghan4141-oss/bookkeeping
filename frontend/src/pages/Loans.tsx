import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, NavBar, ProgressBar } from 'antd-mobile';
import { AddOutline } from 'antd-mobile-icons';
import { loanApi } from '../api/loan';
import type { Loan } from '../types';
import { formatMoney } from '../lib/format';

function progress(loan: Loan) {
  const total = loan.repayments.reduce((s, r) => s + Number(r.totalAmount), 0);
  const paid = loan.repayments.reduce((s, r) => s + Number(r.paidAmount), 0);
  return total > 0 ? Math.round((paid / total) * 100) : 0;
}

/** 勾选贷款的汇总（默认全选统计所有贷款） */
function computeTotals(loans: Loan[]) {
  let totalLoan = 0;
  let totalRemainingPrincipal = 0;
  let totalRemainingInterest = 0;
  for (const l of loans) {
    totalLoan += Number(l.principal ?? 0);
    totalRemainingPrincipal += Number(l.remainingPrincipal ?? 0);
    totalRemainingInterest += Number(l.remainingInterest ?? 0);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    totalLoan: round(totalLoan),
    totalRemaining: round(totalRemainingPrincipal + totalRemainingInterest),
    totalRemainingPrincipal: round(totalRemainingPrincipal),
    totalRemainingInterest: round(totalRemainingInterest),
  };
}

export default function Loans() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const pageRef = useRef<HTMLDivElement>(null);

  const { data: loans = [] } = useQuery({
    queryKey: ['loans', id],
    queryFn: async () => (await loanApi.list(id)).data as Loan[],
  });

  // 勾选统计的贷款：默认全选，不持久化（null = 尚未初始化）
  const [selected, setSelected] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (selected === null && loans.length > 0) {
      setSelected(new Set(loans.map((l) => l.id)));
    }
  }, [selected, loans]);

  const toggle = (loanId: string) => {
    setSelected((prev) => {
      const next = new Set(prev ?? loans.map((l) => l.id));
      if (next.has(loanId)) next.delete(loanId);
      else next.add(loanId);
      return next;
    });
  };
  const selectedSet = selected ?? new Set<string>();

  const totals = computeTotals(loans.filter((l) => selectedSet.has(l.id)));

  return (
    <div className="page" ref={pageRef}>
      <NavBar onBack={() => navigate(-1)} style={{ background: '#fff' }}>
        贷款管理
      </NavBar>

      <div style={{ padding: 16 }}>
        {/* 统计栏：总贷款金额 / 总待还 / 总待还本金 / 总待还利息（各色数字） */}
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: '12px 0',
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex' }}>
            {[
              { label: '总贷款金额', value: totals.totalLoan, color: '#1677ff' },
              { label: '总待还', value: totals.totalRemaining, color: '#ff8f1f' },
              { label: '总待还本金', value: totals.totalRemainingPrincipal, color: '#52c41a' },
              { label: '总待还利息', value: totals.totalRemainingInterest, color: '#faad14' },
            ].map((s) => (
              <div key={s.label} style={{ width: '25%', textAlign: 'center' }}>
                <div className="text-secondary" style={{ fontSize: 12 }}>{s.label}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: s.color }}>
                  ¥{formatMoney(s.value)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 13, color: '#999' }}>
            统计 <span style={{ color: '#1677ff', fontWeight: 600 }}>{selectedSet.size}</span>/{loans.length} 笔贷款
          </span>
          <Button size="mini" color="primary" onClick={() => navigate(`/ledgers/${id}/loans/new`)}>
            <AddOutline /> 添加贷款
          </Button>
        </div>

        {loans.map((loan) => {
            const p = progress(loan);
            return (
              <div
                key={loan.id}
                onClick={() => navigate(`/loans/${loan.id}`)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: '#fff',
                  cursor: 'pointer',
                  marginBottom: 8,
                }}
              >
                {/* 与账本页一致的勾选框：贴行左上，点击范围覆盖勾选框本身 */}
                <input
                  type="checkbox"
                  checked={selectedSet.has(loan.id)}
                  onChange={() => toggle(loan.id)}
                  // 停止冒泡，避免勾选操作同时触发行点击进入详情
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginRight: 10, width: 18, height: 18, flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'baseline' }}>
                    <span>{loan.name}</span>
                    <span style={{ fontSize: 12, color: '#ff8f1f', marginLeft: 8 }}>
                      贷款日期 {loan.startDate?.slice(0, 10)}
                    </span>
                  </div>
                  <div className="text-secondary" style={{ fontSize: 12 }}>
                    本金 <span style={{ fontWeight: 600, color: '#000' }}>¥{formatMoney(Number(loan.principal))}</span> · 年利率 <span style={{ fontWeight: 600, color: '#000' }}>{loan.annualRate}%</span> · <span style={{ fontWeight: 600, color: '#000' }}>{loan.termMonths}期</span>
                  </div>
                  <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>
                    剩余本金 <span style={{ fontWeight: 600, color: '#000' }}>¥{formatMoney(loan.remainingPrincipal ?? 0)}</span> · 剩余利息 <span style={{ fontWeight: 600, color: '#000' }}>¥{formatMoney(loan.remainingInterest ?? 0)}</span>
                  </div>
                  <ProgressBar percent={p} style={{ '--track-width': '4px', marginTop: 6 }} />
                </div>
                <span style={{ color: loan.status === 'paid_off' ? '#52c41a' : loan.status === 'closed' ? '#999' : '#1677ff' }}>
                  {loan.status === 'paid_off' ? '已还清' : loan.status === 'closed' ? '已关闭' : '进行中'}
                </span>
              </div>
            );
          })}
          {loans.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: 24,
                color: '#999',
                borderRadius: 12,
                background: '#fff',
              }}
            >
              点击右上角添加第一笔贷款
            </div>
          )}
      </div>
    </div>
  );
}