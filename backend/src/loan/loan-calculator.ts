/**
 * 贷款还款计划计算工具
 * 所有金额以元为单位，返回保留两位小数（四舍五入）。
 */

export type RepaymentMethod =
  | 'equal_installment' // 等额本息
  | 'equal_principal' // 等额本金
  | 'interest_first' // 先息后本
  | 'custom'; // 自定义

export interface RepaymentPeriod {
  periodNo: number;
  dueDate: Date;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 计算某个月份的还款日（还款日 day，遇到无该日（如2月30日）取当月最后一天）
 */
function repaymentDate(startDate: Date, monthOffset: number, day: number): Date {
  const d = new Date(
    startDate.getFullYear(),
    startDate.getMonth() + monthOffset,
    1,
  );
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const actualDay = Math.min(day, lastDay);
  return new Date(d.getFullYear(), d.getMonth(), actualDay);
}

export function generateRepaymentPlan(params: {
  principal: number;
  annualRate: number; // 年利率，百分比，如 4.9 表示 4.9%
  startDate: Date;
  termMonths: number;
  repaymentDay: number;
  method: RepaymentMethod;
  customPeriods?: { principalAmount: number; interestAmount: number; totalAmount?: number }[];
}): RepaymentPeriod[] {
  const {
    principal,
    annualRate,
    startDate,
    termMonths,
    repaymentDay,
    method,
    customPeriods,
  } = params;

  const monthlyRate = annualRate / 100 / 12;
  const periods: RepaymentPeriod[] = [];

  if (method === 'custom') {
    if (!customPeriods || customPeriods.length !== termMonths) {
      throw new Error('自定义还款计划期数不匹配');
    }
    for (let i = 0; i < termMonths; i++) {
      const c = customPeriods[i];
      periods.push({
        periodNo: i + 1,
        dueDate: repaymentDate(startDate, i + 1, repaymentDay),
        principalAmount: round2(c.principalAmount),
        interestAmount: round2(c.interestAmount),
        totalAmount: round2(c.totalAmount ?? c.principalAmount + c.interestAmount),
      });
    }
    return periods;
  }

  if (method === 'equal_principal') {
    const monthlyPrincipal = principal / termMonths;
    let remaining = principal;
    for (let i = 0; i < termMonths; i++) {
      const interest = remaining * monthlyRate;
      const principalPart = monthlyPrincipal;
      periods.push({
        periodNo: i + 1,
        dueDate: repaymentDate(startDate, i + 1, repaymentDay),
        principalAmount: round2(principalPart),
        interestAmount: round2(interest),
        totalAmount: round2(principalPart + interest),
      });
      remaining -= monthlyPrincipal;
    }
    return periods;
  }

  if (method === 'interest_first') {
    const monthlyInterest = principal * monthlyRate;
    for (let i = 0; i < termMonths; i++) {
      const isLast = i === termMonths - 1;
      const principalPart = isLast ? principal : 0;
      periods.push({
        periodNo: i + 1,
        dueDate: repaymentDate(startDate, i + 1, repaymentDay),
        principalAmount: round2(principalPart),
        interestAmount: round2(monthlyInterest),
        totalAmount: round2(monthlyInterest + principalPart),
      });
    }
    return periods;
  }

  // equal_installment（等额本息）
  if (monthlyRate === 0) {
    const monthlyPayment = principal / termMonths;
    for (let i = 0; i < termMonths; i++) {
      periods.push({
        periodNo: i + 1,
        dueDate: repaymentDate(startDate, i + 1, repaymentDay),
        principalAmount: round2(monthlyPayment),
        interestAmount: 0,
        totalAmount: round2(monthlyPayment),
      });
    }
    return periods;
  }

  const factor = Math.pow(1 + monthlyRate, termMonths);
  const monthlyPayment =
    (principal * monthlyRate * factor) / (factor - 1);

  let remaining = principal;
  for (let i = 0; i < termMonths; i++) {
    const interest = remaining * monthlyRate;
    let principalPart = monthlyPayment - interest;
    // 最后一期校正，确保本金归零
    if (i === termMonths - 1) {
      principalPart = remaining;
    }
    periods.push({
      periodNo: i + 1,
      dueDate: repaymentDate(startDate, i + 1, repaymentDay),
      principalAmount: round2(principalPart),
      interestAmount: round2(interest),
      totalAmount: round2(principalPart + interest),
    });
    remaining -= principalPart;
  }
  return periods;
}
