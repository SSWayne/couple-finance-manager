import { describe, it, expect } from 'vitest';
import { createTestDb } from './helpers.js';
import { loadDataset, replaceAll } from '../src/data/db.js';
import { buildSampleDataset } from './fixtures/sampleData.js';
import { amortizationSchedule, amortizedPayment, averageMonthlyIncome, mortgageIncomeRatio, yearlySummary } from '../src/domain/mortgage.js';
import { weddingSummary, itemSummary } from '../src/domain/wedding.js';
import { deleteWeddingGift, deleteWeddingItem, deleteWeddingProject, saveWeddingGift, saveWeddingItem, saveWeddingProject } from '../src/domain/weddingService.js';
import { saveHousingPlan, deleteHousingPlan } from '../src/domain/housingService.js';
import { createAccount } from '../src/domain/accountService.js';
import { createTransaction, deleteTransaction, updateTransaction } from '../src/domain/transactionService.js';
import { computeBalances } from '../src/domain/balances.js';
import { UserError } from '../src/domain/errors.js';
import { ValidationError } from '../src/data/validate.js';

describe('房貸試算', () => {
  it('教科書案例：100 萬、年利率 12%、1 年 → 每月 88,849', () => {
    expect(amortizedPayment(1000000, 12, 12)).toBe(88849);
    const s = amortizationSchedule({ loanAmount: 1000000, annualRate: 12, loanYears: 1 });
    expect(s.rows).toHaveLength(12);
    expect(s.monthlyPayment).toBe(88849);
    expect(s.rows[0]).toMatchObject({ interest: 10000, principal: 78849, balance: 921151 });
    expect(s.rows.slice(0, 11).every((r) => r.payment === 88849)).toBe(true);
    expect(s.rows.at(-1).balance).toBe(0);
    expect(s.rows.reduce((t, r) => t + r.principal, 0)).toBe(1000000);
    expect(s.totalPayment).toBe(s.totalInterest + 1000000);
  });

  it('每月利息四捨五入到元，最後一期結清剩餘本金', () => {
    const s = amortizationSchedule({ loanAmount: 9600000, annualRate: 2.185, loanYears: 30 });
    for (const r of s.rows) expect(Number.isSafeInteger(r.interest) && Number.isSafeInteger(r.principal)).toBe(true);
    expect(s.rows.at(-1).balance).toBe(0);
    expect(s.rows.reduce((t, r) => t + r.principal, 0)).toBe(9600000);
    // 月付金四捨五入每期最多差 0.5 元，最後一期結清時累計差額不會超過期數 × 0.5（再加利息影響）
    expect(Math.abs(s.rows.at(-1).payment - s.monthlyPayment)).toBeLessThan(360 * 0.5 * 1.1);
    expect(s.rows.at(-1).principal).toBe(s.rows.at(-2).balance);
  });

  it('寬限期只繳利息，寬限期後再本息平均攤還', () => {
    const s = amortizationSchedule({ loanAmount: 1200000, annualRate: 2.4, loanYears: 10, gracePeriodYears: 2, startMonth: '2027-01' });
    expect(s.graceMonths).toBe(24);
    expect(s.rows.slice(0, 24).every((r) => r.principal === 0 && r.payment === 2400 && r.grace)).toBe(true);
    expect(s.gracePayment).toBe(2400);
    expect(s.monthlyPayment).toBe(amortizedPayment(1200000, 2.4, 96));
    expect(s.rows[24].payment).toBe(s.monthlyPayment);
    expect(s.rows.at(-1)).toMatchObject({ month: '2036-12', balance: 0 });
    const years = yearlySummary(s.rows);
    expect(years).toHaveLength(10);
    expect(years[0]).toMatchObject({ grace: true, principal: 0, interest: 28800 });
  });

  it('利率 0：本金平均分攤', () => {
    const s = amortizationSchedule({ loanAmount: 120000, annualRate: 0, loanYears: 1 });
    expect(s.monthlyPayment).toBe(10000);
    expect(s.totalInterest).toBe(0);
    expect(s.rows.at(-1).balance).toBe(0);
  });

  it('房貸收入比＝寬限期後月付金 ÷ 近 3 個完整月平均收入；超過 1/3 提醒', () => {
    const ds = buildSampleDataset();
    // 今天 2026-10-12 → 7、8、9 月；只有 9 月有收入 106,600
    const avg = averageMonthlyIncome(ds, '2026-10-12');
    expect(avg.months.map((m) => m.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(avg.average).toBe(Math.round(106600 / 3));
    const plan = ds.housingPlans[0];
    const r = mortgageIncomeRatio(ds, plan, '2026-10-12');
    expect(r.monthlyPayment).toBe(amortizationSchedule(plan).monthlyPayment);
    expect(r.ratio).toBeCloseTo(r.monthlyPayment / avg.average);
    expect(r.overLimit).toBe(true);
    const empty = { ...ds, transactions: [] };
    expect(mortgageIncomeRatio(empty, plan, '2026-10-12').ratio).toBeNull();
  });

  it('購屋規劃新增、修改、刪除；頭期款不可超過房價', async () => {
    const db = await createTestDb();
    const base = { name: '方案 A', housePrice: 10000000, downPayment: 2000000, loanAmount: 8000000, annualRate: 2.2, loanYears: 30, gracePeriodYears: 0, otherCosts: 0 };
    const [p] = await saveHousingPlan(db, null, base);
    await saveHousingPlan(db, p.id, { ...base, annualRate: 2.5 });
    expect((await loadDataset(db)).housingPlans[0].annualRate).toBe(2.5);
    await expect(saveHousingPlan(db, p.id, { ...base, downPayment: 20000000 })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveHousingPlan(db, p.id, { ...base, gracePeriodYears: 30 })).rejects.toBeInstanceOf(ValidationError);
    await deleteHousingPlan(db, p.id);
    expect((await loadDataset(db)).housingPlans).toHaveLength(0);
  });
});

describe('婚禮基金', () => {
  it('費用＝實際（無則預估）；已付款＝手動＋關聯交易；淨支出＝費用−禮金', () => {
    const ds = buildSampleDataset();
    const s = weddingSummary(ds);
    const banquet = s.items.find((x) => x.item.id === 'we-banquet');
    expect(banquet).toMatchObject({ cost: 450000, linkedPaid: 30000, paid: 30000, unpaid: 420000 });
    const rings = s.items.find((x) => x.item.id === 'we-rings');
    expect(rings).toMatchObject({ cost: 0, paid: 40000, overpaid: 40000 });
    expect(s.totalGifts).toBe(6600 + 3600);
    expect(s.netExpense).toBe(450000 - 10200);
    const withActual = itemSummary(ds, { ...ds.weddingExpenses[0], actualAmount: 480000 });
    expect(withActual.cost).toBe(480000);
  });

  it('建立專案時自動建立 9 個預設項目（金額 0）', async () => {
    const db = await createTestDb();
    await saveWeddingProject(db, { name: '我們的婚禮', weddingDate: '2027-05-20', totalBudget: 800000 });
    const ds = await loadDataset(db);
    expect(ds.weddingProject).toMatchObject({ id: 'wedding-project', totalBudget: 800000 });
    expect([...ds.weddingExpenses].sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.name)).toEqual(['婚宴', '婚紗攝影', '婚戒', '喜餅', '新娘秘書', '婚禮佈置', '喜帖', '蜜月', '其他']);
    expect(ds.weddingExpenses.every((i) => i.estimatedAmount === 0 && i.actualAmount === null)).toBe(true);
    await saveWeddingProject(db, { name: '改名', weddingDate: null, totalBudget: 900000 });
    expect((await loadDataset(db)).weddingExpenses).toHaveLength(9);
  });

  it('禮金選擇入帳帳戶時自動建立收入交易並雙向連動', async () => {
    const db = await createTestDb();
    await saveWeddingProject(db, { name: '婚禮', totalBudget: 0 });
    const [acc] = await createAccount(db, { name: '禮金帳戶', type: 'bank', ownershipType: 'shared', openingBalance: 0 });
    const [acc2] = await createAccount(db, { name: '現金', type: 'cash', ownershipType: 'shared', openingBalance: 0 });
    const saved = await saveWeddingGift(db, null, { giverName: '王伯伯', relation: '長輩', side: 'partner', amount: 12000, date: '2027-05-20', accountId: acc.id });
    let ds = await loadDataset(db);
    const gift = ds.weddingGifts[0];
    const tx = ds.transactions.find((t) => t.id === gift.transactionId);
    expect(tx).toMatchObject({ type: 'income', amount: 12000, categoryId: 'cat-inc-gift', accountId: acc.id, date: '2027-05-20', description: '禮金：王伯伯', memberId: 'member-partner' });
    expect(computeBalances(ds).get(acc.id)).toBe(12000);
    expect(saved).toHaveLength(2);

    // 修改禮金 → 交易同步
    await saveWeddingGift(db, gift.id, { giverName: '王伯伯', relation: '長輩', side: 'partner', amount: 16000, date: '2027-05-21', accountId: acc2.id });
    ds = await loadDataset(db);
    expect(ds.transactions.find((t) => t.id === gift.transactionId)).toMatchObject({ amount: 16000, date: '2027-05-21', accountId: acc2.id });
    expect(computeBalances(ds).get(acc.id)).toBe(0);

    // 從收支記帳不能改金額或刪除
    await expect(updateTransaction(db, gift.transactionId, { ...tx, amount: 1, accountId: acc2.id, date: '2027-05-21' })).rejects.toThrow('婚禮基金');
    await expect(deleteTransaction(db, gift.transactionId)).rejects.toThrow('婚禮基金');

    // 取消入帳帳戶 → 刪除交易
    await saveWeddingGift(db, gift.id, { giverName: '王伯伯', side: 'partner', amount: 16000, date: '2027-05-21', accountId: '' });
    ds = await loadDataset(db);
    expect(ds.weddingGifts[0].transactionId).toBeNull();
    expect(ds.transactions).toHaveLength(0);

    // 重新入帳後刪除禮金 → 交易一起刪除
    await saveWeddingGift(db, gift.id, { giverName: '王伯伯', side: 'partner', amount: 16000, date: '2027-05-21', accountId: acc.id });
    await deleteWeddingGift(db, gift.id);
    ds = await loadDataset(db);
    expect(ds.weddingGifts).toHaveLength(0);
    expect(ds.transactions).toHaveLength(0);
  });

  it('關聯交易計入已付款；有關聯的項目與專案不可刪除', async () => {
    const db = await createTestDb();
    await saveWeddingProject(db, { name: '婚禮', totalBudget: 0 });
    const [acc] = await createAccount(db, { name: '共同', type: 'bank', ownershipType: 'shared', openingBalance: 100000 });
    let ds = await loadDataset(db);
    const photo = ds.weddingExpenses.find((i) => i.name === '婚紗攝影');
    await saveWeddingItem(db, photo.id, { ...photo, estimatedAmount: 60000, manualPaidAmount: 10000, manualPaidNote: '媽媽先付' });
    const [t] = await createTransaction(db, { type: 'expense', date: '2027-01-10', amount: 20000, accountId: acc.id, categoryId: 'cat-exp-wedding', memberId: 'member-self', ownershipType: 'shared', splitMode: 'equal', weddingExpenseId: photo.id });
    expect(t.weddingExpenseId).toBe(photo.id);
    ds = await loadDataset(db);
    expect(weddingSummary(ds).items.find((x) => x.item.id === photo.id)).toMatchObject({ paid: 30000, unpaid: 30000 });

    await expect(deleteWeddingItem(db, photo.id)).rejects.toBeInstanceOf(UserError);
    await expect(deleteWeddingProject(db)).rejects.toThrow('取消關聯');
    // 收支記帳把關聯拿掉後就可以刪除
    await updateTransaction(db, t.id, { type: 'expense', date: '2027-01-10', amount: 20000, accountId: acc.id, categoryId: 'cat-exp-wedding', memberId: 'member-self', ownershipType: 'shared', splitMode: 'equal', weddingExpenseId: '' });
    await deleteWeddingItem(db, photo.id);
    // 不帶 weddingExpenseId 欄位的修改不會改動關聯
    const ds2 = await loadDataset(db);
    expect(ds2.transactions[0].weddingExpenseId).toBeNull();
    await deleteWeddingProject(db);
    const ds3 = await loadDataset(db);
    expect(ds3.weddingProject).toBeNull();
    expect(ds3.weddingExpenses).toHaveLength(0);
    expect(ds3.transactions).toHaveLength(1);
  });

  it('有已入帳禮金時不可刪除專案（避免連帶刪除帳本資料）', async () => {
    const db = await createTestDb();
    await replaceAll(db, buildSampleDataset());
    await expect(deleteWeddingProject(db)).rejects.toThrow('已入帳');
  });
});
