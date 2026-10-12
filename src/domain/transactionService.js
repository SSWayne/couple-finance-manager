/**
 * 交易寫入服務。表單輸入 → 正規化成 schema 紀錄 → commit()（驗證失敗不寫入）。
 *
 * 規則：
 * - 新交易不可使用已停用的帳戶或已封存的分類（舊交易保留原值）。
 * - 已結算交易鎖定 類型／金額／付款人／歸屬／分攤；刪除需先撤銷結算。
 * - 由其他功能產生的交易（結算轉帳、禮金收入、儲蓄撥款轉帳）只能改備註類欄位，
 *   金額等請到原功能修改；刪除也要從原功能操作。
 */
import { commit } from '../data/db.js';
import { COLLECTIONS, makeRecord } from '../data/schema.js';
import { equalShares, ratioShares, MEMBER_IDS } from './split.js';
import { UserError } from './errors.js';

/** 已結算時鎖定的欄位。 */
export const SETTLED_LOCKED_FIELDS = ['type', 'amount', 'memberId', 'ownershipType', 'ownerMemberId', 'splitMode', 'shares'];
/** 被其他功能連結時鎖定的欄位。 */
export const LINKED_LOCKED_FIELDS = ['type', 'amount', 'date', 'accountId', 'toAccountId', 'memberId', 'categoryId', 'subcategoryId'];

const LINK_OWNER_PAGE = { settlements: '雙人財務', weddingGifts: '婚禮基金', savingsContributions: '儲蓄目標' };

/** 找出以 exclusiveLink 連結到此交易的紀錄（結算轉帳、禮金、撥款）。 */
export function findLinkOwner(dataset, txId) {
  for (const [name, def] of Object.entries(COLLECTIONS)) {
    for (const [field, f] of Object.entries(def.fields)) {
      if (!f.exclusiveLink) continue;
      const owner = dataset[name].find((r) => r[field] === txId);
      if (owner) return { collection: name, label: def.label, page: LINK_OWNER_PAGE[name] ?? def.label, record: owner };
    }
  }
  return null;
}

export function parseTags(value) {
  if (Array.isArray(value)) return [...new Set(value.map((t) => String(t).trim()).filter(Boolean))];
  return [...new Set(String(value ?? '').split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean))];
}

/**
 * 表單輸入 → 交易欄位（不含 id、settlementId 等系統欄位）。
 * input.ratio = { [memberId]: 百分比 }（ratio 模式）；input.shareAmounts = { [memberId]: 金額 }（amount 模式）。
 */
export function normalizeTransactionInput(input) {
  const out = normalizeCore(input);
  // 婚禮項目關聯：只有支出可以設定；沒有提供此欄位時（例如舊呼叫端）不覆蓋原值
  if (Object.hasOwn(input, 'weddingExpenseId')) out.weddingExpenseId = input.type === 'expense' ? input.weddingExpenseId || null : null;
  return out;
}

function normalizeCore(input) {
  const base = {
    date: input.date,
    type: input.type,
    amount: input.amount,
    accountId: input.accountId || null,
    memberId: input.memberId,
    paymentMethod: input.paymentMethod || null,
    description: String(input.description ?? '').trim(),
    tags: parseTags(input.tags),
  };
  if (input.type === 'transfer') {
    return {
      ...base,
      toAccountId: input.toAccountId || null,
      categoryId: null,
      subcategoryId: null,
      ownershipType: null,
      ownerMemberId: null,
      splitMode: 'none',
      shares: null,
    };
  }
  const common = { ...base, toAccountId: null, categoryId: input.categoryId || null, subcategoryId: input.subcategoryId || null };
  const ownershipType = input.ownershipType === 'personal' ? 'personal' : 'shared';
  if (ownershipType === 'personal') {
    return { ...common, ownershipType, ownerMemberId: input.ownerMemberId || input.memberId, splitMode: 'none', shares: null };
  }
  if (input.type === 'income') {
    return { ...common, ownershipType, ownerMemberId: null, splitMode: 'none', shares: null };
  }
  const splitMode = ['equal', 'ratio', 'amount'].includes(input.splitMode) ? input.splitMode : 'equal';
  let shares = null;
  if (Number.isSafeInteger(input.amount) && input.amount > 0) {
    if (splitMode === 'equal') shares = equalShares(input.amount, input.memberId);
    else if (splitMode === 'ratio') {
      shares = ratioShares(input.amount, input.memberId, input.ratio ?? {});
      if (!shares) throw new UserError('自訂比例必須是 0 以上的數字，且兩人加總為 100%');
    } else {
      shares = Object.fromEntries(MEMBER_IDS.map((m) => [m, input.shareAmounts?.[m]]));
      if (MEMBER_IDS.some((m) => !Number.isSafeInteger(shares[m]) || shares[m] < 0)) {
        throw new UserError('自訂金額必須是 0 以上的整數');
      }
      const sum = shares[MEMBER_IDS[0]] + shares[MEMBER_IDS[1]];
      if (sum !== input.amount) throw new UserError(`兩人負擔加總 ${sum} 必須等於金額 ${input.amount}`);
    }
  }
  return { ...common, ownershipType, ownerMemberId: null, splitMode, shares };
}

