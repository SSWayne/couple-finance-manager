import { describe, it, expect } from 'vitest';
import { createTestDb } from './helpers.js';
import { loadDataset, replaceAll } from '../src/data/db.js';
import { buildSampleDataset } from './fixtures/sampleData.js';
import { budgetLevel, budgetSpent, budgetStatuses } from '../src/domain/budgets.js';
import { copyPreviousMonth, createBudget, deleteBudget, updateBudget } from '../src/domain/budgetService.js';
import { bucketSeries, buildReminders, monthToDate, periodBuckets, spendingByCategory } from '../src/domain/dashboard.js';
import { periodSummary } from '../src/domain/balances.js';
import { goalProgress } from '../src/domain/savings.js';
import { UserError } from '../src/domain/errors.js';
import { ValidationError } from '../src/data/validate.js';

const TODAY = '2026-10-12';

describe('預算', () => {
  const ds = buildSampleDataset();
  const b = (scope, extra = {}) => ({ month: '2026-09', scope, memberId: null, categoryId: null, amount: 1000, ...extra });

  it('各範圍的已用金額', () => {
    // 九月支出：房租 20000(共同) 全聯 1801(共同) 外套 1500(小雯個人) 晚餐 2000(共同) 捷運 300(阿哲個人) 婚宴 30000(共同) 網路 999(共同)
    expect(budgetSpent(ds, b('household'))).toBe(56600);
    expect(budgetSpent(ds, b('shared'))).toBe(20000 + 1801 + 2000 + 30000 + 999);
    expect(budgetSpent(ds, b('personal', { memberId: 'member-partner' }))).toBe(1500);
    expect(budgetSpent(ds, b('personal', { memberId: 'member-self' }))).toBe(300);
    // 分類預算含子分類：居住（房租＋網路電信）
    expect(budgetSpent(ds, b('category', { categoryId: 'cat-exp-housing' }))).toBe(20999);
  });

  it('80% 提醒、超過 100% 警告', () => {
    expect(budgetLevel(799, 1000)).toBe('ok');
    expect(budgetLevel(800, 1000)).toBe('warning');
    expect(budgetLevel(1000, 1000)).toBe('warning');
    expect(budgetLevel(1001, 1000)).toBe('over');
  });

  it('本月預算狀態依範圍排序', () => {
    const list = budgetStatuses(ds, '2026-10');
    expect(list.map((s) => s.budget.scope)).toEqual(['household', 'personal', 'category']);
    expect(list[0]).toMatchObject({ spent: 260, remaining: 59740, level: 'ok' });
  });

  it('新增、修改、刪除；同月份同範圍不可重複', async () => {
    const db = await createTestDb();
    const [x] = await createBudget(db, { month: '2026-10', scope: 'household', amount: 30000 });
    await expect(createBudget(db, { month: '2026-10', scope: 'household', amount: 1 })).rejects.toBeInstanceOf(UserError);
    await expect(createBudget(db, { month: '2026-10', scope: 'personal', amount: 1 })).rejects.toBeInstanceOf(ValidationError);
    await updateBudget(db, x.id, { amount: 35000, note: '調高' });
    expect((await loadDataset(db)).budgets[0]).toMatchObject({ amount: 35000, note: '調高' });
    await deleteBudget(db, x.id);
    expect((await loadDataset(db)).budgets).toHaveLength(0);
  });

  it('複製上月預算：略過已存在的範圍', async () => {
    const db = await createTestDb();
    await createBudget(db, { month: '2026-09', scope: 'household', amount: 50000 });
    await createBudget(db, { month: '2026-09', scope: 'category', categoryId: 'cat-exp-food', amount: 8000 });
    await createBudget(db, { month: '2026-09', scope: 'personal', memberId: 'member-self', amount: 5000 });
    await createBudget(db, { month: '2026-10', scope: 'household', amount: 60000 });
    const r = await copyPreviousMonth(db, '2026-10');
    expect(r).toMatchObject({ created: 2, skipped: 1, prevMonth: '2026-09' });
    const oct = (await loadDataset(db)).budgets.filter((x) => x.month === '2026-10');
    expect(oct).toHaveLength(3);
    expect(oct.find((x) => x.scope === 'household').amount).toBe(60000);
    await expect(copyPreviousMonth(db, '2026-12')).rejects.toBeInstanceOf(UserError);
  });
});

