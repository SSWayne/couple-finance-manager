/**
 * 預算（純函式）。
 * 範圍：
 * - household：家庭總支出（每筆支出算一次）
 * - personal：該成員的「個人支出」（ownershipType=personal 且歸屬該成員）
 * - shared：共同支出
 * - category：該主分類的支出（含其所有子分類）
 * 狀態：使用率 < 80% 正常；80%–100% 提醒；> 100% 警告（超支）。
 */
import { ENUMS } from '../data/schema.js';
import { daysInMonth } from '../lib/date.js';

export const BUDGET_WARN_RATIO = 0.8;

export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  return [`${month}-01`, `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`];
}

export function budgetMatches(budget, t) {
  if (t.type !== 'expense') return false;
  switch (budget.scope) {
    case 'household':
      return true;
    case 'personal':
      return t.ownershipType === 'personal' && t.ownerMemberId === budget.memberId;
    case 'shared':
      return t.ownershipType === 'shared';
    case 'category':
      return t.categoryId === budget.categoryId;
    default:
      return false;
  }
}

export function budgetSpent(dataset, budget) {
  const [from, to] = monthRange(budget.month);
  let spent = 0;
  for (const t of dataset.transactions) {
    if (t.date >= from && t.date <= to && budgetMatches(budget, t)) spent += t.amount;
  }
  return spent;
}

export function budgetLevel(spent, amount) {
  if (spent > amount) return 'over';
  if (spent >= amount * BUDGET_WARN_RATIO) return 'warning';
  return 'ok';
}

export const LEVEL_TEXT = { ok: '正常', warning: '接近上限', over: '已超支' };

const SCOPE_ORDER = { household: 0, shared: 1, personal: 2, category: 3 };

export function budgetTitle(dataset, b) {
  if (b.scope === 'personal') return `${dataset.members.find((m) => m.id === b.memberId)?.name ?? '—'}的個人支出`;
  if (b.scope === 'category') return dataset.categories.find((c) => c.id === b.categoryId)?.name ?? '—';
  return ENUMS.budgetScope[b.scope];
}

/** 某月所有預算的使用狀況，依 家庭總 → 共同 → 個人 → 分類 排序。 */
export function budgetStatuses(dataset, month) {
  return dataset.budgets
    .filter((b) => b.month === month)
    .map((b) => {
      const spent = budgetSpent(dataset, b);
      return { budget: b, title: budgetTitle(dataset, b), spent, remaining: b.amount - spent, ratio: spent / b.amount, level: budgetLevel(spent, b.amount) };
    })
    .sort((a, b) => SCOPE_ORDER[a.budget.scope] - SCOPE_ORDER[b.budget.scope] || a.title.localeCompare(b.title));
}

export function budgetKey(b) {
  return `${b.month}|${b.scope}|${b.memberId ?? ''}|${b.categoryId ?? ''}`;
}
