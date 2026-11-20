import { useEffect, useRef, useState } from 'react';
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
  return {
    totalLoan: Math.round(totalLoan * 100) / 100,
    totalRemainingPrincipal: Math.round(totalRemainingPrincipal * 100) / 100,
    totalRemainingInterest: Math.round(totalRemainingInterest * 100) / 100,
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
        {/* 统计栏：总贷款余额 / 总待还本金 / 总待还利息 */}
        <div
          style={{
            display: 'flex',
            background: '#fff',
            borderRadius: 12,
            padding: '12px 0',
            marginBottom: 8,
          }}
        >
          {[
            { label: '总贷款余额', value: totals.totalLoan },
            { label: '总待还本金', value: totals.totalRemainingPrincipal },
            { label: '总待还利息', value: totals.totalRemainingInterest },
          ].map((s) => (
            <div key={s.label} style={{ width: '33.3%', textAlign: 'center' }}>
              <div className="text-secondary" style={{ fontSize: 12 }}>{s.label}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1677ff' }}>
                ¥{formatMoney(s.value)}
              </div>
            </div>
          ))}
        </div>

        {/* 筛选行（账本页同款勾选格式，默认全选） */}
        <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
          统计 {selectedSet.size}/{loans.length} 笔贷款
        </div>

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
                prefix={
                  <input
                    type="checkbox"
                    checked={selectedSet.has(loan.id)}
                    onChange={() => toggle(loan.id)}
                    // 停止冒泡，避免勾选操作同时触发行点击进入详情
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginRight: 10, width: 18, height: 18, flexShrink: 0 }}
                  />
                }
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