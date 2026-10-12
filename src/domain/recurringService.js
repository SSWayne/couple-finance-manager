/**
 * 固定收支寫入服務。
 * - 範本欄位與交易共用正規化與驗證規則。
 * - 已產生過交易的範本，開始日與週期不可再修改（避免既有期數對不上）。
 * - 刪除範本：保留已產生的交易（解除與範本的關聯），只刪除範本。
 * - runRecurring()：在單一資料庫交易中補產生所有到期項目；
 *   以 (recurringId, recurringDate) 判斷是否已產生（資料庫也有唯一複合索引）。
 */
import { commit } from '../data/db.js';
import { makeRecord } from '../data/schema.js';
import { normalizeTransactionInput } from './transactionService.js';
import { pendingDates, dueDates, TEMPLATE_TX_FIELDS } from './recurring.js';
import { UserError } from './errors.js';

function templateFields(input) {
  const core = normalizeTransactionInput({ ...input, date: input.startDate });
  const out = { name: String(input.name ?? '').trim(), frequency: input.frequency, startDate: input.startDate, endDate: input.endDate || null, description: core.description };
  for (const k of TEMPLATE_TX_FIELDS) out[k] = core[k];
  return out;
}

function assertUsable(ds, fields, prev) {
  for (const id of [fields.accountId, fields.toAccountId]) {
    if (!id || id === prev?.accountId || id === prev?.toAccountId) continue;
    const a = ds.accounts.find((x) => x.id === id);
    if (a?.archived) throw new UserError(`帳戶「${a.name}」已停用，不能用於固定收支`);
  }
  for (const id of [fields.categoryId, fields.subcategoryId]) {
    if (!id || id === prev?.categoryId || id === prev?.subcategoryId) continue;
    const c = ds.categories.find((x) => x.id === id);
    if (c?.archived) throw new UserError(`分類「${c.name}」已封存，不能用於固定收支`);
  }
}

export function saveRecurring(db, id, input) {
  return commit(db, (ds) => {
    const fields = templateFields(input);
    if (!id) {
      assertUsable(ds, fields, null);
      return [{ op: 'put', collection: 'recurringTransactions', record: makeRecord('recurringTransactions', { ...fields, active: true }) }];
    }
    const prev = ds.recurringTransactions.find((r) => r.id === id);
    if (!prev) throw new UserError('找不到此固定收支');
    assertUsable(ds, fields, prev);
    const generated = ds.transactions.some((t) => t.recurringId === id);
    if (generated && (fields.startDate !== prev.startDate || fields.frequency !== prev.frequency)) {
      throw new UserError('這個固定收支已經產生過交易，開始日與週期不能修改。若要改週期，請停用後另建一筆新的固定收支。');
    }
    return [{ op: 'put', collection: 'recurringTransactions', record: { ...prev, ...fields } }];
  });
}

/** 暫停／恢復。恢復時 skipBefore＝今天：暫停期間的期數不補產生。 */
export function setRecurringActive(db, id, active, today) {
  return commit(db, (ds) => {
    const prev = ds.recurringTransactions.find((r) => r.id === id);
    if (!prev) throw new UserError('找不到此固定收支');
    const next = { ...prev, active };
    if (active && !prev.active) next.skipBefore = today;
    return [{ op: 'put', collection: 'recurringTransactions', record: next }];
  });
}

export function deleteRecurring(db, id) {
  return commit(db, (ds) => {
    if (!ds.recurringTransactions.some((r) => r.id === id)) throw new UserError('找不到此固定收支');
    const ops = ds.transactions
      .filter((t) => t.recurringId === id)
      .map((t) => ({ op: 'put', collection: 'transactions', record: { ...t, recurringId: null, recurringDate: null } }));
    ops.push({ op: 'delete', collection: 'recurringTransactions', id });
    return ops;
  });
}

/**
 * 補產生所有到期的固定收支。回傳 { created: [{ name, dates }], skipped: [{ name, reason }], count }。
 * 帳戶已停用或分類已封存的範本會略過並回報原因，不影響其他範本。
 */
export async function runRecurring(db, today) {
  const created = [];
  const skipped = [];
  let count = 0;
  await commit(db, (ds) => {
    const ops = [];
    created.length = 0;
    skipped.length = 0;
    count = 0;
    for (const rec of ds.recurringTransactions) {
      const dates = pendingDates(ds, rec, today);
      if (!dates.length) continue;
      const badAccount = [rec.accountId, rec.toAccountId].map((x) => x && ds.accounts.find((a) => a.id === x)).find((a) => a?.archived);
      const badCat = [rec.categoryId, rec.subcategoryId].map((x) => x && ds.categories.find((c) => c.id === x)).find((c) => c?.archived);
      if (badAccount || badCat) {
        skipped.push({ name: rec.name, reason: badAccount ? `帳戶「${badAccount.name}」已停用` : `分類「${badCat.name}」已封存`, count: dates.length });
        continue;
      }
      for (const date of dates) {
        const fields = Object.fromEntries(TEMPLATE_TX_FIELDS.map((k) => [k, Array.isArray(rec[k]) ? [...rec[k]] : rec[k] && typeof rec[k] === 'object' ? { ...rec[k] } : rec[k]]));
        ops.push({
          op: 'put',
          collection: 'transactions',
          record: makeRecord('transactions', { ...fields, date, description: rec.description || rec.name, recurringId: rec.id, recurringDate: date }),
        });
      }
      const all = dueDates(rec, today);
      const last = all.at(-1);
      if (last && (!rec.lastGeneratedDate || last > rec.lastGeneratedDate)) {
        ops.push({ op: 'put', collection: 'recurringTransactions', record: { ...rec, lastGeneratedDate: last } });
      }
      created.push({ name: rec.name, dates });
      count += dates.length;
    }
    return ops;
  });
  return { created, skipped, count };
}
