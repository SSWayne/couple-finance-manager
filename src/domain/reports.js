/**
 * 財務報表（純函式）。每份報表回傳相同結構，畫面與 CSV 共用：
 *   { columns: [{ key, label, type: 'text'|'money'|'percent'|'int' }], rows: [...], footer?: {...}, barKey?: string, note?: string }
 *
 * 篩選 filter：{ from, to, memberId: ''|成員ID（收支的付款人／收款人）, ownership: ''|'shared'|'personal' }
 * 轉帳一律不計入收支（只出現在「帳戶收支」的轉入／轉出欄）。
 */
import { ENUMS } from '../data/schema.js';
import { computeAdvance, memberBurden } from './split.js';
import { budgetSpent, budgetTitle, budgetLevel, LEVEL_TEXT } from './budgets.js';
import { addMonthsToMonth, daysInMonth } from '../lib/date.js';
import { orderedMembers } from './lookup.js';

export const REPORTS = [
  { key: 'monthly', label: '月度收支趨勢', description: '每月收入、支出、結餘與儲蓄率' },
  { key: 'expenseCategory', label: '支出分類排行', description: '依主分類（含子分類）合計' },
  { key: 'expenseSubcategory', label: '子分類明細', description: '依「主分類 › 子分類」合計' },
  { key: 'incomeCategory', label: '收入來源', description: '依收入分類合計' },
  { key: 'account', label: '帳戶收支', description: '每個帳戶的收入、支出、轉入、轉出與淨變動' },
  { key: 'member', label: '成員收支與負擔', description: '個人收入、實際付款、實際負擔、替對方代墊' },
  { key: 'ownership', label: '個人／共同支出', description: '共同支出與各自個人支出的比例' },
  { key: 'paymentMethod', label: '付款方式', description: '依付款方式統計支出' },
  { key: 'tag', label: '標籤統計', description: '依標籤統計支出（一筆可有多個標籤）' },
  { key: 'budget', label: '預算達成', description: '期間內各月份預算與實際支出' },
  { key: 'yearly', label: '年度彙總', description: '選定年份每月收支與全年合計（不受日期篩選影響）' },
];

const money = (key, label) => ({ key, label, type: 'money' });
const text = (key, label) => ({ key, label, type: 'text' });
const pct = (key, label) => ({ key, label, type: 'percent' });
const int = (key, label) => ({ key, label, type: 'int' });

export function filterTransactions(ds, f) {
  return ds.transactions.filter((t) => {
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.memberId && t.memberId !== f.memberId) return false;
    if (f.ownership && t.type !== 'transfer' && t.ownershipType !== f.ownership) return false;
    if (f.ownership && t.type === 'transfer') return false;
    return true;
  });
}

const catName = (ds, id) => ds.categories.find((c) => c.id === id)?.name ?? '未分類';
const memberName = (ds, id) => ds.members.find((m) => m.id === id)?.name ?? '—';

function groupSum(txs, keyFn) {
  const map = new Map();
  for (const t of txs) {
    for (const k of [].concat(keyFn(t))) {
      const cur = map.get(k) ?? { amount: 0, count: 0 };
      cur.amount += t.amount;
      cur.count += 1;
      map.set(k, cur);
    }
  }
  return map;
}

function shareRows(map, labelFn, total) {
  return [...map].map(([k, v]) => ({ name: labelFn(k), amount: v.amount, count: v.count, ratio: total ? v.amount / total : 0 })).sort((a, b) => b.amount - a.amount);
}

function monthsBetween(from, to) {
  const out = [];
  let m = from.slice(0, 7);
  const end = to.slice(0, 7);
  while (m <= end && out.length < 240) {
    out.push(m);
    m = addMonthsToMonth(m, 1);
  }
  return out;
}

function monthlyRows(txs, months) {
  const rows = months.map((month) => ({ month, income: 0, expense: 0, net: 0, savingsRate: null }));
  const idx = new Map(months.map((m, i) => [m, i]));
  for (const t of txs) {
    const i = idx.get(t.date.slice(0, 7));
    if (i === undefined || t.type === 'transfer') continue;
    if (t.type === 'income') rows[i].income += t.amount;
    else rows[i].expense += t.amount;
  }
  for (const r of rows) {
    r.net = r.income - r.expense;
    r.savingsRate = r.income ? r.net / r.income : null;
  }
  return rows;
}

function totalsRow(rows, label, keys) {
  const out = { [Object.keys(rows[0] ?? { name: '' })[0]]: label };
  for (const k of keys) out[k] = rows.reduce((s, r) => s + (r[k] ?? 0), 0);
  return out;
}

