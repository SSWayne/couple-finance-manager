/**
 * 完整整合測試：透過真實的服務函式建立一份完整的家庭帳本
 * （2 位成員、5 個帳戶、20 筆以上各類交易、共同支出與結算、婚禮、購屋、儲蓄目標、預算、固定收支、設定），
 * → 匯出 JSON → 刪除整個 IndexedDB → 重新開啟並匯入
 * → 驗證所有集合、ID、關聯、餘額、分攤、統計完全一致。
 *
 * 設定 CF_INTEGRATION_OUT=<路徑> 時會輸出這份備份檔，可在 UI 匯入做截圖檢查。
 */
import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createTestDb } from './helpers.js';
import { FinanceDB, loadDataset } from '../src/data/db.js';
import { COLLECTION_NAMES, COLLECTIONS } from '../src/data/schema.js';
import { validateDataset } from '../src/data/validate.js';
import { buildBackup, parseBackupText, restoreDataset, serializeBackup } from '../src/data/backup.js';
import { renameMember, updateSettings, markBackupExported } from '../src/domain/settingsService.js';
import { createAccount } from '../src/domain/accountService.js';
import { createTransaction } from '../src/domain/transactionService.js';
import { createSettlement, advanceSummary } from '../src/domain/settlementService.js';
import { createBudget, copyPreviousMonth } from '../src/domain/budgetService.js';
import { saveWeddingProject, saveWeddingItem, saveWeddingGift } from '../src/domain/weddingService.js';
import { saveHousingPlan } from '../src/domain/housingService.js';
import { saveGoal, addContribution } from '../src/domain/savingsService.js';
import { saveRecurring, runRecurring } from '../src/domain/recurringService.js';
import { computeBalances, netWorth, periodSummary } from '../src/domain/balances.js';
import { budgetStatuses } from '../src/domain/budgets.js';
import { monthToDate, spendingByCategory, buildReminders, bucketSeries, periodBuckets } from '../src/domain/dashboard.js';
import { weddingSummary } from '../src/domain/wedding.js';
import { activeGoalProgress } from '../src/domain/savings.js';
import { amortizationSchedule, mortgageIncomeRatio } from '../src/domain/mortgage.js';
import { buildReport, REPORTS } from '../src/domain/reports.js';
import { computeAdvance, sumShares } from '../src/domain/split.js';

const SELF = 'member-self';
const PARTNER = 'member-partner';
const TODAY = '2026-10-12';

