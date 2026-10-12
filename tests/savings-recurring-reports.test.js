import { describe, it, expect } from 'vitest';
import { createTestDb } from './helpers.js';
import { loadDataset, replaceAll } from '../src/data/db.js';
import { buildSampleDataset } from './fixtures/sampleData.js';
import { createAccount, setAccountArchived } from '../src/domain/accountService.js';
import { deleteTransaction } from '../src/domain/transactionService.js';
import { computeBalances, netWorth, periodSummary } from '../src/domain/balances.js';
import { goalProgress, goalSaved } from '../src/domain/savings.js';
import { addContribution, deleteContribution, deleteGoal, saveGoal, setGoalStatus } from '../src/domain/savingsService.js';
import { dueDates, occurrenceDate, nextOccurrence } from '../src/domain/recurring.js';
import { deleteRecurring, runRecurring, saveRecurring, setRecurringActive } from '../src/domain/recurringService.js';
import { buildReport, presetRange, REPORTS } from '../src/domain/reports.js';
import { UserError } from '../src/domain/errors.js';

const SELF = 'member-self';

async function setup() {
  const db = await createTestDb();
  const [bank] = await createAccount(db, { name: '薪轉', type: 'bank', ownershipType: 'personal', ownerMemberId: SELF, openingBalance: 100000 });
  const [fund] = await createAccount(db, { name: '旅遊基金', type: 'savings', ownershipType: 'shared', openingBalance: 0 });
  return { db, bank, fund };
}

describe('儲蓄目標', () => {
  it('撥款只是標記：不算支出、不增加資產；選擇轉出帳戶時建立實際轉帳', async () => {
    const { db, bank, fund } = await setup();
    const [goal] = await saveGoal(db, null, { name: '蜜月', targetAmount: 120000, targetDate: '2027-06-30', accountId: fund.id });
    await addContribution(db, { goalId: goal.id, date: '2026-10-01', amount: 5000, direction: 'in', memberId: SELF });
    let ds = await loadDataset(db);
    expect(goalSaved(ds, goal.id)).toBe(5000);
    expect(netWorth(ds).net).toBe(100000);
    expect(ds.transactions).toHaveLength(0);

    await addContribution(db, { goalId: goal.id, date: '2026-10-02', amount: 20000, direction: 'in', memberId: SELF, fromAccountId: bank.id });
    ds = await loadDataset(db);
    expect(goalSaved(ds, goal.id)).toBe(25000);
    const tx = ds.transactions[0];
    expect(tx).toMatchObject({ type: 'transfer', amount: 20000, accountId: bank.id, toAccountId: fund.id });
    expect(computeBalances(ds).get(fund.id)).toBe(20000);
    expect(netWorth(ds).net).toBe(100000);
    expect(periodSummary(ds, '2026-10-01', '2026-10-31').expense).toBe(0);
    // 撥款轉帳不能從收支記帳刪除
    await expect(deleteTransaction(db, tx.id)).rejects.toThrow('儲蓄目標');
    // 每月建議＝⌈剩餘÷剩餘月數⌉：2026-10 → 2027-06 共 9 個月，剩 95000 → 10556
    expect(goalProgress(ds, ds.savingsGoals[0], '2026-10-12')).toMatchObject({ monthsLeft: 9, monthlySuggestion: 10556 });
  });

  it('提回不可超過已累積；刪除撥款會一併刪除轉帳', async () => {
    const { db, bank, fund } = await setup();
    const [goal] = await saveGoal(db, null, { name: '緊急預備金', targetAmount: 60000, accountId: fund.id });
    await addContribution(db, { goalId: goal.id, date: '2026-10-01', amount: 3000, direction: 'in', memberId: SELF, fromAccountId: bank.id });
    await expect(addContribution(db, { goalId: goal.id, date: '2026-10-05', amount: 3001, direction: 'out', memberId: SELF })).rejects.toBeInstanceOf(UserError);
    await addContribution(db, { goalId: goal.id, date: '2026-10-05', amount: 1000, direction: 'out', memberId: SELF });
    let ds = await loadDataset(db);
    expect(goalSaved(ds, goal.id)).toBe(2000);
    // 刪除撥入會讓提回超過累積 → 被擋下（資料不變）
    const deposit = ds.savingsContributions.find((c) => c.amount > 0);
    await expect(deleteContribution(db, deposit.id)).rejects.toThrow('提回金額不可超過');
    const withdraw = ds.savingsContributions.find((c) => c.amount < 0);
    await deleteContribution(db, withdraw.id);
    await deleteContribution(db, deposit.id);
    ds = await loadDataset(db);
    expect(ds.savingsContributions).toHaveLength(0);
    expect(ds.transactions).toHaveLength(0);
  });

  it('有撥款的目標不能刪除（可封存）；有撥款轉帳後不能換目標帳戶', async () => {
    const { db, bank, fund } = await setup();
    const [goal] = await saveGoal(db, null, { name: '車子', targetAmount: 500000, accountId: fund.id });
    await addContribution(db, { goalId: goal.id, date: '2026-10-01', amount: 1000, direction: 'in', memberId: SELF, fromAccountId: bank.id });
    await expect(deleteGoal(db, goal.id)).rejects.toThrow('封存');
    await expect(saveGoal(db, goal.id, { name: '車子', targetAmount: 500000, accountId: bank.id })).rejects.toThrow('目標帳戶');
    await setGoalStatus(db, goal.id, 'archived');
    expect((await loadDataset(db)).savingsGoals[0].status).toBe('archived');
    const [empty] = await saveGoal(db, null, { name: '空目標', targetAmount: 1 });
    await deleteGoal(db, empty.id);
  });

  it('沒有目標帳戶時不能同時建立轉帳', async () => {
    const { db, bank } = await setup();
    const [goal] = await saveGoal(db, null, { name: '無帳戶', targetAmount: 1000 });
    await expect(addContribution(db, { goalId: goal.id, date: '2026-10-01', amount: 100, direction: 'in', memberId: SELF, fromAccountId: bank.id })).rejects.toThrow('目標帳戶');
  });
});