export function buildReport(ds, key, f, { year } = {}) {
  const txs = filterTransactions(ds, f);
  const expenses = txs.filter((t) => t.type === 'expense');
  const incomes = txs.filter((t) => t.type === 'income');
  const expenseTotal = expenses.reduce((s, t) => s + t.amount, 0);
  const incomeTotal = incomes.reduce((s, t) => s + t.amount, 0);

  switch (key) {
    case 'monthly': {
      const rows = monthlyRows(txs, monthsBetween(f.from, f.to));
      const footer = { month: '合計', income: incomeTotal, expense: expenseTotal, net: incomeTotal - expenseTotal, savingsRate: incomeTotal ? (incomeTotal - expenseTotal) / incomeTotal : null };
      return { columns: [text('month', '月份'), money('income', '收入'), money('expense', '支出'), money('net', '結餘'), pct('savingsRate', '儲蓄率')], rows, footer, barKey: 'expense' };
    }
    case 'expenseCategory': {
      const rows = shareRows(groupSum(expenses, (t) => t.categoryId), (k) => catName(ds, k), expenseTotal);
      return { columns: [text('name', '分類'), money('amount', '金額'), pct('ratio', '占比'), int('count', '筆數')], rows, footer: { name: '合計', amount: expenseTotal, ratio: expenseTotal ? 1 : null, count: expenses.length }, barKey: 'amount' };
    }
    case 'expenseSubcategory': {
      const rows = shareRows(groupSum(expenses, (t) => `${t.categoryId}|${t.subcategoryId ?? ''}`), (k) => {
        const [c, s] = k.split('|');
        return s ? `${catName(ds, c)} › ${catName(ds, s)}` : `${catName(ds, c)}（未指定子分類）`;
      }, expenseTotal);
      return { columns: [text('name', '分類 › 子分類'), money('amount', '金額'), pct('ratio', '占比'), int('count', '筆數')], rows, footer: { name: '合計', amount: expenseTotal, ratio: expenseTotal ? 1 : null, count: expenses.length }, barKey: 'amount' };
    }
    case 'incomeCategory': {
      const rows = shareRows(groupSum(incomes, (t) => t.categoryId), (k) => catName(ds, k), incomeTotal);
      return { columns: [text('name', '收入分類'), money('amount', '金額'), pct('ratio', '占比'), int('count', '筆數')], rows, footer: { name: '合計', amount: incomeTotal, ratio: incomeTotal ? 1 : null, count: incomes.length }, barKey: 'amount' };
    }
    case 'account': {
      // 帳戶報表不套用個人／共同篩選以外的轉帳排除：轉帳本來就要算進帳戶變動
      const all = filterTransactions(ds, { ...f, ownership: '' });
      const rows = [...ds.accounts].sort((a, b) => a.sortOrder - b.sortOrder).map((a) => {
        const r = { name: a.name + (a.archived ? '（已停用）' : ''), income: 0, expense: 0, transferIn: 0, transferOut: 0, change: 0 };
        for (const t of all) {
          if (t.type === 'income' && t.accountId === a.id) r.income += t.amount;
          if (t.type === 'expense' && t.accountId === a.id) r.expense += t.amount;
          if (t.type === 'transfer' && t.toAccountId === a.id) r.transferIn += t.amount;
          if (t.type === 'transfer' && t.accountId === a.id) r.transferOut += t.amount;
        }
        r.change = r.income - r.expense + r.transferIn - r.transferOut;
        return r;
      });
      return { columns: [text('name', '帳戶'), money('income', '收入'), money('expense', '支出'), money('transferIn', '轉入'), money('transferOut', '轉出'), money('change', '淨變動')], rows, footer: totalsRow(rows, '合計', ['income', 'expense', 'transferIn', 'transferOut', 'change']), note: '轉帳不算收支，但會影響帳戶淨變動；合計的轉入與轉出會互相抵銷。' };
    }
    case 'member': {
      const rows = orderedMembers(ds).map((m) => {
        const r = { name: m.name, income: 0, paid: 0, burden: 0, advanced: 0 };
        for (const t of txs) {
          if (t.type === 'income' && t.ownershipType === 'personal' && t.ownerMemberId === m.id) r.income += t.amount;
          if (t.type === 'expense') {
            if (t.memberId === m.id) r.paid += t.amount;
            r.burden += memberBurden(t, m.id);
            const adv = computeAdvance(t);
            if (adv?.creditorId === m.id) r.advanced += adv.amount;
          }
        }
        return r;
      });
      return { columns: [text('name', '成員'), money('income', '個人收入'), money('paid', '實際付款'), money('burden', '實際負擔'), money('advanced', '替對方代墊')], rows, footer: totalsRow(rows, '合計', ['income', 'paid', 'burden', 'advanced']), note: '實際負擔＝個人支出＋共同支出的分攤；兩人實際負擔合計＝家庭總支出。' };
    }
    case 'ownership': {
      const map = groupSum(expenses, (t) => (t.ownershipType === 'shared' ? 'shared' : `personal|${t.ownerMemberId}`));
      const rows = shareRows(map, (k) => (k === 'shared' ? '共同支出' : `${memberName(ds, k.split('|')[1])}個人支出`), expenseTotal);
      return { columns: [text('name', '類別'), money('amount', '金額'), pct('ratio', '占比'), int('count', '筆數')], rows, footer: { name: '合計', amount: expenseTotal, ratio: expenseTotal ? 1 : null, count: expenses.length }, barKey: 'amount' };
    }
    case 'paymentMethod': {
      const rows = shareRows(groupSum(expenses, (t) => t.paymentMethod ?? ''), (k) => (k ? ENUMS.paymentMethod[k] : '未指定'), expenseTotal);
      return { columns: [text('name', '付款方式'), money('amount', '金額'), pct('ratio', '占比'), int('count', '筆數')], rows, footer: { name: '合計', amount: expenseTotal, ratio: expenseTotal ? 1 : null, count: expenses.length }, barKey: 'amount' };
    }
    case 'tag': {
      const rows = shareRows(groupSum(expenses, (t) => (t.tags?.length ? t.tags : ['（無標籤）'])), (k) => (k === '（無標籤）' ? k : `#${k}`), expenseTotal);
      return { columns: [text('name', '標籤'), money('amount', '金額'), pct('ratio', '占支出比'), int('count', '筆數')], rows, barKey: 'amount', note: '一筆交易有多個標籤時，會分別計入每個標籤，所以各標籤加總可能大於總支出。' };
    }
    case 'budget': {
      const months = new Set(monthsBetween(f.from, f.to));
      const rows = ds.budgets.filter((b) => months.has(b.month)).map((b) => {
        const spent = budgetSpent(ds, b);
        return { month: b.month, name: budgetTitle(ds, b), amount: b.amount, spent, remaining: b.amount - spent, ratio: spent / b.amount, status: LEVEL_TEXT[budgetLevel(spent, b.amount)] };
      }).sort((a, b) => a.month.localeCompare(b.month) || a.name.localeCompare(b.name));
      return { columns: [text('month', '月份'), text('name', '預算'), money('amount', '預算金額'), money('spent', '實際支出'), money('remaining', '剩餘'), pct('ratio', '使用率'), text('status', '狀態')], rows, note: '預算報表依整個月份計算，不套用付款人與個人／共同篩選。' };
    }
    case 'yearly': {
      const y = year ?? new Date().getFullYear();
      const yearTxs = filterTransactions(ds, { ...f, from: `${y}-01-01`, to: `${y}-12-31` });
      const rows = monthlyRows(yearTxs, Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`));
      const income = rows.reduce((s, r) => s + r.income, 0);
      const expense = rows.reduce((s, r) => s + r.expense, 0);
      const monthsWithData = rows.filter((r) => r.income || r.expense).length;
      return {
        columns: [text('month', '月份'), money('income', '收入'), money('expense', '支出'), money('net', '結餘'), pct('savingsRate', '儲蓄率')],
        rows,
        footer: { month: `${y} 年合計`, income, expense, net: income - expense, savingsRate: income ? (income - expense) / income : null },
        barKey: 'expense',
        summary: { year: y, income, expense, net: income - expense, savingsRate: income ? (income - expense) / income : null, avgExpense: monthsWithData ? Math.round(expense / monthsWithData) : 0, monthsWithData },
      };
    }
    default:
      throw new Error(`未知的報表 ${key}`);
  }
}

/** 常用日期區間。 */
export function presetRange(preset, today) {
  const y = Number(today.slice(0, 4));
  const month = today.slice(0, 7);
  const end = (m) => `${m}-${String(daysInMonth(Number(m.slice(0, 4)), Number(m.slice(5)))).padStart(2, '0')}`;
  switch (preset) {
    case 'thisMonth': return [`${month}-01`, end(month)];
    case 'lastMonth': { const m = addMonthsToMonth(month, -1); return [`${m}-01`, end(m)]; }
    case 'thisYear': return [`${y}-01-01`, `${y}-12-31`];
    case 'lastYear': return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case 'last12': { const m = addMonthsToMonth(month, -11); return [`${m}-01`, end(month)]; }
    default: return null;
  }
}
