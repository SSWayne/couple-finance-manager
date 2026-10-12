/**
 * 婚禮基金寫入服務。
 * - 建立專案時自動建立 9 個預設項目（金額 0）。
 * - 禮金選擇入帳帳戶時，同一交易中自動建立「禮金」收入交易並雙向連動：
 *   修改禮金會同步修改交易；取消入帳帳戶會刪除交易；刪除禮金會一併刪除交易。
 * - 有交易關聯的婚禮項目不可刪除（請先在交易中取消關聯）。
 * - 刪除整個專案：有已入帳的禮金或有交易關聯項目時拒絕，避免連帶刪除帳本資料。
 */
import { commit } from '../data/db.js';
import { makeRecord, WEDDING_PROJECT_ID, GIFT_CATEGORY_ID } from '../data/schema.js';
import { newId } from '../lib/id.js';
import { MEMBER_SELF, MEMBER_PARTNER } from './split.js';
import { DEFAULT_WEDDING_ITEMS } from './wedding.js';
import { UserError } from './errors.js';

const trim = (s) => String(s ?? '').trim();

export function saveWeddingProject(db, input) {
  return commit(db, (ds) => {
    const fields = { name: trim(input.name), weddingDate: input.weddingDate || null, totalBudget: input.totalBudget, note: trim(input.note) };
    if (ds.weddingProject) {
      return [{ op: 'put', collection: 'weddingProject', record: { ...ds.weddingProject, ...fields } }];
    }
    const ops = [{ op: 'put', collection: 'weddingProject', record: makeRecord('weddingProject', { id: WEDDING_PROJECT_ID, ...fields }) }];
    DEFAULT_WEDDING_ITEMS.forEach((name, i) => {
      ops.push({ op: 'put', collection: 'weddingExpenses', record: makeRecord('weddingExpenses', { name, sortOrder: i }) });
    });
    return ops;
  });
}

export function deleteWeddingProject(db) {
  return commit(db, (ds) => {
    if (!ds.weddingProject) throw new UserError('目前沒有婚禮專案');
    const linkedGifts = ds.weddingGifts.filter((g) => g.transactionId);
    if (linkedGifts.length) throw new UserError(`有 ${linkedGifts.length} 筆禮金已入帳到家庭帳本，請先刪除這些禮金或取消入帳帳戶，再刪除專案。`);
    const itemIds = new Set(ds.weddingExpenses.map((i) => i.id));
    const linkedTx = ds.transactions.filter((t) => t.weddingExpenseId && itemIds.has(t.weddingExpenseId));
    if (linkedTx.length) throw new UserError(`有 ${linkedTx.length} 筆交易關聯到婚禮項目，請先在收支記帳中取消關聯，再刪除專案。`);
    return [
      ...ds.weddingExpenses.map((i) => ({ op: 'delete', collection: 'weddingExpenses', id: i.id })),
      ...ds.weddingGifts.map((g) => ({ op: 'delete', collection: 'weddingGifts', id: g.id })),
      { op: 'delete', collection: 'weddingProject', id: WEDDING_PROJECT_ID },
    ];
  });
}

function itemFields(input) {
  return {
    name: trim(input.name),
    estimatedAmount: input.estimatedAmount,
    actualAmount: input.actualAmount ?? null,
    manualPaidAmount: input.manualPaidAmount ?? 0,
    manualPaidNote: trim(input.manualPaidNote),
    vendor: trim(input.vendor),
    dueDate: input.dueDate || null,
    note: trim(input.note),
  };
}

export function saveWeddingItem(db, id, input) {
  return commit(db, (ds) => {
    if (!ds.weddingProject) throw new UserError('請先建立婚禮專案');
    const fields = itemFields(input);
    if (id) {
      const prev = ds.weddingExpenses.find((i) => i.id === id);
      if (!prev) throw new UserError('找不到此婚禮項目');
      return [{ op: 'put', collection: 'weddingExpenses', record: { ...prev, ...fields } }];
    }
    const sortOrder = ds.weddingExpenses.reduce((m, i) => Math.max(m, i.sortOrder + 1), 0);
    return [{ op: 'put', collection: 'weddingExpenses', record: makeRecord('weddingExpenses', { ...fields, sortOrder }) }];
  });
}

export function deleteWeddingItem(db, id) {
  return commit(db, (ds) => {
    const item = ds.weddingExpenses.find((i) => i.id === id);
    if (!item) throw new UserError('找不到此婚禮項目');
    const n = ds.transactions.filter((t) => t.weddingExpenseId === id).length;
    if (n) throw new UserError(`「${item.name}」有 ${n} 筆關聯交易，請先在收支記帳中把這些交易的「婚禮項目」改為不關聯。`);
    return [{ op: 'delete', collection: 'weddingExpenses', id }];
  });
}

/** 依禮金建立／更新對應的收入交易內容。 */
function giftTransaction(gift, prevTx) {
  const memberId = gift.side === 'partner' ? MEMBER_PARTNER : MEMBER_SELF;
  return {
    ...(prevTx ?? makeRecord('transactions', { id: newId() })),
    date: gift.date,
    type: 'income',
    amount: gift.amount,
    categoryId: GIFT_CATEGORY_ID,
    subcategoryId: null,
    accountId: gift.accountId,
    toAccountId: null,
    memberId: prevTx?.memberId ?? memberId,
    ownershipType: 'shared',
    ownerMemberId: null,
    splitMode: 'none',
    shares: null,
    paymentMethod: prevTx?.paymentMethod ?? 'cash',
    description: `禮金：${gift.giverName}`,
  };
}

export function saveWeddingGift(db, id, input) {
  return commit(db, (ds) => {
    if (!ds.weddingProject) throw new UserError('請先建立婚禮專案');
    const prev = id ? ds.weddingGifts.find((g) => g.id === id) : null;
    if (id && !prev) throw new UserError('找不到此禮金紀錄');
    const accountId = input.accountId || null;
    if (accountId && accountId !== prev?.accountId) {
      const acc = ds.accounts.find((a) => a.id === accountId);
      if (acc?.archived) throw new UserError(`帳戶「${acc.name}」已停用，不能入帳`);
    }
    const gift = {
      ...(prev ?? makeRecord('weddingGifts', {})),
      giverName: trim(input.giverName),
      relation: trim(input.relation),
      side: input.side,
      amount: input.amount,
      date: input.date,
      note: trim(input.note),
      accountId,
    };
    const ops = [];
    const prevTx = prev?.transactionId ? ds.transactions.find((t) => t.id === prev.transactionId) : null;
    if (accountId) {
      const tx = giftTransaction(gift, prevTx);
      gift.transactionId = tx.id;
      ops.push({ op: 'put', collection: 'transactions', record: tx });
    } else {
      gift.transactionId = null;
      if (prevTx) ops.push({ op: 'delete', collection: 'transactions', id: prevTx.id });
    }
    ops.push({ op: 'put', collection: 'weddingGifts', record: gift });
    return ops;
  });
}

export function deleteWeddingGift(db, id) {
  return commit(db, (ds) => {
    const gift = ds.weddingGifts.find((g) => g.id === id);
    if (!gift) throw new UserError('找不到此禮金紀錄');
    const ops = [{ op: 'delete', collection: 'weddingGifts', id }];
    if (gift.transactionId) ops.push({ op: 'delete', collection: 'transactions', id: gift.transactionId });
    return ops;
  });
}
