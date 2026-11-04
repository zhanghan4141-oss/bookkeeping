import { useQuery } from '@tanstack/react-query';
import { NavBar } from 'antd-mobile';
import { repaymentApi } from '../api/misc';

export default function Repayments() {
  const { data } = useQuery({
    queryKey: ['repayments', 'upcoming', 30],
    queryFn: async () => (await repaymentApi.upcoming(30)).data,
  });

  return (
    <div className="page">
      <NavBar back={null} style={{ background: '#fff' }}>
        还款计划
      </NavBar>

      <div style={{ padding: 16 }}>
        <div
          style={{
            background: 'linear-gradient(135deg, #722ed1, #b37feb)',
            borderRadius: 12,
            color: '#fff',
            padding: '20px',
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 13, opacity: 0.9 }}>未来 30 天待还总额</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>¥{(data?.totalAmount ?? 0).toFixed(2)}</div>
        </div>

        {data?.daily?.map((d: any) => (
          <div key={d.date} style={{ background: '#fff', borderRadius: 12, padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>{d.date}</span>
              <span style={{ fontWeight: 700, color: '#ff4d4f' }}>¥{d.total.toFixed(2)}</span>
            </div>
            {d.items.map((it: any) => (
              <div key={it.repaymentId} style={{ fontSize: 13, color: '#666', padding: '4px 0' }}>
                {it.loanName} 第{it.periodNo}期 · 剩余 ¥{it.remain.toFixed(2)}
                <span style={{ marginLeft: 6, color: it.status === 'overdue' ? '#ff4d4f' : '#999' }}>
                  {it.status === 'overdue' ? '逾期' : it.status === 'partial' ? '部分还' : '待还'}
                </span>
              </div>
            ))}
          </div>
        ))}
        {!data?.daily?.length && (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>未来 30 天暂无待还款</div>
        )}
      </div>
    </div>
  );
}
