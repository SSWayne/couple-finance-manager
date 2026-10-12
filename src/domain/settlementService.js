/**
 * 代墊結算。
 * - 所有（結算日當天以前的）未結算代墊互相抵銷後，一次結清淨額。
 * - 可選擇同時建立結算轉帳（應付方帳戶 → 收款方帳戶）。
 * - 撤銷結算：解除交易的結算標記、刪除結算紀錄，並一併刪除結算轉帳。
 */
import { commit } from '../data/db.js';
import { makeRecord } from '../data/schema.js';
import { computeAdvance, netAdvances } from './split.js';
import { newId } from '../lib/id.js';
import { UserError } from './errors.js';

export function unsettledTransactions(dataset, upTo = null) {
  return dataset.transactions
    .filter((t) => !t.settlementId && computeAdvance(t) && (!upTo || t.date <= upTo))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

/** 目前未結算代墊的摘要：每人代墊合計與淨額。 */
export function advanceSummary(dataset, upTo = null) {
  const txs = unsettledTransactions(dataset, upTo);
  const paidFor = {}; // creditorId → 替對方墊的金額
  for (const t of txs) {
    const adv = computeAdvance(t);
    paidFor[adv.creditorId] = (paidFor[adv.creditorId] ?? 0) + adv.amount;
  }
  return { transactions: txs, paidFor, net: netAdvances(txs) };
}

/**
 * @param {{ date: string, createTransfer: boolean, fromAccountId?: string, toAccountId?: string, note?: string }} input
 */
export function createSettlement(db, input) {
  return commit(db, (ds) => {
    const txs = unsettledTransactions(ds, input.date);
    if (!txs.length) throw new UserError('結算日以前沒有未結算的代墊。');
    const net = netAdvances(txs);
    const settlementId = newId();
    const settlement = makeRecord('settlements', {
      id: settlementId,
      date: input.date,
      fromMemberId: net.fromMemberId,
      toMemberId: net.toMemberId,
      amount: net.amount,
      transactionIds: txs.map((t) => t.id),
      note: String(input.note ?? '').trim(),
    });
    const ops = [];
    if (input.createTransfer && net.amount > 0) {
      const from = ds.accounts.find((a) => a.id === input.fromAccountId);
      const to = ds.accounts.find((a) => a.id === input.toAccountId);
      if (!from || !to) throw new UserError('請選擇結算轉帳的轉出與轉入帳戶。');
      if (from.id === to.id) throw new UserError('結算轉帳的轉出與轉入帳戶不可相同。');
      if (from.archived || to.archived) throw new UserError('不能使用已停用的帳戶建立結算轉帳。');
      const transfer = makeRecord('transactions', {
        id: newId(),
        date: input.date,
        type: 'transfer',
        amount: net.amount,
        accountId: from.id,
        toAccountId: to.id,
        memberId: net.fromMemberId,
        categoryId: null,
        ownershipType: null,
        splitMode: 'none',
        shares: null,
        paymentMethod: 'transfer',
        description: '代墊結算',
      });
      settlement.transferTransactionId = transfer.id;
      ops.push({ op: 'put', collection: 'transactions', record: transfer });
    }
    ops.push({ op: 'put', collection: 'settlements', record: settlement });
    for (const t of txs) ops.push({ op: 'put', collection: 'transactions', record: { ...t, settlementId } });
    return ops;
  });
}

export function revokeSettlement(db, settlementId) {
  return commit(db, (ds) => {
    const s = ds.settlements.find((x) => x.id === settlementId);
    if (!s) throw new UserError('找不到這筆結算，可能已被撤銷。');
    const ops = ds.transactions
      .filter((t) => t.settlementId === settlementId)
      .map((t) => ({ op: 'put', collection: 'transactions', record: { ...t, settlementId: null } }));
    ops.push({ op: 'delete', collection: 'settlements', id: settlementId });
    if (s.transferTransactionId) ops.push({ op: 'delete', collection: 'transactions', id: s.transferTransactionId });
    return ops;
  });
}
