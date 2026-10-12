/** 收支記帳：搜尋、篩選（日期／類型／分類／帳戶／付款人）、排序、分頁、CSV 匯出。 */
import { h, icon, mount } from '../ui/h.js';
import { pageHeader, panel, statusPill } from '../ui/components.js';
import { selectEl, field } from '../ui/form.js';
import { confirmDialog } from '../ui/dialog.js';
import { runAction, toast } from '../ui/toast.js';
import { downloadText } from '../ui/download.js';
import { app } from '../app/state.js';
import { ENUMS } from '../data/schema.js';
import { openTransactionForm } from './transactionForm.js';
import { deleteTransaction, findLinkOwner } from '../domain/transactionService.js';
import { accountName, category, categoryLabel, categoryTree, memberName, orderedMembers, sortedAccounts } from '../domain/lookup.js';
import { computeAdvance } from '../domain/split.js';
import { formatMoney } from '../lib/money.js';
import { fileTimestamp } from '../lib/date.js';
import { toCsv } from '../lib/csv.js';

const PAGE_SIZE = 20;
/** 子分類選項縮排用的全形空白。 */
const INDENT = String.fromCharCode(0x3000);

/** 篩選狀態只存在記憶體（不放進 URL、不寫入 localStorage）。 */
const filter = {
  q: '',
  from: '',
  to: '',
  type: '',
  categoryId: '',
  accountId: '',
  memberId: '',
  sort: 'date-desc',
  page: 1,
  /** 從婚禮基金「查看交易」帶入；畫面上會顯示可清除的提示。 */
  weddingExpenseId: '',
};
const EMPTY = { ...filter };

export function setTransactionFilter(partial) {
  Object.assign(filter, EMPTY, partial, { page: 1 });
}

function matches(ds, t) {
  if (filter.weddingExpenseId && t.weddingExpenseId !== filter.weddingExpenseId) return false;
  if (filter.from && t.date < filter.from) return false;
  if (filter.to && t.date > filter.to) return false;
  if (filter.type && t.type !== filter.type) return false;
  if (filter.memberId && t.memberId !== filter.memberId) return false;
  if (filter.accountId && t.accountId !== filter.accountId && t.toAccountId !== filter.accountId) return false;
  if (filter.categoryId && t.categoryId !== filter.categoryId && t.subcategoryId !== filter.categoryId) return false;
  if (filter.q) {
    const q = filter.q.toLowerCase();
    const hay = [
      t.description,
      ...(t.tags ?? []),
      categoryLabel(ds, t),
      accountName(ds, t.accountId),
      t.toAccountId ? accountName(ds, t.toAccountId) : '',
      memberName(ds, t.memberId),
      String(t.amount),
    ].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

const SORTS = {
  'date-desc': (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  'date-asc': (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  'amount-desc': (a, b) => b.amount - a.amount || b.date.localeCompare(a.date),
  'amount-asc': (a, b) => a.amount - b.amount || b.date.localeCompare(a.date),
};

export function filteredTransactions(ds) {
  return ds.transactions.filter((t) => matches(ds, t)).sort(SORTS[filter.sort] ?? SORTS['date-desc']);
}

export function render(ctx) {
  const ds = ctx.dataset;
  if (app.quickSearch) {
    setTransactionFilter({ q: app.quickSearch });
    app.quickSearch = '';
  }

  const results = h('div', { class: 'cf-txlist-results' });
  const summary = h('div', { class: 'cf-txlist-summary', 'aria-live': 'polite' });

  const refresh = () => renderResults(ds, results, summary, refresh);
  const set = (key) => (e) => {
    filter[key] = e.target.value;
    filter.page = 1;
    refresh();
  };

  const searchInput = h('input', { type: 'search', class: 'form-control', value: filter.q, placeholder: '說明、標籤、分類、帳戶、金額', maxlength: 50 });
  let timer;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filter.q = searchInput.value.trim();
      filter.page = 1;
      refresh();
    }, 200);
  });

  const catOptions = [{ value: '', label: '全部分類' }];
  for (const type of ['expense', 'income']) {
    const tree = categoryTree(ds, type, { includeArchived: true });
    catOptions.push({
      group: ENUMS.categoryType[type],
      options: tree.flatMap((c) => [{ value: c.id, label: c.name }, ...c.children.map((s) => ({ value: s.id, label: `${INDENT}${c.name} › ${s.name}` }))]),
    });
  }

  const controls = {
    q: field('搜尋', searchInput, { className: 'cf-txfilter-search' }),
    from: field('開始日期', h('input', { type: 'date', class: 'form-control', value: filter.from, onChange: set('from') })),
    to: field('結束日期', h('input', { type: 'date', class: 'form-control', value: filter.to, onChange: set('to') })),
    type: field('類型', selectEl([{ value: '', label: '全部類型' }, ...Object.entries(ENUMS.transactionType).map(([value, label]) => ({ value, label }))], filter.type, { onChange: set('type') })),
    categoryId: field('分類', selectEl(catOptions, filter.categoryId, { onChange: set('categoryId') })),
    accountId: field('帳戶', selectEl([{ value: '', label: '全部帳戶' }, ...sortedAccounts(ds).map((a) => ({ value: a.id, label: a.archived ? `${a.name}（已停用）` : a.name }))], filter.accountId, { onChange: set('accountId') })),
    memberId: field('付款人', selectEl([{ value: '', label: '兩人' }, ...orderedMembers(ds).map((m) => ({ value: m.id, label: m.name }))], filter.memberId, { onChange: set('memberId') })),
    sort: field('排序', selectEl([
      { value: 'date-desc', label: '日期（新 → 舊）' },
      { value: 'date-asc', label: '日期（舊 → 新）' },
      { value: 'amount-desc', label: '金額（大 → 小）' },
      { value: 'amount-asc', label: '金額（小 → 大）' },
    ], filter.sort, { onChange: set('sort') })),
  };

  const resetBtn = h('button', { type: 'button', class: 'btn cf-btn-ghost cf-txfilter-reset', onClick: () => { setTransactionFilter({}); ctx.rerender(); } }, icon('bi-x-circle'), ' 清除篩選');

  const node = h('div', { class: 'cf-page cf-txpage' },
    pageHeader('收支記帳', '每次新增、修改、刪除都會立即儲存',
      h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: () => exportCsv(ds) }, icon('bi-filetype-csv'), ' 匯出 CSV'),
      h('button', { type: 'button', class: 'btn cf-btn-dark', onClick: () => openTransactionForm() }, icon('bi-plus-lg'), ' 新增記帳'),
    ),
    ds.accounts.length === 0
      ? h('div', { class: 'cf-empty-hint' }, icon('bi-info-circle'), ' 還沒有帳戶。請先到「帳戶管理」新增至少一個帳戶（例如銀行或現金），才能記帳。 ', h('a', { href: '#/accounts' }, '前往帳戶管理'))
      : null,
    filter.weddingExpenseId
      ? h('div', { class: 'cf-empty-hint cf-txfilter-chip' }, icon('bi-heart'), ` 只顯示關聯到婚禮項目「${ds.weddingExpenses.find((i) => i.id === filter.weddingExpenseId)?.name ?? ''}」的交易 `, h('button', { type: 'button', class: 'btn cf-btn-ghost cf-dash-small-btn', onClick: () => { filter.weddingExpenseId = ''; ctx.rerender(); } }, '顯示全部'))
      : null,
    panel({ className: 'cf-txfilter', title: '篩選', actions: resetBtn },
      h('div', { class: 'cf-txfilter-grid' }, Object.values(controls).map((c) => c.el)),
    ),
    panel({ className: 'cf-txlist' }, summary, results),
  );
  refresh();
  return node;
}

