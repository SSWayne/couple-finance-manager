/** 預算寫入服務。同月份同範圍不可重複（schema 的資料集規則也會擋）。 */
import { commit } from '../data/db.js';
import { makeRecord } from '../data/schema.js';
import { addMonthsToMonth } from '../lib/date.js';
import { budgetKey } from './budgets.js';
import { UserError } from './errors.js';

function normalize(input) {
  return {
    month: input.month,
    scope: input.scope,
    memberId: input.scope === 'personal' ? input.memberId || null : null,
    categoryId: input.scope === 'category' ? input.categoryId || null : null,
    amount: input.amount,
    note: String(input.note ?? '').trim(),
  };
}

export function createBudget(db, input) {
  return commit(db, (ds) => {
    const fields = normalize(input);
    if (ds.budgets.some((b) => budgetKey(b) === budgetKey(fields))) throw new UserError(`${fields.month} 已經有相同範圍的預算，請直接修改那一筆。`);
    if (fields.categoryId && ds.categories.find((c) => c.id === fields.categoryId)?.archived) throw new UserError('不能為已封存的分類設定預算');
    return [{ op: 'put', collection: 'budgets', record: makeRecord('budgets', fields) }];
  });
}

/** 只能改金額與備註；要改範圍請刪除後重建（避免與既有預算衝突）。 */
export function updateBudget(db, id, { amount, note }) {
  return commit(db, (ds) => {
    const prev = ds.budgets.find((b) => b.id === id);
    if (!prev) throw new UserError('找不到此預算');
    return [{ op: 'put', collection: 'budgets', record: { ...prev, amount, note: String(note ?? '').trim() } }];
  });
}

export function deleteBudget(db, id) {
  return commit(db, (ds) => {
    if (!ds.budgets.some((b) => b.id === id)) throw new UserError('找不到此預算');
    return [{ op: 'delete', collection: 'budgets', id }];
  });
}

/**
 * 複製上個月的預算到 month；已存在相同範圍者略過，已封存分類的分類預算也略過。
 * 回傳 { created, skipped }（筆數），在同一交易中完成。
 */
export async function copyPreviousMonth(db, month) {
  const prevMonth = addMonthsToMonth(month, -1);
  let created = 0;
  let skipped = 0;
  await commit(db, (ds) => {
    const source = ds.budgets.filter((b) => b.month === prevMonth);
    if (!source.length) throw new UserError(`${prevMonth} 沒有預算可以複製。`);
    const existing = new Set(ds.budgets.filter((b) => b.month === month).map(budgetKey));
    const ops = [];
    for (const b of source) {
      const next = { month, scope: b.scope, memberId: b.memberId, categoryId: b.categoryId, amount: b.amount, note: b.note };
      const archivedCat = b.categoryId && ds.categories.find((c) => c.id === b.categoryId)?.archived;
      if (existing.has(budgetKey(next)) || archivedCat) {
        skipped++;
        continue;
      }
      existing.add(budgetKey(next));
      ops.push({ op: 'put', collection: 'budgets', record: makeRecord('budgets', next) });
      created++;
    }
    return ops;
  });
  return { created, skipped, prevMonth };
}