describe('固定收支排程', () => {
  it('1/31 每月 → 2/28 → 3/31（從開始日推算，不會越推越早）', () => {
    const rec = { startDate: '2026-01-31', frequency: 'monthly', endDate: null, skipBefore: null };
    expect(dueDates(rec, '2026-05-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
    expect(occurrenceDate('2024-02-29', 'yearly', 1)).toBe('2025-02-28');
    expect(occurrenceDate('2026-01-15', 'quarterly', 2)).toBe('2026-07-15');
    expect(dueDates({ startDate: '2026-10-01', frequency: 'weekly' }, '2026-10-22')).toEqual(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22']);
    expect(dueDates({ startDate: '2026-01-10', frequency: 'monthly', endDate: '2026-03-01' }, '2026-12-31')).toEqual(['2026-01-10', '2026-02-10']);
    expect(nextOccurrence(rec, '2026-02-28')).toBe('2026-03-31');
  });
});

describe('固定收支', () => {
  const base = (bank, o = {}) => ({ name: '房租', frequency: 'monthly', startDate: '2026-08-31', type: 'expense', amount: 15000, accountId: bank.id, categoryId: 'cat-exp-housing', memberId: SELF, ownershipType: 'shared', splitMode: 'equal', ...o });

  it('開啟網站時補入帳到期項目；重複執行不會重複產生', async () => {
    const { db, bank } = await setup();
    const [rec] = await saveRecurring(db, null, base(bank));
    const r1 = await runRecurring(db, '2026-10-12');
    expect(r1.count).toBe(2);
    let ds = await loadDataset(db);
    expect(ds.transactions.map((t) => t.date).sort()).toEqual(['2026-08-31', '2026-09-30']);
    expect(ds.transactions.every((t) => t.recurringId === rec.id && t.recurringDate === t.date && t.shares['member-self'] === 7500)).toBe(true);
    expect(ds.recurringTransactions[0].lastGeneratedDate).toBe('2026-09-30');
    expect((await runRecurring(db, '2026-10-12')).count).toBe(0);
    expect((await runRecurring(db, '2026-10-31')).count).toBe(1);
    ds = await loadDataset(db);
    expect(ds.transactions).toHaveLength(3);
  });

  it('刪除已產生的交易後再執行，會補回（以 recurringId＋日期判斷）；資料庫唯一索引防止重複', async () => {
    const { db, bank } = await setup();
    await saveRecurring(db, null, base(bank, { startDate: '2026-10-01' }));
    await runRecurring(db, '2026-10-12');
    let ds = await loadDataset(db);
    const dup = { ...ds.transactions[0], id: crypto.randomUUID() };
    await expect(db.table('transactions').add(dup)).rejects.toThrow();
    await deleteTransaction(db, ds.transactions[0].id);
    expect((await runRecurring(db, '2026-10-12')).count).toBe(1);
    ds = await loadDataset(db);
    expect(ds.transactions).toHaveLength(1);
  });

  it('暫停後恢復，不補產生暫停期間', async () => {
    const { db, bank } = await setup();
    const [rec] = await saveRecurring(db, null, base(bank, { startDate: '2026-06-05', amount: 999, name: '網路' }));
    await runRecurring(db, '2026-07-10'); // 6/5、7/5
    await setRecurringActive(db, rec.id, false, '2026-07-10');
    expect((await runRecurring(db, '2026-09-20')).count).toBe(0);
    await setRecurringActive(db, rec.id, true, '2026-09-20');
    const r = await runRecurring(db, '2026-10-12');
    expect(r.created[0].dates).toEqual(['2026-10-05']);
    const ds = await loadDataset(db);
    expect(ds.transactions.map((t) => t.date).sort()).toEqual(['2026-06-05', '2026-07-05', '2026-10-05']);
  });

  it('已產生後不可改開始日與週期；其他欄位可改；刪除範本保留交易', async () => {
    const { db, bank } = await setup();
    const [rec] = await saveRecurring(db, null, base(bank, { startDate: '2026-10-01' }));
    await runRecurring(db, '2026-10-12');
    await expect(saveRecurring(db, rec.id, base(bank, { startDate: '2026-10-02' }))).rejects.toThrow('不能修改');
    await expect(saveRecurring(db, rec.id, base(bank, { startDate: '2026-10-01', frequency: 'weekly' }))).rejects.toThrow('不能修改');
    await saveRecurring(db, rec.id, base(bank, { startDate: '2026-10-01', amount: 16000 }));
    await deleteRecurring(db, rec.id);
    const ds = await loadDataset(db);
    expect(ds.recurringTransactions).toHaveLength(0);
    expect(ds.transactions).toHaveLength(1);
    expect(ds.transactions[0]).toMatchObject({ recurringId: null, recurringDate: null, amount: 15000 });
  });

  it('帳戶停用時略過該範本並說明原因，不影響其他範本', async () => {
    const { db, bank, fund } = await setup();
    await saveRecurring(db, null, base(bank, { startDate: '2026-10-01', name: 'A' }));
    await saveRecurring(db, null, { name: 'B', frequency: 'monthly', startDate: '2026-10-01', type: 'transfer', amount: 1000, accountId: bank.id, toAccountId: fund.id, memberId: SELF });
    await setAccountArchived(db, fund.id, true);
    const r = await runRecurring(db, '2026-10-12');
    expect(r.count).toBe(1);
    expect(r.skipped).toEqual([{ name: 'B', reason: '帳戶「旅遊基金」已停用', count: 1 }]);
  });
});

describe('財務報表', () => {
  const ds = buildSampleDataset();
  const f = { from: '2026-09-01', to: '2026-10-31', memberId: '', ownership: '' };

  it('提供 10 種報表＋年度彙總', () => {
    expect(REPORTS).toHaveLength(11);
    for (const r of REPORTS) {
      const rep = buildReport(ds, r.key, f, { year: 2026 });
      expect(Array.isArray(rep.rows)).toBe(true);
      expect(rep.columns.length).toBeGreaterThan(1);
    }
  });

  it('月度收支、支出分類合計與 periodSummary 一致', () => {
    const ref = periodSummary(ds, f.from, f.to);
    const m = buildReport(ds, 'monthly', f);
    expect(m.rows.map((r) => r.month)).toEqual(['2026-09', '2026-10']);
    expect(m.footer).toMatchObject({ income: ref.income, expense: ref.expense, net: ref.net });
    const c = buildReport(ds, 'expenseCategory', f);
    expect(c.rows.reduce((s, r) => s + r.amount, 0)).toBe(ref.expense);
    expect(c.rows[0]).toMatchObject({ name: '婚禮', amount: 30000 });
  });

  it('成員實際負擔合計＝家庭總支出；帳戶淨變動合計＝收入−支出', () => {
    const m = buildReport(ds, 'member', f);
    const ref = periodSummary(ds, f.from, f.to);
    expect(m.footer.burden).toBe(ref.expense);
    expect(m.footer.paid).toBe(ref.expense);
    const a = buildReport(ds, 'account', f);
    expect(a.footer.change).toBe(ref.income - ref.expense);
    expect(a.footer.transferIn).toBe(a.footer.transferOut);
  });

  it('篩選：付款人、個人／共同', () => {
    const shared = buildReport(ds, 'ownership', { ...f, ownership: 'shared' });
    expect(shared.rows).toHaveLength(1);
    expect(shared.rows[0]).toMatchObject({ name: '共同支出', amount: 20000 + 1801 + 2000 + 30000 + 999 });
    const partner = buildReport(ds, 'expenseCategory', { ...f, memberId: 'member-partner' });
    expect(partner.footer.amount).toBe(2000);
  });

  it('年度彙總 12 個月，合計正確', () => {
    const y = buildReport(ds, 'yearly', f, { year: 2026 });
    expect(y.rows).toHaveLength(12);
    expect(y.summary).toMatchObject({ income: 158600, expense: 56860, monthsWithData: 2, avgExpense: 28430 });
    expect(y.rows[8]).toMatchObject({ month: '2026-09', income: 106600, expense: 56600 });
  });

  it('常用日期區間', () => {
    expect(presetRange('thisMonth', '2026-02-10')).toEqual(['2026-02-01', '2026-02-28']);
    expect(presetRange('lastMonth', '2026-01-10')).toEqual(['2025-12-01', '2025-12-31']);
    expect(presetRange('last12', '2026-10-12')).toEqual(['2025-11-01', '2026-10-31']);
  });

  it('寫入資料庫後報表相同', async () => {
    const db = await createTestDb();
    await replaceAll(db, ds);
    const again = await loadDataset(db);
    expect(buildReport(again, 'member', f)).toEqual(buildReport(ds, 'member', f));
  });
});