function renderResults(ds, results, summary, refresh) {
  const list = filteredTransactions(ds);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (filter.page > pages) filter.page = pages;
  const pageItems = list.slice((filter.page - 1) * PAGE_SIZE, filter.page * PAGE_SIZE);

  let income = 0;
  let expense = 0;
  for (const t of list) {
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  mount(summary,
    h('span', { class: 'cf-txlist-count' }, `共 ${list.length} 筆`),
    h('span', null, '收入 ', h('strong', { class: 'cf-amount-income' }, formatMoney(income))),
    h('span', null, '支出 ', h('strong', { class: 'cf-amount-expense' }, formatMoney(expense))),
    h('span', { class: 'cf-txlist-note' }, '轉帳不計入收支'),
  );

  if (!list.length) {
    mount(results, h('div', { class: 'cf-empty' }, icon('bi-inbox'), h('p', null, ds.transactions.length ? '沒有符合篩選條件的交易' : '還沒有任何交易，按「新增記帳」開始記第一筆')));
    return;
  }

  mount(results,
    h('ul', { class: 'cf-txrow-list' }, pageItems.map((t) => txRow(ds, t))),
    pages > 1
      ? h('nav', { class: 'cf-pager', 'aria-label': '分頁' },
          h('button', { type: 'button', class: 'btn cf-btn-ghost', disabled: filter.page <= 1, onClick: () => { filter.page -= 1; refresh(); } }, icon('bi-chevron-left'), ' 上一頁'),
          h('span', { class: 'cf-pager-status' }, `第 ${filter.page} / ${pages} 頁`),
          h('button', { type: 'button', class: 'btn cf-btn-ghost', disabled: filter.page >= pages, onClick: () => { filter.page += 1; refresh(); } }, '下一頁 ', icon('bi-chevron-right')),
        )
      : null,
  );
}

export function txRow(ds, t, { compact = false } = {}) {
  const cat = category(ds, t.categoryId);
  const adv = computeAdvance(t);
  const sign = t.type === 'income' ? 1 : t.type === 'expense' ? -1 : 0;
  const title = t.description || categoryLabel(ds, t);
  const accountText = t.type === 'transfer' ? `${accountName(ds, t.accountId)} → ${accountName(ds, t.toAccountId)}` : accountName(ds, t.accountId);
  const badges = [];
  if (t.type !== 'transfer') badges.push(statusPill('neutral', t.ownershipType === 'shared' ? '共同' : `${memberName(ds, t.ownerMemberId)}個人`));
  if (adv) badges.push(statusPill(t.settlementId ? 'muted' : 'warning', t.settlementId ? '已結算' : `代墊 ${formatMoney(adv.amount)}`));
  if (t.recurringId) badges.push(statusPill('muted', '固定收支'));
  if (t.type === 'transfer' && findLinkOwner(ds, t.id)) badges.push(statusPill('muted', findLinkOwner(ds, t.id).label));

  const edit = () => openTransactionForm({ tx: t });
  const remove = async () => {
    const ok = await confirmDialog({ title: '刪除交易', message: `確定要刪除「${title}」${formatMoney(t.amount)}嗎？刪除後無法復原。`, confirmLabel: '刪除', danger: true });
    if (ok) await runAction(() => deleteTransaction(app.db, t.id), '已刪除交易');
  };

  return h('li', { class: { 'cf-txrow': true, 'cf-txrow-compact': compact } },
    h('span', { class: 'cf-txrow-icon', style: { '--cf-swatch': t.type === 'transfer' ? '#ECEDEB' : cat?.color ?? '#ECEDEB' } }, icon(t.type === 'transfer' ? 'bi-arrow-left-right' : cat?.icon ?? 'bi-tag')),
    h('button', { type: 'button', class: 'cf-txrow-main', onClick: edit, 'aria-label': `修改：${title}` },
      h('span', { class: 'cf-txrow-title' }, title),
      h('span', { class: 'cf-txrow-meta' }, [t.date.replaceAll('-', '/'), categoryLabel(ds, t), accountText, `${t.type === 'income' ? '收款' : '付款'}：${memberName(ds, t.memberId)}`].join(' · ')),
      compact ? null : h('span', { class: 'cf-txrow-badges' }, badges, (t.tags ?? []).map((tag) => h('span', { class: 'cf-txrow-tag' }, `#${tag}`))),
    ),
    h('span', { class: { 'cf-txrow-amount': true, 'cf-amount-income': sign > 0, 'cf-amount-expense': sign < 0 } }, sign > 0 ? `+${formatMoney(t.amount)}` : sign < 0 ? `-${formatMoney(t.amount)}` : formatMoney(t.amount)),
    compact
      ? null
      : h('span', { class: 'cf-txrow-actions' },
          h('button', { type: 'button', class: 'cf-icon-btn', title: '修改', 'aria-label': `修改：${title}`, onClick: edit }, icon('bi-pencil')),
          h('button', { type: 'button', class: 'cf-icon-btn cf-icon-btn-danger', title: '刪除', 'aria-label': `刪除：${title}`, onClick: remove }, icon('bi-trash')),
        ),
  );
}

function exportCsv(ds) {
  const list = filteredTransactions(ds);
  if (!list.length) {
    toast.warning('沒有可匯出的交易（請調整篩選條件）');
    return;
  }
  const [self, partner] = orderedMembers(ds);
  const sub = (t) => category(ds, t.subcategoryId)?.name ?? '';
  const csv = toCsv(list, [
    { header: '日期', value: (t) => t.date },
    { header: '類型', value: (t) => ENUMS.transactionType[t.type] },
    { header: '金額', value: (t) => t.amount },
    { header: '主分類', value: (t) => category(ds, t.categoryId)?.name ?? '' },
    { header: '子分類', value: sub },
    { header: '帳戶', value: (t) => accountName(ds, t.accountId) },
    { header: '轉入帳戶', value: (t) => (t.toAccountId ? accountName(ds, t.toAccountId) : '') },
    { header: '付款人', value: (t) => memberName(ds, t.memberId) },
    { header: '歸屬', value: (t) => (t.ownershipType ? ENUMS.ownershipType[t.ownershipType] : '') },
    { header: '歸屬成員', value: (t) => (t.ownerMemberId ? memberName(ds, t.ownerMemberId) : '') },
    { header: '分攤方式', value: (t) => (t.splitMode !== 'none' ? ENUMS.splitMode[t.splitMode] : '') },
    { header: `${self.name}負擔`, value: (t) => t.shares?.[self.id] ?? '' },
    { header: `${partner.name}負擔`, value: (t) => t.shares?.[partner.id] ?? '' },
    { header: '代墊金額', value: (t) => computeAdvance(t)?.amount ?? '' },
    { header: '已結算', value: (t) => (t.settlementId ? '是' : '') },
    { header: '付款方式', value: (t) => (t.paymentMethod ? ENUMS.paymentMethod[t.paymentMethod] : '') },
    { header: '說明', value: (t) => t.description },
    { header: '標籤', value: (t) => (t.tags ?? []).join(' ') },
  ]);
  downloadText(`couple-finance-transactions-${fileTimestamp()}.csv`, csv, 'text/csv');
  toast.success(`已觸發下載 CSV（${list.length} 筆，依目前篩選）`);
}
