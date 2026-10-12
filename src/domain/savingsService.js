/**
 * 儲蓄目標寫入服務。
 * - 撥款只是「標記」：不算支出、不增加資產。
 * - 撥款時選擇轉出帳戶 → 同一資料庫交易中建立實際轉帳（轉出帳戶 → 目標帳戶）。
 * - 提回不可超過已累積；提回不建立轉帳。
 * - 刪除撥款會一併刪除它建立的轉帳。
 * - 有撥款紀錄的目標不可刪除（請改為封存），避免連帶刪除實際轉帳。
 */
import { commit } from '../data/db.js';
import { makeRecord } from '../data/schema.js';
import { newId } from '../lib/id.js';
import { goalSaved } from './savings.js';
import { UserError } from './errors.js';

function goalFields(input) {
  const ownershipType = input.ownershipType === 'personal' ? 'personal' : 'shared';
  return {
    name: String(input.name ?? '').trim(),
    targetAmount: input.targetAmount,
    targetDate: input.targetDate || null,
    accountId: input.accountId || null,
    ownershipType,
    ownerMemberId: ownershipType === 'personal' ? input.ownerMemberId || null : null,
    icon: input.icon || 'bi-piggy-bank',
    note: String(input.note ?? '').trim(),
  };
}

export function saveGoal(db, id, input) {
  return commit(db, (ds) => {
    const fields = goalFields(input);
    if (!id) return [{ op: 'put', collection: 'savingsGoals', record: makeRecord('savingsGoals', fields) }];
    const prev = ds.savingsGoals.find((g) => g.id === id);
    if (!prev) throw new UserError('找不到此儲蓄目標');
    const hasTransfers = ds.savingsContributions.some((c) => c.goalId === id && c.transferTransactionId);
    if (hasTransfers && fields.accountId !== prev.accountId) {
      throw new UserError('這個目標已有撥款轉帳到目標帳戶，不能再更換目標帳戶。');
    }
    return [{ op: 'put', collection: 'savingsGoals', record: { ...prev, ...fields } }];
  });
}

export function setGoalStatus(db, id, status) {
  return commit(db, (ds) => {
    const prev = ds.savingsGoals.find((g) => g.id === id);
    if (!prev) throw new UserError('找不到此儲蓄目標');
    return [{ op: 'put', collection: 'savingsGoals', record: { ...prev, status } }];
  });
}

export function deleteGoal(db, id) {
  return commit(db, (ds) => {
    const goal = ds.savingsGoals.find((g) => g.id === id);
    if (!goal) throw new UserError('找不到此儲蓄目標');
    const n = ds.savingsContributions.filter((c) => c.goalId === id).length;
    if (n) throw new UserError(`「${goal.name}」有 ${n} 筆撥款紀錄，不能刪除。可以改為「封存」，紀錄會保留。`);
    return [{ op: 'delete', collection: 'savingsGoals', id }];
  });
}

/**
 * @param {{ goalId, date, amount: number (>0), direction: 'in'|'out', memberId, fromAccountId?, note? }} input
 */
export function addContribution(db, input) {
  return commit(db, (ds) => {
    const goal = ds.savingsGoals.find((g) => g.id === input.goalId);
    if (!goal) throw new UserError('找不到此儲蓄目標');
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new UserError('金額必須是大於 0 的整數');
    const out = input.direction === 'out';
    if (out) {
      const saved = goalSaved(ds, goal.id);
      if (input.amount > saved) throw new UserError(`提回金額 ${input.amount} 超過已累積的 ${saved}`);
    }
    const contribution = makeRecord('savingsContributions', {
      goalId: goal.id,
      date: input.date,
      amount: out ? -input.amount : input.amount,
      memberId: input.memberId,
      note: String(input.note ?? '').trim(),
    });
    const ops = [];
    if (!out && input.fromAccountId) {
      if (!goal.accountId) throw new UserError('這個目標沒有設定目標帳戶，無法同時建立轉帳。');
      if (input.fromAccountId === goal.accountId) throw new UserError('轉出帳戶不能和目標帳戶相同。');
      const from = ds.accounts.find((a) => a.id === input.fromAccountId);
      const to = ds.accounts.find((a) => a.id === goal.accountId);
      if (from?.archived || to?.archived) throw new UserError('不能使用已停用的帳戶建立撥款轉帳。');
      const tx = makeRecord('transactions', {
        id: newId(),
        date: input.date,
        type: 'transfer',
        amount: input.amount,
        accountId: input.fromAccountId,
        toAccountId: goal.accountId,
        memberId: input.memberId,
        categoryId: null,
        ownershipType: null,
        splitMode: 'none',
        shares: null,
        paymentMethod: 'transfer',
        description: `儲蓄撥款：${goal.name}`,
      });
      contribution.fromAccountId = input.fromAccountId;
      contribution.transferTransactionId = tx.id;
      ops.push({ op: 'put', collection: 'transactions', record: tx });
    }
    ops.push({ op: 'put', collection: 'savingsContributions', record: contribution });
    return ops;
  });
}

export function deleteContribution(db, id) {
  return commit(db, (ds) => {
    const c = ds.savingsContributions.find((x) => x.id === id);
    if (!c) throw new UserError('找不到此撥款紀錄');
    const ops = [{ op: 'delete', collection: 'savingsContributions', id }];
    if (c.transferTransactionId) ops.push({ op: 'delete', collection: 'transactions', id: c.transferTransactionId });
    return ops;
  });
}
