import { Solar } from 'lunar-javascript';

/**
 * 将公历日期转为「农历年月」键。
 * 返回 { year, month, key }，month 为负数表示闰月（如 -2 表示闰二月）。
 * key 形如 "2024-2" 或 "2024-r2"（闰月用 r 前缀区分）。
 */
export function lunarMonthKey(date: Date): { year: number; month: number; key: string } {
  const solar = Solar.fromDate(date);
  const lunar = solar.getLunar();
  const year = lunar.getYear();
  const month = lunar.getMonth(); // 负数=闰月
  const key = month < 0 ? `${year}-r${-month}` : `${year}-${month}`;
  return { year, month, key };
}

export function solarMonthKey(date: Date): { year: number; month: number; key: string } {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
}

export function solarYearKey(date: Date): string {
  return String(date.getFullYear());
}

/** 根据统计周期（month/year）和历法（solar/lunar）生成键 */
export function periodKey(
  date: Date,
  period: 'month' | 'year',
  calendar: 'solar' | 'lunar',
): string {
  if (calendar === 'lunar') {
    const { year, month, key } = lunarMonthKey(date);
    return period === 'month' ? key : String(year);
  }
  return period === 'month' ? solarMonthKey(date).key : solarYearKey(date);
}
