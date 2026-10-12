/** 固定收支：範本清單、下次日期、暫停／恢復、立即檢查到期項目。 */
import { h, icon } from '../ui/h.js';
import { pageHeader, panel, notice, statusPill } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { runAction, toast, explainError } from '../ui/toast.js';
import { ENUMS } from '../data/schema.js';
import { app } from '../app/state.js';
import { openTransactionForm } from './transactionForm.js';
import { setTransactionFilter } from './transactions.js';
import { deleteRecurring, runRecurring, setRecurringActive } from '../domain/recurringService.js';
import { nextOccurrence, pendingDates } from '../domain/recurring.js';
import { accountName, categoryLabel } from '../domain/lookup.js';
import { formatMoney } from '../lib/money.js';
import { today, parseDate } from '../lib/date.js';

export function frequencyText(rec) {
  const day = Number(rec.startDate.slice(8));
  const md = `${Number(rec.startDate.slice(5, 7))} 月 ${day} 日`;
  switch (rec.frequency) {
    case 'weekly': return `每週${['日', '一', '二', '三', '四', '五', '六'][parseDate(rec.startDate).getDay()]}`;
    case 'monthly': return `每月 ${day} 日${day > 28 ? '（較短的月份用月底）' : ''}`;
    case 'quarterly': return `每季（每 3 個月的 ${day} 日）`;
    case 'yearly': return `每年 ${md}`;
    default: return ENUMS.frequency[rec.frequency];
  }
}

export function render(ctx) {
  const ds = ctx.dataset;
  const t = today();
  const list = [...ds.recurringTransactions].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const pendingTotal = list.reduce((s, r) => s + pendingDates(ds, r, t).length, 0);

  const runNow = async () => {
    try {
      const r = await runRecurring(app.db, t);
      if (r.count) toast.success(`已補入帳 ${r.count} 筆固定收支（${r.created.map((c) => `${c.name} ${c.dates.length} 筆`).join('、')}）`);
      else toast.success('目前沒有到期但尚未入帳的固定收支');
      if (r.skipped.length) toast.warning('部分固定收支未產生', r.skipped.map((s) => `「${s.name}」：${s.reason}`));
    } catch (err) {
      toast.error(explainError(err).message);
    }
  };

  return h('div', { class: 'cf-page cf-recurring-page' },
    pageHeader('固定收支', '房租、薪資、訂閱費等定期項目',
      h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: runNow }, icon('bi-arrow-repeat'), ' 立即檢查到期項目'),
      h('button', { type: 'button', class: 'btn cf-btn-dark', onClick: () => openTransactionForm({ recurring: { template: null } }) }, icon('bi-plus-lg'), ' 新增固定收支'),
    ),
    notice('info',
      h('p', { class: 'cf-notice-title' }, '固定收支只在「開啟網站時」自動補入帳'),
      h('p', null, '本系統沒有伺服器，網站關閉期間不會執行。每次開啟網站時，會把到期但還沒入帳的項目一次補上（不會重複產生）。暫停後再恢復，暫停期間的項目不會補產生。'),
    ),
    pendingTotal ? notice('warning', `有 ${pendingTotal} 筆到期但尚未入帳的項目，按「立即檢查到期項目」補上。`) : null,
    list.length
      ? h('div', { class: 'cf-recurring-list' }, list.map((r) => card(ds, r, t, ctx)))
      : panel({}, h('div', { class: 'cf-empty' }, icon('bi-arrow-repeat'), h('p', null, '還沒有固定收支。'), h('p', { class: 'cf-help-text' }, '例如：每月 5 日薪資、每月 1 日房租、每年保險費。'))),
  );
}

function card(ds, r, t, ctx) {
  const count = ds.transactions.filter((x) => x.recurringId === r.id).length;
  const next = r.active ? nextOccurrence(r, t) : null;
  const ended = r.endDate && r.endDate < t && !next;
  const sign = r.type === 'income' ? '+' : r.type === 'expense' ? '-' : '';
  const toggle = () => runAction(() => setRecurringActive(app.db, r.id, !r.active, t), r.active ? `已暫停「${r.name}」` : `已恢復「${r.name}」（暫停期間不補產生）`);
  const remove = async () => {
    const ok = await confirmDialog({ title: '刪除固定收支', message: `確定要刪除「${r.name}」嗎？已產生的 ${count} 筆交易會保留在收支記帳（只是不再標示為固定收支），之後不會再自動產生。`, confirmLabel: '刪除', danger: true });
    if (ok) await runAction(() => deleteRecurring(app.db, r.id), `已刪除「${r.name}」，保留 ${count} 筆已產生的交易`);
  };
  const showTx = () => {
    setTransactionFilter({ q: r.description || r.name });
    ctx.navigate('transactions');
  };
  const detail = r.type === 'transfer' ? `${accountName(ds, r.accountId)} → ${accountName(ds, r.toAccountId)}` : `${categoryLabel(ds, r)} · ${accountName(ds, r.accountId)}`;
  return h('article', { class: { 'cf-recurring-card': true, 'cf-recurring-card-paused': !r.active } },
    h('div', { class: 'cf-recurring-card-head' },
      h('span', { class: `cf-recurring-card-icon cf-recurring-card-icon-${r.type}` }, icon(r.type === 'income' ? 'bi-box-arrow-in-down' : r.type === 'expense' ? 'bi-box-arrow-up' : 'bi-arrow-left-right')),
      h('div', { class: 'cf-recurring-card-titles' },
        h('h3', { class: 'cf-recurring-card-name' }, r.name),
        h('span', { class: 'cf-help-text' }, `${ENUMS.transactionType[r.type]} · ${detail}`),
      ),
      h('span', { class: { 'cf-recurring-card-amount': true, 'cf-amount-income': r.type === 'income' } }, `${sign}${formatMoney(r.amount)}`),
    ),
    h('dl', { class: 'cf-recurring-card-meta' },
      h('div', null, h('dt', null, '週期'), h('dd', null, frequencyText(r))),
      h('div', null, h('dt', null, '下次'), h('dd', null, !r.active ? '已暫停' : next ? next.replaceAll('-', '/') : ended ? '已結束' : '—')),
      h('div', null, h('dt', null, '期間'), h('dd', null, `${r.startDate.replaceAll('-', '/')} 起${r.endDate ? `，到 ${r.endDate.replaceAll('-', '/')}` : ''}`)),
      h('div', null, h('dt', null, '已產生'), h('dd', null, `${count} 筆${r.lastGeneratedDate ? `（最近 ${r.lastGeneratedDate.replaceAll('-', '/')}）` : ''}`)),
    ),
    h('div', { class: 'cf-recurring-card-actions' },
      r.active ? statusPill('ok', '啟用中') : statusPill('muted', '已暫停'),
      count ? h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: showTx }, icon('bi-list-ul'), ' 交易') : null,
      h('button', { type: 'button', class: 'cf-icon-btn', title: r.active ? '暫停' : '恢復', 'aria-label': `${r.active ? '暫停' : '恢復'}「${r.name}」`, onClick: toggle }, icon(r.active ? 'bi-pause-circle' : 'bi-play-circle')),
      h('button', { type: 'button', class: 'cf-icon-btn', title: '編輯', 'aria-label': `編輯「${r.name}」`, onClick: () => openTransactionForm({ recurring: { template: r } }) }, icon('bi-pencil')),
      h('button', { type: 'button', class: 'cf-icon-btn cf-icon-btn-danger', title: '刪除', 'aria-label': `刪除「${r.name}」`, onClick: remove }, icon('bi-trash')),
    ),
  );
}
