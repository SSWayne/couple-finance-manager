/** 財務總覽的統計（純函式，全部由真實資料計算）。 */
import { addDays, addMonthsToMonth, daysInMonth, parseDate, diffDays } from '../lib/date.js';
import { periodSummary, computeBalances } from './balances.js';
import { budgetStatuses } from './budgets.js';
import { advanceSummary } from './settlementService.js';
import { backupStatus } from './backupStatus.js';
import { activeGoalProgress } from './savings.js';
import { formatMoney } from '../lib/money.js';

const WEEKDAY = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

/**
 * 圖表區間切分：
 * - 7d：最近 7 天（每日）
 * - month：本月每日
 * - 3m：最近 13 週（每 7 天一組，最後一組到今天）
 * - 6m / 12m：最近 6 / 12 個月（每月）
 */
export function periodBuckets(period, today) {
  const buckets = [];
  if (period === '7d') {
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i);
      buckets.push({ from: d, to: d, label: WEEKDAY[parseDate(d).getDay()], title: d });
    }
  } else if (period === 'month') {
    const month = today.slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    for (let day = 1; day <= daysInMonth(y, m); day++) {
      const d = `${month}-${String(day).padStart(2, '0')}`;
      buckets.push({ from: d, to: d, label: String(day), title: d, future: d > today });
    }
  } else if (period === '3m') {
    for (let i = 12; i >= 0; i--) {
      const to = addDays(today, -7 * i);
      const from = addDays(to, -6);
      buckets.push({ from, to, label: `${Number(from.slice(5, 7))}/${Number(from.slice(8))}`, title: `${from} ~ ${to}` });
    }
  } else {
    const n = period === '6m' ? 6 : 12;
    const month = today.slice(0, 7);
    for (let i = n - 1; i >= 0; i--) {
      const mo = addMonthsToMonth(month, -i);
      const [y, m] = mo.split('-').map(Number);
      buckets.push({ from: `${mo}-01`, to: `${mo}-${String(daysInMonth(y, m)).padStart(2, '0')}`, label: `${m}月`, title: `${y} 年 ${m} 月` });
    }
  }
  return buckets;
}

/** 每個區間的收入、支出、結餘（轉帳不計）。 */
export function bucketSeries(dataset, buckets) {
  const out = buckets.map(() => ({ income: 0, expense: 0, net: 0 }));
  if (!buckets.length) return out;
  const first = buckets[0].from;
  const last = buckets.at(-1).to;
  for (const t of dataset.transactions) {
    if (t.type === 'transfer' || t.date < first || t.date > last) continue;
    const i = buckets.findIndex((b) => t.date >= b.from && t.date <= b.to);
    if (i < 0) continue;
    if (t.type === 'income') out[i].income += t.amount;
    else out[i].expense += t.amount;
  }
  for (const o of out) o.net = o.income - o.expense;
  return out;
}

function pctChange(cur, prev) {
  if (!prev) return null;
  return (cur - prev) / Math.abs(prev);
}

/** 本月至今 vs 上月同期（上月 1 日到同一天，上月較短時到月底）。 */
export function monthToDate(dataset, today) {
  const month = today.slice(0, 7);
  const day = Number(today.slice(8));
  const prevMonth = addMonthsToMonth(month, -1);
  const [py, pm] = prevMonth.split('-').map(Number);
  const prevTo = `${prevMonth}-${String(Math.min(day, daysInMonth(py, pm))).padStart(2, '0')}`;
  const current = periodSummary(dataset, `${month}-01`, today);
  const previous = periodSummary(dataset, `${prevMonth}-01`, prevTo);
  return {
    current,
    previous,
    change: {
      income: pctChange(current.income, previous.income),
      expense: pctChange(current.expense, previous.expense),
      net: pctChange(current.net, previous.net),
    },
  };
}

