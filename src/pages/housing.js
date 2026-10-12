/** 購屋規劃：方案、房貸試算（本息平均攤還＋寬限期）、攤還表、房貸收入比（估算）。 */
import { h, icon, mount } from '../ui/h.js';
import { pageHeader, panel, notice, statusPill } from '../ui/components.js';
import { field, moneyInput, selectEl, textInput } from '../ui/form.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { runAction, toast } from '../ui/toast.js';
import { downloadText } from '../ui/download.js';
import { ValidationError } from '../data/validate.js';
import { app } from '../app/state.js';
import { amortizationSchedule, mortgageIncomeRatio, yearlySummary, MORTGAGE_RATIO_LIMIT } from '../domain/mortgage.js';
import { deleteHousingPlan, saveHousingPlan } from '../domain/housingService.js';
import { formatMoney, parseMoneyInput } from '../lib/money.js';
import { fileTimestamp, today } from '../lib/date.js';
import { toCsv } from '../lib/csv.js';

const view = { planId: null, year: 1 };

export function render(ctx) {
  const ds = ctx.dataset;
  const plans = [...ds.housingPlans].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!plans.some((p) => p.id === view.planId)) {
    view.planId = plans[0]?.id ?? null;
    view.year = 1;
  }
  const plan = plans.find((p) => p.id === view.planId);
  return h('div', { class: 'cf-page cf-housing-page' },
    pageHeader('購屋規劃', '房貸試算為估算，實際以銀行核貸條件為準',
      h('button', { type: 'button', class: 'btn cf-btn-dark', onClick: () => openPlanForm(null) }, icon('bi-plus-lg'), ' 新增方案'),
    ),
    plans.length
      ? [
          h('div', { class: 'cf-housing-tabs', role: 'tablist', 'aria-label': '購屋方案' },
            plans.map((p) => {
              const s = amortizationSchedule(p);
              return h('button', {
                type: 'button',
                role: 'tab',
                class: { 'cf-housing-tab': true, 'cf-housing-tab-active': p.id === view.planId },
                'aria-selected': String(p.id === view.planId),
                onClick: () => { view.planId = p.id; view.year = 1; ctx.rerender(); },
              },
              h('span', { class: 'cf-housing-tab-name' }, p.name),
              h('span', { class: 'cf-housing-tab-meta' }, `${formatMoney(p.housePrice)} · 月付 ${formatMoney(s.monthlyPayment)}`));
            })),
          planDetail(ds, plan, ctx),
        ]
      : panel({},
          h('div', { class: 'cf-empty' }, icon('bi-house-door'), h('p', null, '還沒有購屋方案。'),
            h('p', { class: 'cf-help-text' }, '輸入房價、頭期款、貸款年限與利率，試算每月房貸與房貸收入比；可以建立多個方案比較。'))),
  );
}

