/** 財務報表：10 種報表＋年度彙總；日期／付款人／個人共同篩選；CSV 匯出。 */
import { h, icon } from '../ui/h.js';
import { pageHeader, panel, notice } from '../ui/components.js';
import { field, selectEl } from '../ui/form.js';
import { toast } from '../ui/toast.js';
import { downloadText } from '../ui/download.js';
import { buildReport, presetRange, REPORTS } from '../domain/reports.js';
import { orderedMembers } from '../domain/lookup.js';
import { formatMoney } from '../lib/money.js';
import { fileTimestamp, today } from '../lib/date.js';
import { toCsv } from '../lib/csv.js';

const t0 = today();
const [defFrom, defTo] = presetRange('thisYear', t0);
/** 篩選只在記憶體，不放進 URL。 */
const view = { report: 'monthly', preset: 'thisYear', from: defFrom, to: defTo, memberId: '', ownership: '', year: Number(t0.slice(0, 4)) };

const PRESETS = [
  { value: 'thisMonth', label: '本月' },
  { value: 'lastMonth', label: '上個月' },
  { value: 'thisYear', label: '今年' },
  { value: 'lastYear', label: '去年' },
  { value: 'last12', label: '近 12 個月' },
  { value: 'custom', label: '自訂' },
];

function formatCell(col, v) {
  if (v === null || v === undefined) return col.type === 'percent' ? '不適用' : '—';
  if (col.type === 'money') return formatMoney(v);
  if (col.type === 'percent') return `${(v * 100).toFixed(1)}%`;
  if (col.type === 'int') return String(v);
  return String(v);
}

