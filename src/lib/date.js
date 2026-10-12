/** 日期工具：資料層一律使用本地時區的 'YYYY-MM-DD' 字串與 'YYYY-MM' 月份字串。 */

const pad = (n, len = 2) => String(n).padStart(len, '0');

export function isValidDateString(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1900 || y > 2200 || m < 1 || m > 12) return false;
  return d >= 1 && d <= daysInMonth(y, m);
}

export function isValidMonthString(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}$/.test(s)) return false;
  const [y, m] = s.split('-').map(Number);
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12;
}

export function isValidIsoDateTime(s) {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(s)) return false;
  return !Number.isNaN(Date.parse(s));
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function toDateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function today() {
  return toDateString(new Date());
}

export function currentMonth() {
  return today().slice(0, 7);
}

export function nowIso() {
  return new Date().toISOString();
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 加月份，日期超過該月天數時夾到月底（1/31 + 1 月 → 2/28 或 2/29）。 */
export function addMonthsClamped(dateStr, months, anchorDay) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = anchorDay ?? d;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(day, daysInMonth(ny, nm)))}`;
}

export function addDays(dateStr, days) {
  const dt = parseDate(dateStr);
  dt.setDate(dt.getDate() + days);
  return toDateString(dt);
}

export function addMonthsToMonth(monthStr, months) {
  return addMonthsClamped(`${monthStr}-01`, months).slice(0, 7);
}

/** 兩日期間相差天數（b - a）。 */
export function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

/** 檔名用時間戳：YYYYMMDD-HHmmss（本地時間）。 */
export function fileTimestamp(date = new Date()) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${toDateString(d).replaceAll('-', '/')} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
