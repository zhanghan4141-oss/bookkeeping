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
 * 用 XIRR（现金流内部收益率）计算实际年利率。
 * 现金流：期初放款 -principal（t0 = startDate），各期还款 +totalAmount（t = dueDate）。
 * 返回小数形式的年利率（如 0.049 表示 4.9%）；无法计算时返回 null。
 */
export function calculateXIRR(
  principal: number,
  startDate: Date,
  repayments: { dueDate: Date; totalAmount: number }[],
): number | null {
  if (principal <= 0 || repayments.length === 0) return null;

  const flows: { t: number; amount: number }[] = [
    { t: 0, amount: -principal },
    ...repayments.map((r) => ({
      t: (r.dueDate.getTime() - startDate.getTime()) / (365.25 * 24 * 3600 * 1000),
      amount: r.totalAmount,
    })),
  ];

  // 排除 t <= 0 且非首期的异常点
  const validFlows = flows.filter((f, i) => i === 0 || f.t > 0);
  if (validFlows.length < 2) return null;

  // 牛顿迭代法求 NPV(rate) = 0
  let rate = 0.1;
  for (let iter = 0; iter < 100; iter++) {
    let npv = 0;
    let dnpv = 0;
    for (const f of validFlows) {
      const df = Math.pow(1 + rate, f.t);
      npv += f.amount / df;
      dnpv += (-f.t * f.amount) / (df * (1 + rate));
    }
    if (dnpv === 0) break;
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < 1e-10) {
      rate = newRate;
      break;
    }
    rate = newRate;
  }

  if (!isFinite(rate) || rate <= -0.99) return null;
  return rate;
}

/**
 * 计算某个月份的还款日（还款日 day，遇到无该日（如2月30日）取当月最后一天）
 * 用 Date.UTC 构造，避免本地时区导致的日期偏移。
 */
function repaymentDate(startDate: Date, monthOffset: number, day: number): Date {
  const d = new Date(
    Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth() + monthOffset,
      1,
    ),
  );
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const actualDay = Math.min(day, lastDay);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), actualDay));
}

export function generateRepaymentPlan(params: {
  principal: number;
  annualRate: number; // 年利率，百分比，如 4.9 表示 4.9%
  startDate: Date;
  termMonths: number;
  repaymentDay: number;
  method: RepaymentMethod;
  customPeriods?: { dueDate: Date; totalAmount: number }[];
  /** 可选：指定每期的到期日（如提前还款重算时保持原到期日不变） */
  dueDates?: Date[];
}): RepaymentPeriod[] {
  const {
    principal,
    annualRate,
    startDate,
    termMonths,
    repaymentDay,
    method,
    customPeriods,
    dueDates,
  } = params;

  const monthlyRate = annualRate / 100 / 12;
  const periods: RepaymentPeriod[] = [];

  // 计算每期到期日：优先用指定的 dueDates，否则按 startDate + repaymentDay 推算
  const getDueDate = (i: number): Date => {
    if (dueDates && dueDates[i]) return dueDates[i];
    return repaymentDate(startDate, i + 1, repaymentDay);
  };

  if (method === 'custom') {
    if (!customPeriods || customPeriods.length !== termMonths) {
      throw new Error('自定义还款计划期数不匹配');
    }
    for (let i = 0; i < termMonths; i++) {
      const c = customPeriods[i];
      periods.push({
        periodNo: i + 1,
        dueDate: c.dueDate,
        principalAmount: 0, // 自定义方式不区分本金利息
        interestAmount: 0,
        totalAmount: round2(c.totalAmount),
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
        dueDate: getDueDate(i),
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
        dueDate: getDueDate(i),
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
        dueDate: getDueDate(i),
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
      dueDate: getDueDate(i),
      principalAmount: round2(principalPart),
      interestAmount: round2(interest),
      totalAmount: round2(principalPart + interest),
    });
    remaining -= principalPart;
  }
  return periods;
}