export function render(ctx) {
  const ds = ctx.dataset;
  const def = REPORTS.find((r) => r.key === view.report);
  const isYearly = view.report === 'yearly';
  const filter = { from: view.from, to: view.to, memberId: view.memberId, ownership: view.ownership };
  const rep = buildReport(ds, view.report, filter, { year: view.year });

  const set = (patch) => {
    Object.assign(view, patch);
    ctx.rerender();
  };
  const presetSel = selectEl(PRESETS, view.preset, {
    onChange: (e) => {
      const r = presetRange(e.target.value, today());
      set(r ? { preset: e.target.value, from: r[0], to: r[1] } : { preset: 'custom' });
    },
  });
  const fromInput = h('input', { type: 'date', class: 'form-control', value: view.from, onChange: (e) => e.target.value && set({ from: e.target.value, preset: 'custom' }) });
  const toInput = h('input', { type: 'date', class: 'form-control', value: view.to, onChange: (e) => e.target.value && set({ to: e.target.value, preset: 'custom' }) });
  const years = new Set(ds.transactions.map((x) => Number(x.date.slice(0, 4))));
  years.add(Number(today().slice(0, 4)));
  const yearSel = selectEl([...years].sort((a, b) => b - a).map((y) => ({ value: String(y), label: `${y} 年` })), String(view.year), { onChange: (e) => set({ year: Number(e.target.value) }) });
  const memberSel = selectEl([{ value: '', label: '兩人' }, ...orderedMembers(ds).map((m) => ({ value: m.id, label: m.name }))], view.memberId, { onChange: (e) => set({ memberId: e.target.value }) });
  const ownSel = selectEl([{ value: '', label: '全部' }, { value: 'shared', label: '只看共同' }, { value: 'personal', label: '只看個人' }], view.ownership, { onChange: (e) => set({ ownership: e.target.value }) });

  const exportCsv = () => {
    if (!rep.rows.length) return toast.warning('這份報表沒有資料可以匯出');
    const rows = rep.footer ? [...rep.rows, rep.footer] : rep.rows;
    const csv = toCsv(rows, rep.columns.map((c) => ({ header: c.label, value: (r) => (c.type === 'percent' ? (r[c.key] === null || r[c.key] === undefined ? '不適用' : Number((r[c.key] * 100).toFixed(2))) : r[c.key] ?? '') })));
    downloadText(`couple-finance-report-${view.report}-${fileTimestamp()}.csv`, csv, 'text/csv');
    toast.success(`已觸發下載「${def.label}」CSV（${rep.rows.length} 列）`);
  };

  const max = rep.barKey ? Math.max(1, ...rep.rows.map((r) => Math.abs(r[rep.barKey] ?? 0))) : 1;
  const filterText = isYearly
    ? `${view.year} 年`
    : `${view.from.replaceAll('-', '/')} – ${view.to.replaceAll('-', '/')}`;

  return h('div', { class: 'cf-page cf-reports-page' },
    pageHeader('財務報表', '所有報表都由收支記帳即時計算，轉帳不計入收支',
      h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: exportCsv }, icon('bi-filetype-csv'), ' 匯出 CSV'),
    ),
    h('div', { class: 'cf-reports-layout' },
      h('nav', { class: 'cf-reports-nav', 'aria-label': '報表種類' },
        h('ul', null, REPORTS.map((r) => h('li', null,
          h('button', { type: 'button', class: { 'cf-reports-nav-btn': true, 'cf-reports-nav-btn-active': r.key === view.report }, 'aria-current': r.key === view.report ? 'true' : null, onClick: () => set({ report: r.key }) },
            h('span', { class: 'cf-reports-nav-label' }, r.label),
            h('span', { class: 'cf-reports-nav-desc' }, r.description)))))),
      h('div', { class: 'cf-reports-main' },
        panel({ className: 'cf-reports-filter' },
          h('div', { class: 'cf-reports-filter-grid' },
            h('div', { class: 'cf-reports-mobile-select' }, field('報表', selectEl(REPORTS.map((r) => ({ value: r.key, label: r.label })), view.report, { onChange: (e) => set({ report: e.target.value }) })).el),
            isYearly
              ? field('年份', yearSel).el
              : [field('期間', presetSel).el, field('開始日期', fromInput).el, field('結束日期', toInput).el],
            field('付款人／收款人', memberSel).el,
            field('個人／共同', ownSel).el,
          ),
        ),
        panel({ title: def.label, subtitle: `${def.description} · ${filterText}${view.memberId ? ` · ${orderedMembers(ds).find((m) => m.id === view.memberId)?.name}` : ''}${view.ownership ? ` · ${view.ownership === 'shared' ? '共同' : '個人'}` : ''}` },
          rep.summary
            ? h('div', { class: 'cf-wedding-stats cf-reports-summary' },
                sum('全年收入', formatMoney(rep.summary.income)),
                sum('全年支出', formatMoney(rep.summary.expense)),
                sum('全年結餘', formatMoney(rep.summary.net)),
                sum('儲蓄率', rep.summary.savingsRate === null ? '不適用' : `${(rep.summary.savingsRate * 100).toFixed(1)}%`),
                sum('平均月支出', formatMoney(rep.summary.avgExpense), `有紀錄的 ${rep.summary.monthsWithData} 個月`),
              )
            : null,
          rep.rows.length
            ? h('div', { class: 'cf-table-wrap' },
                h('table', { class: 'cf-table cf-reports-table' },
                  h('thead', null, h('tr', null, rep.columns.map((c) => h('th', { scope: 'col', class: c.type === 'text' ? 'cf-table-left' : null }, c.label)), rep.barKey ? h('th', { scope: 'col', class: 'cf-reports-bar-col' }, h('span', { class: 'cf-visually-hidden' }, '比例圖')) : null)),
                  h('tbody', null, rep.rows.map((r) => h('tr', null,
                    rep.columns.map((c) => h('td', { class: { 'cf-table-left': c.type === 'text', 'cf-dash-negative': c.type === 'money' && r[c.key] < 0 } }, formatCell(c, r[c.key]))),
                    rep.barKey ? h('td', { class: 'cf-reports-bar-col' }, h('span', { class: 'cf-reports-bar', style: { width: `${(Math.abs(r[rep.barKey] ?? 0) / max) * 100}%` } })) : null,
                  ))),
                  rep.footer
                    ? h('tfoot', null, h('tr', null, rep.columns.map((c) => h('td', { class: { 'cf-table-left': c.type === 'text' } }, rep.footer[c.key] === undefined ? '' : formatCell(c, rep.footer[c.key]))), rep.barKey ? h('td') : null))
                    : null,
                ))
            : h('div', { class: 'cf-empty' }, icon('bi-bar-chart'), h('p', null, '這個篩選條件下沒有資料')),
          rep.note ? notice('info', rep.note) : null,
        ),
      ),
    ),
  );
}

function sum(label, value, note) {
  return h('div', { class: 'cf-wedding-stat' },
    h('span', { class: 'cf-wedding-stat-label' }, label),
    h('span', { class: 'cf-wedding-stat-value' }, value),
    note ? h('span', { class: 'cf-wedding-stat-note' }, note) : null,
  );
}
