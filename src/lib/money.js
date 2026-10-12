/**
 * 金額工具。目前只支援「整數新台幣元」（currency=TWD, exponent=0）。
 * 所有金額在資料層皆為 Number.isSafeInteger 的整數；格式化只在顯示層進行。
 */

export const CURRENCY = 'TWD';
export const CURRENCY_EXPONENT = 0;

export function isMoney(value) {
  return Number.isSafeInteger(value);
}

const formatter = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });

/** 1234567 → "$1,234,567"；負數 → "-$1,234"。 */
export function formatMoney(value, { sign = false } = {}) {
  if (!isMoney(value)) return '—';
  const abs = formatter.format(Math.abs(value));
  if (value < 0) return `-$${abs}`;
  if (sign && value > 0) return `+$${abs}`;
  return `$${abs}`;
}

/** 解析使用者輸入的整數金額（允許千分位逗號與前後空白）。失敗回傳 null。 */
export function parseMoneyInput(text) {
  if (typeof text === 'number') return isMoney(text) ? text : null;
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/[,\s$]/g, '');
  if (!/^-?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return isMoney(n) ? n : null;
}

/** 百分比顯示；分母為 0 時回傳「不適用」。 */
export function formatPercent(numerator, denominator, digits = 1) {
  if (!denominator) return '不適用';
  return `${((numerator / denominator) * 100).toFixed(digits)}%`;
}
