/**
 * 支出计划计算工具：按周期生成每期到期日。
 * 复用贷款的计算器（月推进 + 月末/闰年截断语义）。
 * 所有金额以元为单位。
 */

import { repaymentDate } from '../loan/loan-calculator.js';

export type Frequency = 'month' | 'quarter' | 'year';

/** 各周期对应的推进月数 */
export const UNIT_MONTHS: Record<Frequency, number> = {
  month: 1,
  quarter: 3,
  year: 12,
};

export interface PlanPeriodInput {
  periodNo: number;
  dueDate: Date;
  amount: number;
}

/**
 * 第 periodNo 期的到期日：
 * - 首期（periodNo <= 1）取开始日当天；
 * - 后续期从开始日所在月向后推 (periodNo-1) * 周期月数 个月，取该月的 day 日（无同日取月末）。
 */
export function periodDueDate(
  startDate: string,
  frequency: Frequency,
  day: number,
  periodNo: number,
): Date {
  // date-only ISO（YYYY-MM-DD）按 UTC 午夜解析，与贷款口径一致，避免本地时区偏移
  const start = new Date(startDate);
  if (periodNo <= 1) return start;
  return repaymentDate(start, (periodNo - 1) * UNIT_MONTHS[frequency], day);
}

/**
 * 生成计划各期（金额恒定）。
 * @param termCount 期数；0 = 不限（MVP 生成 120 期，后续可编辑期数）
 */
export function generatePlanPeriods(params: {
  startDate: string;
  frequency: Frequency;
  day: number;
  periodAmount: number;
  termCount: number;
}): PlanPeriodInput[] {
  const cap = params.termCount > 0 ? params.termCount : 120;
  return Array.from({ length: cap }, (_, i) => ({
    periodNo: i + 1,
    dueDate: periodDueDate(params.startDate, params.frequency, params.day, i + 1),
    amount: params.periodAmount,
  }));
}