import { describe, it, expect } from 'vitest';
import { createTestDb } from './helpers.js';
import { loadDataset } from '../src/data/db.js';
import { ValidationError } from '../src/data/validate.js';
import { createAccount, deleteAccount, setAccountArchived } from '../src/domain/accountService.js';
import { createTransaction, deleteTransaction, updateTransaction } from '../src/domain/transactionService.js';
import { createSettlement, revokeSettlement, advanceSummary } from '../src/domain/settlementService.js';
import { computeBalances, netWorth, periodSummary } from '../src/domain/balances.js';
import { UserError } from '../src/domain/errors.js';
import { toCsv, csvCell } from '../src/lib/csv.js';

const SELF = 'member-self';
const PARTNER = 'member-partner';

async function setup() {
  const db = await createTestDb();
  const [joint] = await createAccount(db, { name: '共同帳戶', type: 'bank', ownershipType: 'shared', openingBalance: 10000 });
  const [selfBank] = await createAccount(db, { name: '我的銀行', type: 'bank', ownershipType: 'personal', ownerMemberId: SELF, openingBalance: 5000 });
  const [partnerBank] = await createAccount(db, { name: '另一半銀行', type: 'bank', ownershipType: 'personal', ownerMemberId: PARTNER, openingBalance: 3000 });
  const [card] = await createAccount(db, { name: '我的信用卡', type: 'credit_card', ownershipType: 'personal', ownerMemberId: SELF, openingBalance: 0 });
  return { db, joint, selfBank, partnerBank, card };
}

const expense = (o) => ({ type: 'expense', date: '2026-10-01', categoryId: 'cat-exp-food', memberId: SELF, ownershipType: 'shared', splitMode: 'equal', ...o });

describe('收支與餘額', () => {
  it('收入、支出、修改、刪除，餘額＝期初＋交易推算', async () => {
    const { db, selfBank } = await setup();
    const [inc] = await createTransaction(db, { type: 'income', date: '2026-10-05', amount: 50000, accountId: selfBank.id, categoryId: 'cat-inc-salary', memberId: SELF, ownershipType: 'personal' });
    expect(inc.ownerMemberId).toBe(SELF);
    const [exp] = await createTransaction(db, expense({ amount: 1200, accountId: selfBank.id, ownershipType: 'personal' }));
    let ds = await loadDataset(db);
    expect(computeBalances(ds).get(selfBank.id)).toBe(5000 + 50000 - 1200);

    await updateTransaction(db, exp.id, expense({ amount: 2000, accountId: selfBank.id, ownershipType: 'personal', description: '改了' }));
    ds = await loadDataset(db);
    expect(computeBalances(ds).get(selfBank.id)).toBe(5000 + 50000 - 2000);
    expect(ds.transactions.find((t) => t.id === exp.id).description).toBe('改了');

    await deleteTransaction(db, exp.id);
    ds = await loadDataset(db);
    expect(computeBalances(ds).get(selfBank.id)).toBe(55000);
    expect(periodSummary(ds, '2026-10-01', '2026-10-31')).toEqual({ income: 50000, expense: 0, net: 50000, savingsRate: 1 });
  });

  it('轉帳不算收支，只移動餘額', async () => {
    const { db, joint, selfBank } = await setup();
    await createTransaction(db, { type: 'transfer', date: '2026-10-02', amount: 3000, accountId: selfBank.id, toAccountId: joint.id, memberId: SELF });
    const ds = await loadDataset(db);
    const b = computeBalances(ds);
    expect(b.get(selfBank.id)).toBe(2000);
    expect(b.get(joint.id)).toBe(13000);
    expect(periodSummary(ds, '2026-10-01', '2026-10-31')).toMatchObject({ income: 0, expense: 0, savingsRate: null });
  });

  it('信用卡消費＝支出且負債增加；繳卡費＝轉帳，不再算支出', async () => {
    const { db, selfBank, card, joint, partnerBank } = await setup();
    await createTransaction(db, expense({ amount: 1800, accountId: card.id, ownershipType: 'personal', paymentMethod: 'credit_card' }));
    let ds = await loadDataset(db);
    expect(computeBalances(ds).get(card.id)).toBe(-1800);
    expect(netWorth(ds)).toMatchObject({ assets: 10000 + 5000 + 3000, liabilities: 1800, net: 16200 });
    await createTransaction(db, { type: 'transfer', date: '2026-10-25', amount: 1800, accountId: selfBank.id, toAccountId: card.id, memberId: SELF });
    ds = await loadDataset(db);
    expect(computeBalances(ds).get(card.id)).toBe(0);
    expect(netWorth(ds)).toMatchObject({ liabilities: 0, net: 16200 });
    expect(periodSummary(ds, '2026-10-01', '2026-10-31').expense).toBe(1800);
    void joint;
    void partnerBank;
  });

  it('轉帳到同一帳戶被拒絕', async () => {
    const { db, selfBank } = await setup();
    await expect(createTransaction(db, { type: 'transfer', date: '2026-10-02', amount: 1, accountId: selfBank.id, toAccountId: selfBank.id, memberId: SELF })).rejects.toBeInstanceOf(ValidationError);
  });

  it('已停用帳戶不能用於新交易；有交易的帳戶不能刪除', async () => {
    const { db, selfBank } = await setup();
    await createTransaction(db, expense({ amount: 100, accountId: selfBank.id }));
    await expect(deleteAccount(db, selfBank.id)).rejects.toThrow('改用「停用」');
    await setAccountArchived(db, selfBank.id, true);
    await expect(createTransaction(db, expense({ amount: 100, accountId: selfBank.id }))).rejects.toThrow('已停用');
  });
});

