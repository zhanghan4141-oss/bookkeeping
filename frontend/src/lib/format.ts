/** 金额格式化：千位分隔 + 两位小数。如 538926.77 -> 538,926.77，-2037 -> -2,037.00 */
export function formatMoney(n: number | string): string {
  const num = Number(n);
  if (!isFinite(num)) return '0.00';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 本地日期格式化：YYYY-MM-DD。避免 toISOString 转 UTC 导致日期提前一天 */
export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
