/**
 * CSV 匯出：加 UTF-8 BOM（Excel 才能正確顯示中文），並防止公式注入。
 * 以 = + - @ Tab CR 開頭的文字儲存格前面加上單引號，Excel／試算表就不會當成公式執行。
 * 數字儲存格（金額）維持數字，不加單引號。
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const BOM = String.fromCharCode(0xfeff);

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}

/** columns: [{ header, value: (row) => any }] */
export function toCsv(rows, columns) {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
