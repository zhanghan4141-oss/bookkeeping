/** 金额格式化：千位分隔 + 两位小数。如 538926.77 -> 538,926.77，-2037 -> -2,037.00 */
export function formatMoney(n: number | string): string {
  const num = Number(n);
  if (!isFinite(num)) return '0.00';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