function planDetail(ds, plan, ctx) {
  const s = amortizationSchedule(plan);
  const ratio = mortgageIncomeRatio(ds, plan, today());
  const cashNeeded = plan.downPayment + plan.otherCosts;
  const years = yearlySummary(s.rows);
  if (view.year > years.length) view.year = 1;

  const remove = async () => {
    const ok = await confirmDialog({ title: '刪除購屋方案', message: `確定要刪除「${plan.name}」嗎？`, confirmLabel: '刪除', danger: true });
    if (ok) await runAction(() => deleteHousingPlan(app.db, plan.id), `已刪除「${plan.name}」`);
  };

  const exportCsv = () => {
    const csv = toCsv(s.rows, [
      { header: '期數', value: (r) => r.period },
      { header: '月份', value: (r) => r.month ?? '' },
      { header: '月付金', value: (r) => r.payment },
      { header: '利息', value: (r) => r.interest },
      { header: '本金', value: (r) => r.principal },
      { header: '剩餘本金', value: (r) => r.balance },
      { header: '寬限期', value: (r) => (r.grace ? '是' : '') },
    ]);
    downloadText(`couple-finance-mortgage-${fileTimestamp()}.csv`, csv, 'text/csv');
    toast.success(`已觸發下載攤還表 CSV（${s.rows.length} 期，估算）`);
  };

  const monthsBox = h('div', { class: 'cf-housing-months' });
  const renderMonths = () => {
    const rows = s.rows.filter((r) => Math.ceil(r.period / 12) === view.year);
    mount(monthsBox,
      h('div', { class: 'cf-table-wrap' },
        h('table', { class: 'cf-table' },
          h('thead', null, h('tr', null, ['期數', '月份', '月付金', '利息', '本金', '剩餘本金'].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', null, rows.map((r) => h('tr', { class: { 'cf-table-row-muted': r.grace } },
            h('td', null, String(r.period)),
            h('td', null, r.month ? r.month.replace('-', '/') : '—'),
            h('td', null, formatMoney(r.payment)),
            h('td', null, formatMoney(r.interest)),
            h('td', null, formatMoney(r.principal)),
            h('td', null, formatMoney(r.balance)),
          )))),
      ),
    );
  };
  const yearSel = selectEl(years.map((y) => ({ value: String(y.year), label: `第 ${y.year} 年${y.fromMonth ? `（${y.fromMonth.replace('-', '/')} 起）` : ''}${y.grace ? ' · 寬限期' : ''}` })), String(view.year), {
    class: 'form-select cf-housing-year',
    'aria-label': '選擇年度查看每月明細',
    onChange: (e) => { view.year = Number(e.target.value); renderMonths(); },
  });
  renderMonths();

  const pct = (v) => `${(v * 100).toFixed(1)}%`;

  return h('div', { class: 'cf-housing-detail' },
    h('div', { class: 'cf-housing-actions' },
      h('h2', { class: 'cf-housing-title' }, plan.name),
      h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: () => openPlanForm(plan) }, icon('bi-pencil'), ' 編輯'),
      h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: exportCsv }, icon('bi-filetype-csv'), ' 攤還表 CSV'),
      h('button', { type: 'button', class: 'cf-icon-btn cf-icon-btn-danger', title: '刪除', 'aria-label': `刪除「${plan.name}」`, onClick: remove }, icon('bi-trash')),
    ),
    h('div', { class: 'cf-wedding-stats' },
      hStat('房價', formatMoney(plan.housePrice), 'bi-house-door'),
      hStat('頭期款', formatMoney(plan.downPayment), 'bi-cash-stack', `房價的 ${pct(plan.downPayment / plan.housePrice)}`),
      hStat('貸款金額', formatMoney(plan.loanAmount), 'bi-bank', `成數 ${pct(plan.loanAmount / plan.housePrice)}`),
      hStat('其他費用', formatMoney(plan.otherCosts), 'bi-tools', '稅費、仲介、裝潢等'),
      hStat('需準備現金', formatMoney(cashNeeded), 'bi-piggy-bank', '頭期款＋其他費用', 'cf-wedding-stat-main'),
      hStat('貸款條件', `${plan.annualRate}%`, 'bi-percent', `${plan.loanYears} 年${plan.gracePeriodYears ? `，寬限 ${plan.gracePeriodYears} 年` : ''}`),
    ),
    h('div', { class: 'cf-housing-grid' },
      panel({ title: '每月房貸（估算）', subtitle: '本息平均攤還，每月利息四捨五入到元' },
        h('dl', { class: 'cf-housing-pay' },
          plan.gracePeriodYears
            ? h('div', null, h('dt', null, `寬限期（前 ${s.graceMonths} 期）只繳利息`), h('dd', null, formatMoney(s.gracePayment)))
            : null,
          h('div', { class: 'cf-housing-pay-main' }, h('dt', null, plan.gracePeriodYears ? `寬限期後月付金（${s.months - s.graceMonths} 期）` : `每月月付金（${s.months} 期）`), h('dd', null, formatMoney(s.monthlyPayment))),
          h('div', null, h('dt', null, '總利息'), h('dd', null, formatMoney(s.totalInterest))),
          h('div', null, h('dt', null, '總繳金額'), h('dd', null, formatMoney(s.totalPayment))),
          h('div', null, h('dt', null, '最後一期（結清剩餘本金）'), h('dd', null, formatMoney(s.rows.at(-1)?.payment ?? 0))),
        ),
      ),
      panel({ title: '房貸收入比（估算）', subtitle: '寬限期後月付金 ÷ 近 3 個完整月平均收入' },
        ratio.ratio === null
          ? notice('info', '近 3 個完整月沒有收入紀錄，無法計算房貸收入比（不適用）。')
          : [
              h('div', { class: 'cf-housing-ratio' },
                h('span', { class: { 'cf-housing-ratio-value': true, 'cf-housing-ratio-over': ratio.overLimit } }, pct(ratio.ratio)),
                ratio.overLimit ? statusPill('warning', `超過 ${Math.round(MORTGAGE_RATIO_LIMIT * 100)}%（1/3）`) : statusPill('ok', `在 1/3 以內`),
              ),
              h('div', { class: `cf-progress cf-progress-${ratio.overLimit ? 'warning' : 'ok'}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(ratio.ratio * 100), 'aria-label': '房貸收入比' },
                h('span', { class: 'cf-progress-fill', style: { width: `${Math.min(100, ratio.ratio * 100)}%` } })),
              ratio.overLimit ? notice('warning', '房貸月付金超過家庭月收入的 1/3，生活費與突發支出的彈性會比較小，建議提高頭期款、延長年限或選擇較低總價。') : null,
            ],
        h('dl', { class: 'cf-kv-list cf-kv-list-compact' },
          h('div', null, h('dt', null, '平均月收入'), h('dd', null, formatMoney(ratio.averageIncome))),
          ratio.incomeMonths.map((m) => h('div', null, h('dt', null, m.month.replace('-', ' 年 ') + ' 月'), h('dd', null, formatMoney(m.income)))),
        ),
        h('p', { class: 'cf-help-text' }, '收入取自收支記帳（不含轉帳）。這只是粗略的估算，銀行審核會看更多條件。'),
      ),
    ),
    panel({ title: '攤還表（估算）', subtitle: '依年度彙總；選擇年度可看每月明細', actions: yearSel },
      h('div', { class: 'cf-table-wrap' },
        h('table', { class: 'cf-table' },
          h('thead', null, h('tr', null, ['年度', '期間', '繳款合計', '利息', '本金', '年底剩餘本金'].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', null, years.map((y) => h('tr', {
            class: { 'cf-table-row-active': y.year === view.year, 'cf-table-row-muted': y.grace },
            onClick: () => { view.year = y.year; yearSel.value = String(y.year); ctx.rerender(); },
          },
            h('td', null, `第 ${y.year} 年${y.grace ? '（寬限）' : ''}`),
            h('td', null, y.fromMonth ? `${y.fromMonth.replace('-', '/')}–${y.toMonth.replace('-', '/')}` : '—'),
            h('td', null, formatMoney(y.payment)),
            h('td', null, formatMoney(y.interest)),
            h('td', null, formatMoney(y.principal)),
            h('td', null, formatMoney(y.endBalance)),
          )))),
      ),
      h('h3', { class: 'cf-housing-subtitle' }, `第 ${view.year} 年每月明細`),
      monthsBox,
      plan.note ? h('p', { class: 'cf-help-text' }, `備註：${plan.note}`) : null,
    ),
  );
}

function hStat(label, value, ic, note, extra = '') {
  return h('div', { class: `cf-wedding-stat ${extra}`.trim() },
    h('span', { class: 'cf-wedding-stat-icon' }, icon(ic)),
    h('span', { class: 'cf-wedding-stat-label' }, label),
    h('span', { class: 'cf-wedding-stat-value' }, value),
    note ? h('span', { class: 'cf-wedding-stat-note' }, note) : null,
  );
}

function parseRate(text) {
  const s = String(text).trim();
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 30 ? n : null;
}

function openPlanForm(plan) {
  const name = textInput(plan?.name ?? '', { maxlength: 40, placeholder: '例如：新北兩房' });
  const price = moneyInput(plan?.housePrice ?? '');
  const down = moneyInput(plan?.downPayment ?? '');
  const loan = moneyInput(plan?.loanAmount ?? '');
  const rate = h('input', { type: 'text', inputmode: 'decimal', class: 'form-control', value: String(plan?.annualRate ?? '2.185'), placeholder: '例如 2.185' });
  const years = h('input', { type: 'number', class: 'form-control', min: 1, max: 40, step: 1, value: String(plan?.loanYears ?? 30) });
  const grace = h('input', { type: 'number', class: 'form-control', min: 0, max: 5, step: 1, value: String(plan?.gracePeriodYears ?? 0) });
  const start = h('input', { type: 'month', class: 'form-control', value: plan?.startMonth ?? '' });
  const other = moneyInput(plan?.otherCosts ?? '');
  const note = textInput(plan?.note ?? '', { maxlength: 500 });
  const preview = h('div', { class: 'cf-split-preview cf-field-wide cf-housing-preview', 'aria-live': 'polite' });
  let loanTouched = Boolean(plan);
  loan.addEventListener('input', () => { loanTouched = true; });
  const f = {
    name: field('方案名稱', name, { className: 'cf-field-wide' }),
    housePrice: field('房價（元）', price),
    downPayment: field('頭期款（元）', down),
    loanAmount: field('貸款金額（元）', loan, { help: '預設＝房價 − 頭期款，可自行修改' }),
    otherCosts: field('其他費用（元）', other, { help: '稅費、仲介費、裝潢等' }),
    annualRate: field('年利率（%）', rate),
    loanYears: field('貸款年限（年）', years),
    gracePeriodYears: field('寬限期（年）', grace, { help: '寬限期內只繳利息' }),
    startMonth: field('開始還款月份（選填）', start),
    note: field('備註', note, { className: 'cf-field-wide' }),
  };
  const read = () => ({
    name: name.value,
    housePrice: parseMoneyInput(price.value),
    downPayment: down.value.trim() === '' ? 0 : parseMoneyInput(down.value),
    loanAmount: parseMoneyInput(loan.value),
    otherCosts: other.value.trim() === '' ? 0 : parseMoneyInput(other.value),
    annualRate: parseRate(rate.value),
    loanYears: Number(years.value),
    gracePeriodYears: Number(grace.value || 0),
    startMonth: start.value,
    note: note.value,
  });
  const update = () => {
    const v = read();
    if (!loanTouched && v.housePrice !== null && v.downPayment !== null && v.housePrice >= v.downPayment) loan.value = String(v.housePrice - v.downPayment);
    const v2 = read();
    if (v2.loanAmount > 0 && v2.annualRate !== null && Number.isInteger(v2.loanYears) && v2.loanYears >= 1 && v2.gracePeriodYears < v2.loanYears) {
      const s = amortizationSchedule(v2);
      mount(preview, h('div', null, '試算：', v2.gracePeriodYears ? [`寬限期月付 `, h('strong', null, formatMoney(s.gracePayment)), '，之後 '] : '每月 ', h('strong', null, formatMoney(s.monthlyPayment)), `，總利息 ${formatMoney(s.totalInterest)}（估算）`));
    } else {
      mount(preview);
    }
  };
  for (const el of [price, down, loan, rate, years, grace]) el.addEventListener('input', update);

  const save = async (close) => {
    for (const x of Object.values(f)) x.setError(null);
    const v = read();
    const errs = [];
    if (!v.housePrice || v.housePrice <= 0) errs.push(['housePrice', '請輸入大於 0 的整數']);
    for (const k of ['downPayment', 'loanAmount', 'otherCosts']) if (v[k] === null || v[k] < 0) errs.push([k, '請輸入 0 以上的整數']);
    if (v.annualRate === null) errs.push(['annualRate', '請輸入 0–30 之間的數字，最多 4 位小數']);
    if (!Number.isInteger(v.loanYears) || v.loanYears < 1 || v.loanYears > 40) errs.push(['loanYears', '請輸入 1–40 的整數']);
    if (!Number.isInteger(v.gracePeriodYears) || v.gracePeriodYears < 0 || v.gracePeriodYears > 5) errs.push(['gracePeriodYears', '請輸入 0–5 的整數']);
    if (errs.length) {
      for (const [k, m] of errs) f[k].setError(m);
      toast.error('資料未儲存：請修正標示的欄位');
      return;
    }
    let saved = null;
    const ok = await runAction(async () => { saved = await saveHousingPlan(app.db, plan?.id ?? null, v); }, plan ? `已更新「${v.name.trim()}」` : `已新增購屋方案「${v.name.trim()}」`, {
      onError: (err) => { if (err instanceof ValidationError) for (const e of err.errors) f[e.field]?.setError(e.message); },
    });
    if (ok) {
      if (!plan && saved?.[0]) view.planId = saved[0].id;
      close();
    }
  };
  const { el, close } = openDialog({
    title: plan ? `編輯：${plan.name}` : '新增購屋方案',
    size: 'lg',
    body: h('div', { class: 'cf-form-grid' }, Object.values(f).map((x) => x.el), preview),
    actions: [{ label: '取消', variant: 'secondary', onClick: (c) => c() }, { label: '儲存', variant: 'primary', onClick: save }],
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      save(close);
    }
  });
  update();
  name.focus();
}
