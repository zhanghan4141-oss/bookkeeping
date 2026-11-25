import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, NavBar, ProgressBar } from 'antd-mobile';
import { AddOutline } from 'antd-mobile-icons';
import { expensePlanApi } from '../api/expense';
import type { ExpensePlan } from '../types';
import { formatMoney } from '../lib/format';

const FREQUENCY_LABEL: Record<string, string> = {
  month: '月付',
  quarter: '季付',
  year: '年付',
};

function progress(plan: ExpensePlan) {
  return plan.totalCount > 0
    ? Math.round((plan.paidCount / plan.totalCount) * 100)
    : 0;
}

/** 勾选支出计划的汇总（默认全选统计所有计划） */
function computeTotals(plans: ExpensePlan[]) {
  let totalPlan = 0;
  let totalPaid = 0;
  let totalRemaining = 0;
  for (const p of plans) {
    totalPlan += Number(p.periodAmount) * p.totalCount;
    totalPaid += Number(p.totalPaid ?? 0);
    totalRemaining += Number(p.totalRemaining ?? 0);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    totalPlan: round(totalPlan),
    totalPaid: round(totalPaid),
    totalRemaining: round(totalRemaining),
  };
}

export default function ExpensePlans() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const pageRef = useRef<HTMLDivElement>(null);

  const { data: plans = [] } = useQuery({
    queryKey: ['expense-plans', id],
    queryFn: async () => (await expensePlanApi.list(id)).data as ExpensePlan[],
  });

  // 勾选统计的计划：默认全选
  const [selected, setSelected] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (selected === null && plans.length > 0) {
      setSelected(new Set(plans.map((p) => p.id)));
    }
  }, [selected, plans]);

  const toggle = (planId: string) => {
    setSelected((prev) => {
      const next = new Set(prev ?? plans.map((p) => p.id));
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  };
  const selectedSet = selected ?? new Set<string>();

  const sortedPlans = [...plans].sort((a, b) =>
    (b.startDate ?? '').localeCompare(a.startDate ?? ''),
  );

  const totals = computeTotals(plans.filter((p) => selectedSet.has(p.id)));

  return (
    <div className="page" ref={pageRef}>
      <NavBar onBack={() => navigate(-1)} style={{ background: 'var(--card)' }}>
        支出管理
      </NavBar>

      <div style={{ padding: 16 }}>
        {/* 统计栏：计划总额 / 已支出 / 待支出 */}
        <div
          style={{
            background: 'var(--card)',
            borderRadius: 12,
            padding: '12px 0',
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex' }}>
            <div style={{ width: '50%', textAlign: 'center' }}>
              <div className="text-secondary" style={{ fontSize: 12 }}>计划总额</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--primary)' }}>
                ¥{formatMoney(totals.totalPlan)}
              </div>
            </div>
            <div style={{ width: '50%', textAlign: 'center' }}>
              <div className="text-secondary" style={{ fontSize: 12 }}>已支出</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--income)' }}>
                ¥{formatMoney(totals.totalPaid)}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', marginTop: 8 }}>
            <div style={{ width: '50%', textAlign: 'center' }}>
              <div className="text-secondary" style={{ fontSize: 12 }}>待支出</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#ff8f1f' }}>
                ¥{formatMoney(totals.totalRemaining)}
              </div>
            </div>
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
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            统计 <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{selectedSet.size}</span>/{plans.length} 个计划
          </span>
          <Button size="mini" color="success" onClick={() => navigate(`/ledgers/${id}/expense-plans/new`)}>
            <AddOutline /> 添加支出计划
          </Button>
        </div>

        {sortedPlans.map((plan) => {
          const p = progress(plan);
          const termText = plan.termCount > 0 ? `${plan.termCount} 期` : '不限';
          return (
            <div
              key={plan.id}
              onClick={() => navigate(`/expense-plans/${plan.id}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 12px',
                borderRadius: 12,
                background: 'var(--card)',
                cursor: 'pointer',
                marginBottom: 8,
              }}
            >
              <input
                type="checkbox"
                checked={selectedSet.has(plan.id)}
                onChange={() => toggle(plan.id)}
                onClick={(e) => e.stopPropagation()}
                style={{ marginRight: 10, width: 18, height: 18, flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                  <span>{plan.name}</span>
                  <span style={{ fontSize: 12, color: '#ff8f1f', marginLeft: 8 }}>
                    （{plan.startDate?.slice(0, 10)}）
                  </span>
                </div>
                <div className="text-secondary" style={{ fontSize: 12 }}>
                  每期 <span style={{ fontWeight: 600, color: 'var(--text)' }}>¥{formatMoney(Number(plan.periodAmount))}</span> · {FREQUENCY_LABEL[plan.frequency]} · <span style={{ fontWeight: 600, color: 'var(--text)' }}>{termText}</span>
                </div>
                <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>
                  已支出 <span style={{ fontWeight: 600, color: 'var(--text)' }}>¥{formatMoney(plan.totalPaid)}</span> · 待支出 <span style={{ fontWeight: 600, color: 'var(--text)' }}>¥{formatMoney(plan.totalRemaining)}</span>
                </div>
                <ProgressBar percent={p} style={{ '--track-width': '4px', marginTop: 6 }} />
              </div>
              <span style={{ color: plan.status === 'completed' ? 'var(--income)' : plan.status === 'closed' ? 'var(--text-muted)' : 'var(--primary)' }}>
                {plan.status === 'completed' ? '已完成' : plan.status === 'closed' ? '已关闭' : '进行中'}
              </span>
            </div>
          );
        })}
        {plans.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: 24,
              color: 'var(--text-muted)',
              borderRadius: 12,
              background: 'var(--card)',
            }}
          >
            点击右上角添加第一个支出计划
          </div>
        )}
      </div>
    </div>
  );
}