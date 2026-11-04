// 端到端测试脚本：用 Node 原生 fetch 发送 UTF-8 请求，验证后端全链路
const BASE = 'http://127.0.0.1:3000/api';

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  const email = `e2e_${Date.now()}@test.com`;
  console.log('=== 1. 注册 ===');
  let r = await req('POST', '/auth/register', { email, password: '123456', nickname: '端到端测试' });
  console.log('注册:', r.status, r.data.user?.nickname, r.data.user?.email);
  const token = r.data.accessToken;

  console.log('=== 2. 建日常账本 ===');
  r = await req('POST', '/ledgers', { name: '家庭日常', type: 'daily' }, token);
  console.log('账本:', r.status, r.data.name, r.data.type);
  const dailyId = r.data.id;

  console.log('=== 3. 建贷款账本 ===');
  r = await req('POST', '/ledgers', { name: '我的贷款', type: 'loan' }, token);
  console.log('账本:', r.status, r.data.name, r.data.type);
  const loanLedgerId = r.data.id;

  console.log('=== 4. 查类别（贷款账本应有内置类别）===');
  r = await req('GET', `/ledgers/${loanLedgerId}/categories`, null, token);
  console.log('类别:', r.data.map((c) => `${c.name}(${c.type})`).join(', '));

  console.log('=== 5. 记一笔流水 ===');
  r = await req('GET', `/ledgers/${dailyId}/categories`, null, token);
  const cat = r.data.find((c) => c.type === 'expense');
  r = await req('POST', '/transactions', {
    ledgerId: dailyId, categoryId: cat.id, type: 'expense', amount: 88.5, note: '午饭', occurredAt: new Date().toISOString(),
  }, token);
  console.log('流水:', r.status, r.data.type, r.data.amount, r.data.note);

  console.log('=== 6. 建贷款（等额本息 10万/4.9%/12期）===');
  r = await req('POST', '/loans', {
    ledgerId: loanLedgerId, name: '房贷', direction: 'lend', principal: 100000, annualRate: 4.9,
    startDate: '2026-01-01', termMonths: 12, repaymentDay: 10, repaymentMethod: 'equal_installment',
  }, token);
  console.log('贷款:', r.status, r.data.name, '期数', r.data.repayments?.length);
  const loanId = r.data.id;
  const first = r.data.repayments[0];
  console.log('第1期: 本金', first.principalAmount, '利息', first.interestAmount, '合计', first.totalAmount, '到期', first.dueDate);

  console.log('=== 7. 等额本息手算验证 ===');
  // 月供 = P*r*(1+r)^n/((1+r)^n-1), P=100000, r=0.049/12, n=12
  const P = 100000, rate = 0.049 / 12, n = 12;
  const f = Math.pow(1 + rate, n);
  const monthly = P * rate * f / (f - 1);
  console.log('理论月供 ≈', monthly.toFixed(2), '实际合计', first.totalAmount, '本金+利息', (Number(first.principalAmount) + Number(first.interestAmount)).toFixed(2));

  console.log('=== 8. 每日还款汇总 ===');
  r = await req('GET', '/repayments/upcoming?days=30', null, token);
  console.log('30天待还总额:', r.data.totalAmount, '天数:', r.data.daily?.length);

  console.log('=== 9. 标记第1期还款 ===');
  r = await req('POST', `/loans/${loanId}/repayments/1/pay`, { amount: Number(first.totalAmount) }, token);
  console.log('还款后状态:', r.status, r.data.status, '已还', r.data.paidAmount);

  console.log('=== 10. 多账本统计 ===');
  r = await req('GET', '/stats/summary?ledgerIds=' + [dailyId, loanLedgerId].join(','), null, token);
  console.log('统计: 收入', r.data.totalIncome, '支出', r.data.totalExpense, '盈余', r.data.surplus);
  console.log('类别分布:', r.data.byCategory.map((c) => `${c.name}:${c.amount}`).join(', '));

  console.log('=== 11. 农历统计 ===');
  r = await req('GET', `/ledgers/${dailyId}/stats/summary?calendar=lunar`, null, token);
  console.log('农历统计 period:', r.data.period, 'calendar:', r.data.calendar, 'trend keys:', r.data.trend.map((t) => t.key).join(','));

  console.log('\n=== 全部通过 ===');
}

main().catch((e) => {
  console.error('测试失败:', e.message);
  process.exit(1);
});
