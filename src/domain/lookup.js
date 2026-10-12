/** 顯示用查詢（純函式）。 */
import { ENUMS } from '../data/schema.js';
import { MEMBER_SELF } from './split.js';

export function memberName(ds, id) {
  return ds.members.find((m) => m.id === id)?.name ?? '—';
}

export function accountName(ds, id) {
  return ds.accounts.find((a) => a.id === id)?.name ?? '—';
}

export function category(ds, id) {
  return id ? ds.categories.find((c) => c.id === id) ?? null : null;
}

/** 「餐飲 › 午餐」 */
export function categoryLabel(ds, t) {
  if (t.type === 'transfer') return '轉帳';
  const main = category(ds, t.categoryId);
  const sub = category(ds, t.subcategoryId);
  return [main?.name, sub?.name].filter(Boolean).join(' › ') || '未分類';
}

export function accountTypeLabel(type) {
  return ENUMS.accountType[type] ?? type;
}

export const ACCOUNT_TYPE_ICON = {
  bank: 'bi-bank',
  cash: 'bi-cash-coin',
  credit_card: 'bi-credit-card',
  e_wallet: 'bi-phone',
  savings: 'bi-piggy-bank',
  investment: 'bi-graph-up-arrow',
  other: 'bi-wallet2',
};

/** 依「我、另一半」順序排列的成員。 */
export function orderedMembers(ds) {
  return [...ds.members].sort((a, b) => (a.id === MEMBER_SELF ? -1 : b.id === MEMBER_SELF ? 1 : 0));
}

export function sortedAccounts(ds) {
  return [...ds.accounts].sort((a, b) => Number(a.archived) - Number(b.archived) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** 主分類（依類型、排序），附子分類。 */
export function categoryTree(ds, type, { includeArchived = false, keepIds = [] } = {}) {
  const keep = new Set(keepIds.filter(Boolean));
  const visible = (c) => includeArchived || !c.archived || keep.has(c.id);
  return ds.categories
    .filter((c) => c.type === type && !c.parentId && visible(c))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => ({
      ...p,
      children: ds.categories.filter((c) => c.parentId === p.id && visible(c)).sort((a, b) => a.sortOrder - b.sortOrder),
    }));
}