async function buildFamilyLedger(db) {
  await renameMember(db, SELF, '阿哲');
  await renameMember(db, PARTNER, '小雯');
  await updateSettings(db, { backupReminderDays: 14, dashboardPeriod: '6m' });

  const acc = async (name, type, ownershipType, ownerMemberId, openingBalance) => (await createAccount(db, { name, type, ownershipType, ownerMemberId, openingBalance, openingDate: '2026-06-30' }))[0];
  const joint = await acc('共同生活帳戶', 'bank', 'shared', null, 80000);
  const selfBank = await acc('阿哲薪轉', 'bank', 'personal', SELF, 120000);
  const partnerBank = await acc('小雯薪轉', 'bank', 'personal', PARTNER, 90000);
  const card = await acc('阿哲信用卡', 'credit_card', 'personal', SELF, -3500);
  const fund = await acc('購屋基金', 'savings', 'shared', null, 0);
  const cash = await acc('皮夾現金', 'cash', 'personal', PARTNER, 3000);

  const tx = async (input) => (await createTransaction(db, input))[0];
  const exp = (o) => ({ type: 'expense', memberId: SELF, ownershipType: 'shared', splitMode: 'equal', ...o });
  const inc = (o) => ({ type: 'income', ownershipType: 'personal', ...o });
  const trf = (o) => ({ type: 'transfer', ...o });

  for (const m of ['07', '08', '09', '10']) {
    await tx(inc({ date: `2026-${m}-05`, amount: 62000, accountId: selfBank.id, categoryId: 'cat-inc-salary', memberId: SELF, description: `${m} 月薪資` }));
    await tx(inc({ date: `2026-${m}-05`, amount: 55000, accountId: partnerBank.id, categoryId: 'cat-inc-salary', memberId: PARTNER, description: `${m} 月薪資` }));
  }
  await tx(inc({ date: '2026-09-20', amount: 8000, accountId: selfBank.id, categoryId: 'cat-inc-bonus', memberId: SELF, description: '中秋獎金' }));
  await tx({ ...inc({ date: '2026-09-25', amount: 1200, accountId: joint.id, categoryId: 'cat-inc-investment', memberId: SELF }), ownershipType: 'shared', description: '定存利息' });

  // 共同支出：50/50（含零頭）、自訂比例、自訂金額
  await tx(exp({ date: '2026-09-02', amount: 2501, accountId: card.id, categoryId: 'cat-exp-daily', paymentMethod: 'credit_card', description: '好市多', tags: ['日常', '囤貨'] }));
  await tx(exp({ date: '2026-09-06', amount: 1800, accountId: partnerBank.id, memberId: PARTNER, categoryId: 'cat-exp-food', subcategoryId: 'cat-exp-food-dinner', splitMode: 'ratio', ratio: { [SELF]: 60, [PARTNER]: 40 }, description: '燒肉' }));
  await tx(exp({ date: '2026-09-10', amount: 24000, accountId: joint.id, categoryId: 'cat-exp-housing', subcategoryId: 'cat-exp-housing-rent', splitMode: 'amount', shareAmounts: { [SELF]: 14000, [PARTNER]: 10000 }, paymentMethod: 'transfer', description: '九月房租' }));
  await tx(exp({ date: '2026-09-14', amount: 3333, accountId: cash.id, memberId: PARTNER, categoryId: 'cat-exp-entertainment', paymentMethod: 'cash', description: '演唱會門票', tags: ['週末'] }));
  // 個人支出、幫對方付個人支出（全額代墊）
  await tx(exp({ date: '2026-09-15', amount: 450, accountId: selfBank.id, categoryId: 'cat-exp-transport', ownershipType: 'personal', ownerMemberId: SELF, paymentMethod: 'e_payment' }));
  await tx(exp({ date: '2026-09-18', amount: 2680, accountId: card.id, categoryId: 'cat-exp-clothing', ownershipType: 'personal', ownerMemberId: PARTNER, paymentMethod: 'credit_card', description: '幫小雯買鞋' }));
  await tx(exp({ date: '2026-09-21', amount: 990, accountId: partnerBank.id, memberId: PARTNER, categoryId: 'cat-exp-medical', ownershipType: 'personal', ownerMemberId: SELF, description: '幫阿哲掛號' }));
  // 繳卡費（轉帳，不算支出）、存錢到共同帳戶
  await tx(trf({ date: '2026-09-25', amount: 9500, accountId: selfBank.id, toAccountId: card.id, memberId: SELF, description: '繳八月卡費' }));
  await tx(trf({ date: '2026-09-26', amount: 20000, accountId: partnerBank.id, toAccountId: joint.id, memberId: PARTNER, description: '存入共同帳戶' }));

  // 結算九月代墊（同時建立轉帳）
  await createSettlement(db, { date: '2026-09-30', createTransfer: true, fromAccountId: partnerBank.id, toAccountId: selfBank.id, note: '九月結算' });

  // 十月：未結算的代墊
  await tx(exp({ date: '2026-10-03', amount: 1555, accountId: card.id, categoryId: 'cat-exp-food', subcategoryId: 'cat-exp-food-lunch', paymentMethod: 'credit_card' }));
  await tx(exp({ date: '2026-10-08', amount: 640, accountId: cash.id, memberId: PARTNER, categoryId: 'cat-exp-daily' }));

  // 婚禮
  await saveWeddingProject(db, { name: '阿哲與小雯的婚禮', weddingDate: '2027-04-18', totalBudget: 900000, note: '' });
  let ds = await loadDataset(db);
  const banquet = ds.weddingExpenses.find((i) => i.name === '婚宴');
  const rings = ds.weddingExpenses.find((i) => i.name === '婚戒');
  await saveWeddingItem(db, banquet.id, { ...banquet, estimatedAmount: 480000 });
  await saveWeddingItem(db, rings.id, { ...rings, estimatedAmount: 60000, actualAmount: 58000, manualPaidAmount: 30000, manualPaidNote: '爸媽贊助' });
  await tx(exp({ date: '2026-10-01', amount: 50000, accountId: joint.id, categoryId: 'cat-exp-wedding', weddingExpenseId: banquet.id, description: '婚宴訂金' }));
  await saveWeddingGift(db, null, { giverName: '林阿姨', relation: '親戚', side: 'partner', amount: 12000, date: '2026-10-10', accountId: joint.id });
  await saveWeddingGift(db, null, { giverName: '同事們', relation: '同事', side: 'self', amount: 6600, date: '2026-10-11' });

  // 購屋
  await saveHousingPlan(db, null, { name: '新北三房', housePrice: 15800000, downPayment: 3200000, loanAmount: 12600000, annualRate: 2.185, loanYears: 30, gracePeriodYears: 3, startMonth: '2027-09', otherCosts: 450000, note: '' });

  // 儲蓄目標：轉帳撥款、標記撥款、提回
  const [goal] = await saveGoal(db, null, { name: '購屋頭期款', targetAmount: 3200000, targetDate: '2027-08-31', accountId: fund.id, icon: 'bi-house-heart' });
  const [trip] = await saveGoal(db, null, { name: '蜜月旅行', targetAmount: 180000, ownershipType: 'shared' });
  await addContribution(db, { goalId: goal.id, date: '2026-09-28', amount: 30000, direction: 'in', memberId: SELF, fromAccountId: joint.id });
  await addContribution(db, { goalId: trip.id, date: '2026-10-01', amount: 8000, direction: 'in', memberId: PARTNER });
  await addContribution(db, { goalId: trip.id, date: '2026-10-06', amount: 2000, direction: 'out', memberId: PARTNER, note: '先挪用' });

  // 預算：九月建立、十月複製（略過已存在）
  await createBudget(db, { month: '2026-09', scope: 'household', amount: 70000 });
  await createBudget(db, { month: '2026-09', scope: 'category', categoryId: 'cat-exp-food', amount: 6000 });
  await createBudget(db, { month: '2026-09', scope: 'personal', memberId: PARTNER, amount: 5000 });
  await createBudget(db, { month: '2026-10', scope: 'shared', amount: 40000 });
  await copyPreviousMonth(db, '2026-10');

  // 固定收支：網路費（開始日在過去，補產生）、每週零用錢（轉帳）
  await saveRecurring(db, null, { name: '光纖網路', frequency: 'monthly', startDate: '2026-07-31', type: 'expense', amount: 999, accountId: selfBank.id, categoryId: 'cat-exp-housing', subcategoryId: 'cat-exp-housing-internet', memberId: SELF, ownershipType: 'shared', splitMode: 'equal' });
  await saveRecurring(db, null, { name: '每週零用錢', frequency: 'weekly', startDate: '2026-09-07', endDate: '2026-10-05', type: 'transfer', amount: 1500, accountId: partnerBank.id, toAccountId: cash.id, memberId: PARTNER });
  await runRecurring(db, TODAY);

  await markBackupExported(db, '2026-10-12T01:00:00.000Z');
  return { joint, selfBank, partnerBank, card, fund, cash };
}