/** 支出依主分類分組（子分類併入主分類），金額大到小，超過 maxItems 的合併為「其他」。 */
export function spendingByCategory(dataset, from, to, maxItems = 6) {
  const map = new Map();
  let total = 0;
  for (const t of dataset.transactions) {
    if (t.type !== 'expense' || t.date < from || t.date > to) continue;
    map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
    total += t.amount;
  }
  const rows = [...map].map(([categoryId, amount]) => {
    const c = dataset.categories.find((x) => x.id === categoryId);
    return { categoryId, name: c?.name ?? '未分類', color: c?.color ?? '#B9BDB7', icon: c?.icon ?? 'bi-tag', amount };
  }).sort((a, b) => b.amount - a.amount);
  let items = rows;
  if (rows.length > maxItems) {
    const rest = rows.slice(maxItems - 1);
    items = [...rows.slice(0, maxItems - 1), { categoryId: null, name: `其他 ${rest.length} 類`, color: '#B9BDB7', icon: 'bi-three-dots', amount: rest.reduce((s, r) => s + r.amount, 0), merged: rest.map((r) => r.categoryId) }];
  }
  return { total, items: items.map((r) => ({ ...r, ratio: total ? r.amount / total : 0 })) };
}

/**
 * 財務提醒：全部由真實資料產生。
 * level：danger（需處理）／warning（注意）／info（資訊）
 */
export function buildReminders(dataset, today) {
  const out = [];
  const st = backupStatus(dataset.settings, parseDate(today));
  if (st.level === 'warning') out.push({ level: 'warning', icon: 'bi-cloud-arrow-down', text: `備份：${st.text}`, action: 'backup' });

  for (const s of budgetStatuses(dataset, today.slice(0, 7))) {
    if (s.level === 'over') out.push({ level: 'danger', icon: 'bi-exclamation-octagon', text: `預算「${s.title}」已超支 ${formatMoney(-s.remaining)}（${Math.round(s.ratio * 100)}%）`, href: '#/budgets' });
    else if (s.level === 'warning') out.push({ level: 'warning', icon: 'bi-exclamation-triangle', text: `預算「${s.title}」已用 ${Math.round(s.ratio * 100)}%，剩 ${formatMoney(s.remaining)}`, href: '#/budgets' });
  }

  const adv = advanceSummary(dataset);
  if (adv.net.amount > 0) {
    const name = (id) => dataset.members.find((m) => m.id === id)?.name ?? '';
    out.push({ level: 'info', icon: 'bi-arrow-left-right', text: `未結算代墊 ${adv.transactions.length} 筆：${name(adv.net.fromMemberId)}應付${name(adv.net.toMemberId)} ${formatMoney(adv.net.amount)}`, href: '#/couple' });
  }

  const balances = computeBalances(dataset);
  for (const a of dataset.accounts) {
    const bal = balances.get(a.id) ?? 0;
    if (bal >= 0) continue;
    if (a.type === 'credit_card') out.push({ level: 'info', icon: 'bi-credit-card', text: `${a.name}待繳卡費 ${formatMoney(-bal)}`, href: '#/accounts' });
    else out.push({ level: 'warning', icon: 'bi-wallet2', text: `${a.name}餘額為負（${formatMoney(bal)}），請確認是否漏記收入或轉帳`, href: '#/accounts' });
  }

  const mtd = periodSummary(dataset, `${today.slice(0, 7)}-01`, today);
  if (mtd.expense > mtd.income && mtd.income > 0) out.push({ level: 'warning', icon: 'bi-graph-down-arrow', text: `本月支出已超過收入 ${formatMoney(mtd.expense - mtd.income)}`, href: '#/transactions' });

  for (const g of activeGoalProgress(dataset, today)) {
    if (g.overdue) out.push({ level: 'warning', icon: 'bi-flag', text: `儲蓄目標「${g.goal.name}」已過期限，還差 ${formatMoney(g.remaining)}`, href: '#/savings' });
  }

  if (dataset.weddingProject?.weddingDate) {
    const days = diffDays(today, dataset.weddingProject.weddingDate);
    if (days >= 0 && days <= 180) out.push({ level: 'info', icon: 'bi-heart', text: `距離婚禮還有 ${days} 天`, href: '#/wedding' });
  }
  const order = { danger: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