function sameValue(a, b) {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  }
  return a === b;
}

function assertUsable(ds, fields, previous) {
  const checkAccount = (id) => {
    if (!id || id === previous?.accountId || id === previous?.toAccountId) return;
    const a = ds.accounts.find((x) => x.id === id);
    if (a?.archived) throw new UserError(`帳戶「${a.name}」已停用，不能用於新交易`);
  };
  checkAccount(fields.accountId);
  checkAccount(fields.toAccountId);
  for (const key of ['categoryId', 'subcategoryId']) {
    const id = fields[key];
    if (!id || id === previous?.[key]) continue;
    const c = ds.categories.find((x) => x.id === id);
    if (c?.archived) throw new UserError(`分類「${c.name}」已封存，不能用於新交易`);
  }
}

export function createTransaction(db, input) {
  return commit(db, (ds) => {
    const fields = normalizeTransactionInput(input);
    assertUsable(ds, fields, null);
    return [{ op: 'put', collection: 'transactions', record: makeRecord('transactions', fields) }];
  });
}

export function updateTransaction(db, id, input) {
  return commit(db, (ds) => {
    const prev = ds.transactions.find((t) => t.id === id);
    if (!prev) throw new UserError('找不到這筆交易，可能已被刪除');
    const fields = normalizeTransactionInput(input);
    assertUsable(ds, fields, prev);
    if (prev.settlementId) {
      const changed = SETTLED_LOCKED_FIELDS.filter((f) => !sameValue(prev[f], fields[f]));
      if (changed.length) {
        throw new UserError('這筆交易已結算：類型、金額、付款人、歸屬與分攤已鎖定。如需修改，請先到「雙人財務」撤銷結算。');
      }
    }
    const owner = findLinkOwner(ds, id);
    if (owner) {
      const changed = LINKED_LOCKED_FIELDS.filter((f) => !sameValue(prev[f], fields[f]));
      if (changed.length) throw new UserError(`這筆交易由「${owner.label}」產生，金額、日期、帳戶等請到「${owner.page}」修改。`);
    }
    const record = {
      ...prev,
      ...fields,
      // 系統欄位沿用原值
      settlementId: prev.settlementId,
      recurringId: prev.recurringId,
      recurringDate: prev.recurringDate,
    };
    if (record.type !== 'expense') record.weddingExpenseId = null;
    return [{ op: 'put', collection: 'transactions', record }];
  });
}

export function deleteTransaction(db, id) {
  return commit(db, (ds) => {
    const prev = ds.transactions.find((t) => t.id === id);
    if (!prev) throw new UserError('找不到這筆交易，可能已被刪除');
    if (prev.settlementId) throw new UserError('這筆交易已結算，請先到「雙人財務」撤銷結算後再刪除。');
    const owner = findLinkOwner(ds, id);
    if (owner) throw new UserError(`這筆交易由「${owner.label}」產生，請到「${owner.page}」刪除或撤銷。`);
    return [{ op: 'delete', collection: 'transactions', id }];
  });
}