/** 所有統計與推導值的快照（用來比對匯入前後是否一致）。 */
function snapshot(ds) {
  const f = { from: '2026-07-01', to: '2026-10-31', memberId: '', ownership: '' };
  return {
    balances: Object.fromEntries([...computeBalances(ds)].sort()),
    netWorth: netWorth(ds).net,
    summary: periodSummary(ds, '2026-07-01', '2026-10-31'),
    mtd: monthToDate(ds, TODAY),
    series: bucketSeries(ds, periodBuckets('6m', TODAY)),
    spending: spendingByCategory(ds, '2026-09-01', '2026-09-30'),
    budgets: budgetStatuses(ds, '2026-10').map((s) => [s.title, s.spent, s.level]),
    advances: advanceSummary(ds).net,
    wedding: (({ totalCost, totalPaid, totalGifts, netExpense }) => ({ totalCost, totalPaid, totalGifts, netExpense }))(weddingSummary(ds)),
    goals: activeGoalProgress(ds, TODAY).map((g) => [g.goal.name, g.saved, g.monthlySuggestion]),
    mortgage: mortgageIncomeRatio(ds, ds.housingPlans[0], TODAY),
    schedule: amortizationSchedule(ds.housingPlans[0]).totalInterest,
    reminders: buildReminders(ds, TODAY).map((r) => r.text),
    reports: Object.fromEntries(REPORTS.map((r) => [r.key, buildReport(ds, r.key, f, { year: 2026 })])),
  };
}

const sortedDataset = (ds) => Object.fromEntries(COLLECTION_NAMES.map((n) => [n, Array.isArray(ds[n]) ? [...ds[n]].sort((a, b) => a.id.localeCompare(b.id)) : ds[n]]));