describe('Dashboard 統計', () => {
  const ds = buildSampleDataset();

  it('區間切分', () => {
    expect(periodBuckets('7d', TODAY)).toHaveLength(7);
    expect(periodBuckets('7d', TODAY).at(-1)).toMatchObject({ from: TODAY, to: TODAY, label: '週一' });
    const month = periodBuckets('month', TODAY);
    expect(month).toHaveLength(31);
    expect(month[12].future).toBe(true);
    const w = periodBuckets('3m', TODAY);
    expect(w).toHaveLength(13);
    expect(w.at(-1).to).toBe(TODAY);
    const m12 = periodBuckets('12m', TODAY);
    expect(m12.map((b) => b.label).slice(-2)).toEqual(['9月', '10月']);
    expect(m12[0].from).toBe('2025-11-01');
  });

  it('區間收支加總與 periodSummary 一致（轉帳不計）', () => {
    const buckets = periodBuckets('6m', TODAY);
    const series = bucketSeries(ds, buckets);
    const total = series.reduce((s, x) => ({ income: s.income + x.income, expense: s.expense + x.expense }), { income: 0, expense: 0 });
    const ref = periodSummary(ds, buckets[0].from, buckets.at(-1).to);
    expect(total).toEqual({ income: ref.income, expense: ref.expense });
    expect(series.at(-2)).toEqual({ income: 106600, expense: 56600, net: 50000 });
  });

  it('本月至今與上月同期比較', () => {
    const r = monthToDate(ds, TODAY);
    expect(r.current).toMatchObject({ income: 52000, expense: 260, net: 51740 });
    // 9/1–9/12：薪資 100000；房租 20000、全聯 1801、網路 999、晚餐 2000
    expect(r.previous).toMatchObject({ income: 100000, expense: 24800 });
    expect(r.change.income).toBeCloseTo(-0.48);
    expect(r.current.savingsRate).toBeCloseTo(51740 / 52000);
  });

  it('支出分析依主分類合併子分類，超過上限合併為其他', () => {
    const r = spendingByCategory(ds, '2026-09-01', '2026-09-30');
    expect(r.total).toBe(56600);
    expect(r.items.map((x) => [x.name, x.amount])).toEqual([['婚禮', 30000], ['居住', 20999], ['餐飲', 2000], ['日用品', 1801], ['服飾', 1500], ['交通', 300]]);
    const small = spendingByCategory(ds, '2026-09-01', '2026-09-30', 3);
    expect(small.items).toHaveLength(3);
    expect(small.items[2]).toMatchObject({ name: '其他 4 類', amount: 2000 + 1801 + 1500 + 300 });
    expect(small.items.reduce((s, x) => s + x.ratio, 0)).toBeCloseTo(1);
  });

  it('財務提醒由真實資料產生', () => {
    const texts = buildReminders(ds, TODAY).map((r) => r.text);
    expect(texts).toContain('備份：尚未匯出過備份');
    expect(texts.some((t) => t.includes('未結算代墊 4 筆') && t.includes('24,699'))).toBe(true);
    expect(texts.some((t) => t.includes('阿哲信用卡待繳卡費 $260'))).toBe(true);
    expect(texts).toHaveLength(3);
  });

  it('儲蓄目標每月建議＝⌈剩餘÷剩餘月數⌉', () => {
    const goal = ds.savingsGoals.find((g) => g.id === 'goal-house');
    const p = goalProgress(ds, goal, TODAY);
    expect(p).toMatchObject({ saved: 10000, remaining: 2390000, monthsLeft: 27, monthlySuggestion: 88519 });
    const trip = goalProgress(ds, ds.savingsGoals.find((g) => g.id === 'goal-trip'), TODAY);
    expect(trip).toMatchObject({ saved: 4000, monthsLeft: null, monthlySuggestion: 0 });
  });

  it('寫入資料庫後統計一致', async () => {
    const db = await createTestDb();
    await replaceAll(db, ds);
    const again = await loadDataset(db);
    expect(monthToDate(again, TODAY)).toEqual(monthToDate(ds, TODAY));
  });
});