describe('分攤', () => {
  it('50/50 零頭由付款人負擔', async () => {
    const { db, joint } = await setup();
    const [t] = await createTransaction(db, expense({ amount: 1001, accountId: joint.id, memberId: PARTNER }));
    expect(t.shares).toEqual({ [PARTNER]: 501, [SELF]: 500 });
  });

  it('自訂比例與自訂金額', async () => {
    const { db, joint } = await setup();
    const [r] = await createTransaction(db, expense({ amount: 1000, accountId: joint.id, splitMode: 'ratio', ratio: { [SELF]: 70, [PARTNER]: 30 } }));
    expect(r.shares).toEqual({ [SELF]: 700, [PARTNER]: 300 });
    const [a] = await createTransaction(db, expense({ amount: 1000, accountId: joint.id, splitMode: 'amount', shareAmounts: { [SELF]: 250, [PARTNER]: 750 } }));
    expect(a.shares).toEqual({ [SELF]: 250, [PARTNER]: 750 });
    await expect(createTransaction(db, expense({ amount: 1000, accountId: joint.id, splitMode: 'amount', shareAmounts: { [SELF]: 250, [PARTNER]: 700 } }))).rejects.toBeInstanceOf(UserError);
    await expect(createTransaction(db, expense({ amount: 1000, accountId: joint.id, splitMode: 'ratio', ratio: { [SELF]: 70, [PARTNER]: 20 } }))).rejects.toBeInstanceOf(UserError);
  });
});

describe('代墊結算', () => {
  it('互相抵銷後結清淨額、建立轉帳、鎖定、撤銷', async () => {
    const { db, joint, selfBank, partnerBank } = await setup();
    // 我付共同 1000（另一半欠 500）；另一半幫我付個人 300（我欠 300）→ 淨額另一半付我 200
    const [a] = await createTransaction(db, expense({ amount: 1000, accountId: joint.id, memberId: SELF }));
    const [b] = await createTransaction(db, expense({ amount: 300, accountId: partnerBank.id, memberId: PARTNER, ownershipType: 'personal', ownerMemberId: SELF }));
    let ds = await loadDataset(db);
    const sum = advanceSummary(ds);
    expect(sum.paidFor).toEqual({ [SELF]: 500, [PARTNER]: 300 });
    expect(sum.net).toEqual({ fromMemberId: PARTNER, toMemberId: SELF, amount: 200 });

    const [transfer] = await createSettlement(db, { date: '2026-10-31', createTransfer: true, fromAccountId: partnerBank.id, toAccountId: selfBank.id, note: '十月' });
    ds = await loadDataset(db);
    expect(ds.settlements).toHaveLength(1);
    const s = ds.settlements[0];
    expect(s).toMatchObject({ fromMemberId: PARTNER, toMemberId: SELF, amount: 200, transferTransactionId: transfer.id });
    expect(ds.transactions.filter((t) => t.settlementId === s.id).map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(computeBalances(ds).get(selfBank.id)).toBe(5000 + 200);
    expect(advanceSummary(ds).transactions).toHaveLength(0);

    // 已結算：鎖定金額、不可刪除；可改備註
    await expect(updateTransaction(db, a.id, expense({ amount: 999, accountId: joint.id }))).rejects.toThrow('已結算');
    await expect(deleteTransaction(db, a.id)).rejects.toThrow('撤銷結算');
    await updateTransaction(db, a.id, expense({ amount: 1000, accountId: joint.id, description: '備註可改' }));
    // 結算轉帳不可直接刪除
    await expect(deleteTransaction(db, transfer.id)).rejects.toThrow('雙人財務');

    await revokeSettlement(db, s.id);
    ds = await loadDataset(db);
    expect(ds.settlements).toHaveLength(0);
    expect(ds.transactions.find((t) => t.id === transfer.id)).toBeUndefined();
    expect(ds.transactions.every((t) => t.settlementId === null)).toBe(true);
    expect(computeBalances(ds).get(selfBank.id)).toBe(5000);
    await deleteTransaction(db, a.id);
  });

  it('淨額為 0 時結算不建立轉帳', async () => {
    const { db, joint, partnerBank, selfBank } = await setup();
    await createTransaction(db, expense({ amount: 600, accountId: joint.id, memberId: SELF }));
    await createTransaction(db, expense({ amount: 600, accountId: partnerBank.id, memberId: PARTNER }));
    const out = await createSettlement(db, { date: '2026-10-31', createTransfer: true, fromAccountId: partnerBank.id, toAccountId: selfBank.id });
    const ds = await loadDataset(db);
    expect(ds.settlements[0]).toMatchObject({ amount: 0, transferTransactionId: null });
    expect(out.filter((r) => r.type === 'transfer')).toHaveLength(0);
  });

  it('沒有代墊時不可結算；結算日之後的代墊不納入', async () => {
    const { db, joint } = await setup();
    await expect(createSettlement(db, { date: '2026-10-31', createTransfer: false })).rejects.toBeInstanceOf(UserError);
    await createTransaction(db, expense({ amount: 100, accountId: joint.id, date: '2026-11-05' }));
    await expect(createSettlement(db, { date: '2026-10-31', createTransfer: false })).rejects.toThrow('沒有未結算');
  });
});

describe('CSV', () => {
  it('加 BOM、跳脫引號、防公式注入，數字保持數字', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+886')).toBe("'+886");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell(-500)).toBe('-500');
    expect(csvCell('他說"好"')).toBe('"他說""好"""');
    const csv = toCsv([{ a: 'x,y', b: 1 }], [{ header: '欄A', value: (r) => r.a }, { header: '欄B', value: (r) => r.b }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe('﻿欄A,欄B\r\n"x,y",1\r\n');
  });
});
