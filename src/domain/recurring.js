/**
 * 固定收支排程（純函式）。
 * - 週期：每週／每月／每季／每年。每一期都從「開始日」推算（不是從上一期推），
 *   所以 1/31 每月 → 2/28 → 3/31，不會越推越早。
 * - 只在「開啟網站時」補入帳到期項目；網站關閉期間不會執行。
 * - 暫停後恢復：skipBefore 設為恢復當天，暫停期間的期數不補產生。
 */
import { addDays, addMonthsClamped } from '../lib/date.js';

const MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };
const MAX_PERIODS = 5000;

export function occurrenceDate(startDate, frequency, k) {
  if (frequency === 'weekly') return addDays(startDate, 7 * k);
  return addMonthsClamped(startDate, MONTHS[frequency] * k);
}

/** 從開始日到 upTo（含）所有應產生的日期，排除結束日之後與 skipBefore 之前。 */
export function dueDates(rec, upTo) {
  const out = [];
  for (let k = 0; k < MAX_PERIODS; k++) {
    const d = occurrenceDate(rec.startDate, rec.frequency, k);
    if (d > upTo || (rec.endDate && d > rec.endDate)) break;
    if (rec.skipBefore && d < rec.skipBefore) continue;
    out.push(d);
  }
  return out;
}

/** 下一次（> after）的日期；沒有則 null。 */
export function nextOccurrence(rec, after) {
  for (let k = 0; k < MAX_PERIODS; k++) {
    const d = occurrenceDate(rec.startDate, rec.frequency, k);
    if (rec.endDate && d > rec.endDate) return null;
    if (d > after && (!rec.skipBefore || d >= rec.skipBefore)) return d;
  }
  return null;
}

/** 尚未產生的到期日期（依現有交易的 (recurringId, recurringDate) 判斷）。 */
export function pendingDates(dataset, rec, today) {
  if (!rec.active) return [];
  const done = new Set(dataset.transactions.filter((t) => t.recurringId === rec.id).map((t) => t.recurringDate));
  return dueDates(rec, today).filter((d) => !done.has(d));
}

export const TEMPLATE_TX_FIELDS = ['type', 'amount', 'categoryId', 'subcategoryId', 'accountId', 'toAccountId', 'memberId', 'ownershipType', 'ownerMemberId', 'splitMode', 'shares', 'paymentMethod', 'tags'];