describe('完整整合測試', () => {
  it('建立完整帳本 → 匯出 → 刪除整個資料庫 → 匯入 → 所有資料與統計完全一致', async () => {
    const db = await createTestDb();
    const acc = await buildFamilyLedger(db);
    const before = await loadDataset(db);

    // ---- 資料量與內容符合需求 ----
    expect(validateDataset(before)).toEqual([]);
    expect(before.members.map((m) => m.name).sort()).toEqual(['小雯', '阿哲']);
    expect(before.accounts.length).toBeGreaterThanOrEqual(3);
    expect(before.transactions.length).toBeGreaterThanOrEqual(20);
    expect(new Set(before.transactions.map((t) => t.type))).toEqual(new Set(['income', 'expense', 'transfer']));
    expect(new Set(before.transactions.filter((t) => t.type === 'expense').map((t) => t.splitMode))).toEqual(new Set(['none', 'equal', 'ratio', 'amount']));
    expect(before.settlements).toHaveLength(1);
    expect(before.settlements[0].transferTransactionId).toBeTruthy();
    expect(before.weddingProject).toBeTruthy();
    expect(before.weddingExpenses).toHaveLength(9);
    expect(before.weddingGifts.filter((g) => g.transactionId)).toHaveLength(1);
    expect(before.housingPlans).toHaveLength(1);
    expect(before.savingsGoals).toHaveLength(2);
    expect(before.savingsContributions).toHaveLength(3);
    expect(before.budgets).toHaveLength(7); // 九月 3 筆＋十月共同 1 筆＋複製 3 筆
    expect(before.recurringTransactions).toHaveLength(2);
    expect(before.transactions.filter((t) => t.recurringId)).toHaveLength(3 + 5); // 網路 7/31、8/31、9/30；零用錢 9/7–10/5 共 5 週
    for (const t of before.transactions) {
      if (t.shares) expect(sumShares(t.shares)).toBe(t.amount);
    }

    // ---- 幾個關鍵數字（手算） ----
    const bal = computeBalances(before);
    expect(bal.get(acc.card.id)).toBe(-3500 - 2501 - 2680 + 9500 - 1555);
    expect(bal.get(acc.fund.id)).toBe(30000);
    expect(bal.get(acc.cash.id)).toBe(3000 - 3333 - 640 + 1500 * 5);
    const settledTxs = before.transactions.filter((t) => t.settlementId);
    expect(settledTxs).toHaveLength(6); // 好市多、燒肉、房租、演唱會、鞋、掛號
    const sNet = settledTxs.reduce((s, t) => {
      const a = computeAdvance(t);
      return s + (a.debtorId === PARTNER ? a.amount : -a.amount);
    }, 0);
    expect(before.settlements[0]).toMatchObject({ amount: Math.abs(sNet), fromMemberId: sNet > 0 ? PARTNER : SELF });

    const statsBefore = snapshot(before);
    const backupText = serializeBackup(await buildBackup(db, new Date('2026-10-12T02:00:00.000Z')));
    if (process.env.CF_INTEGRATION_OUT) {
      mkdirSync(dirname(process.env.CF_INTEGRATION_OUT), { recursive: true });
      writeFileSync(process.env.CF_INTEGRATION_OUT, backupText, 'utf8');
    }

    // ---- 刪除整個資料庫 ----
    const name = db.name;
    db.close();
    await Dexie.delete(name);
    expect(await Dexie.exists(name)).toBe(false);

    // 重新開啟：只剩預設資料
    const fresh = new FinanceDB(name);
    await fresh.open();
    const empty = await loadDataset(fresh);
    expect(empty.transactions).toHaveLength(0);
    expect(empty.accounts).toHaveLength(0);

    // ---- 匯入 ----
    const parsed = parseBackupText(backupText);
    expect(parsed.ok).toBe(true);
    expect(parsed.summary.counts).toMatchObject({ transactions: before.transactions.length, accounts: before.accounts.length, budgets: 7, savingsGoals: 2, weddingExpenses: 9, weddingGifts: 2 });
    await restoreDataset(fresh, parsed.dataset);
    const after = await loadDataset(fresh);

    // 所有集合、所有欄位、所有 ID 完全一致
    expect(sortedDataset(after)).toEqual(sortedDataset(before));
    for (const n of COLLECTION_NAMES) {
      if (COLLECTIONS[n].kind === 'list') expect(after[n].map((r) => r.id).sort()).toEqual(before[n].map((r) => r.id).sort());
    }
    // 關聯與商業規則仍然成立
    expect(validateDataset(after)).toEqual([]);
    // 餘額、分攤、代墊、預算、婚禮、儲蓄、房貸、報表、提醒全部一致
    expect(snapshot(after)).toEqual(statsBefore);

    // 再匯出一次：除了 exportedAt 之外完全相同
    const again = JSON.parse(serializeBackup(await buildBackup(fresh, new Date('2026-10-12T02:00:00.000Z'))));
    expect(again).toEqual(JSON.parse(backupText));

    // 匯入後再執行固定收支：不會重複產生
    expect((await runRecurring(fresh, TODAY)).count).toBe(0);

    fresh.close();
    await Dexie.delete(name);
  });
});
