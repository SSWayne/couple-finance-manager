/**
 * 財務總覽（依參考圖）。所有數字由真實資料計算，不放任何假資料。
 * 版面：左欄 主卡片（淨資產＋收支圖＋本月數字）→ 預算＋提醒 → 支出分析＋財務健康＋儲蓄目標
 *       右欄 帳戶卡片＋快速動作 → 代墊狀況 → 最近 10 筆交易
 */
import { h, svg, icon } from '../ui/h.js';
import { selectEl, uid } from '../ui/form.js';
import { runAction } from '../ui/toast.js';
import { app } from '../app/state.js';
import { ENUMS } from '../data/schema.js';
import { exportBackupNow } from '../app/backupActions.js';
import { openTransactionForm } from './transactionForm.js';
import { setTransactionFilter, txRow } from './transactions.js';
import { updateSettings } from '../domain/settingsService.js';
import { netWorth } from '../domain/balances.js';
import { bucketSeries, buildReminders, monthToDate, periodBuckets, spendingByCategory } from '../domain/dashboard.js';
import { budgetStatuses, LEVEL_TEXT, monthRange } from '../domain/budgets.js';
import { advanceSummary } from '../domain/settlementService.js';
import { activeGoalProgress } from '../domain/savings.js';
import { ACCOUNT_TYPE_ICON, accountTypeLabel, memberName, sortedAccounts } from '../domain/lookup.js';
import { formatMoney } from '../lib/money.js';
import { today as todayStr, addMonthsToMonth } from '../lib/date.js';

let chart = null;
const view = { spendingMonth: null };

function destroyChart() {
  if (chart) {
    chart.destroy();
    chart = null;
  }
}

export function onLeave() {
  destroyChart();
}

export async function render(ctx) {
  destroyChart();
  const ds = ctx.dataset;
  const today = todayStr();
  const month = today.slice(0, 7);
  if (!view.spendingMonth) view.spendingMonth = month;

  const left = h('div', { class: 'cf-dash-left' },
    await mainCard(ds, today),
    h('div', { class: 'cf-dash-row cf-dash-row-2' }, budgetCard(ds, month), remindersCard(ds, today)),
    h('div', { class: 'cf-dash-row cf-dash-row-3' }, spendingCard(ds, ctx), healthCard(ds, today), goalsCard(ds, today)),
  );
  const right = h('div', { class: 'cf-dash-right' }, accountsCard(ds, ctx), advanceCard(ds, ctx), recentCard(ds, ctx));
  return h('div', { class: 'cf-page cf-dash' }, h('h1', { class: 'cf-visually-hidden' }, '財務總覽'), h('div', { class: 'cf-dash-grid' }, left, right));
}

// ---------------------------------------------------------------------------
// 主卡片：淨資產＋收支長條圖＋本月收入／支出／結餘
// ---------------------------------------------------------------------------
async function mainCard(ds, today) {
  const period = ds.settings.dashboardPeriod;
  const { net, assets, liabilities } = netWorth(ds);
  const buckets = periodBuckets(period, today);
  const series = bucketSeries(ds, buckets);
  // 預設強調：今天以前最近一個有收支的區間；都沒有就用最後一個非未來區間
  let defaultIndex = buckets.findLastIndex((b, i) => !b.future && (series[i].income || series[i].expense));
  if (defaultIndex < 0) defaultIndex = buckets.findLastIndex((b) => !b.future);
  if (defaultIndex < 0) defaultIndex = buckets.length - 1;

  const periodSel = selectEl(Object.entries(ENUMS.dashboardPeriod).map(([value, label]) => ({ value, label })), period, {
    class: 'form-select cf-dash-period',
    'aria-label': '圖表期間',
    onChange: (e) => runAction(() => updateSettings(app.db, { dashboardPeriod: e.target.value }), `已記住圖表期間：${ENUMS.dashboardPeriod[e.target.value]}`),
  });

  const focus = h('div', { class: 'cf-dash-focus', 'aria-live': 'polite' });
  const showFocus = (i) => {
    const s = series[i];
    const b = buckets[i];
    focus.replaceChildren(
      h('span', { class: 'cf-dash-focus-title' }, b.title),
      h('span', null, h('i', { class: 'cf-dash-dot cf-dash-dot-income' }), '收入 ', h('strong', null, formatMoney(s.income))),
      h('span', null, h('i', { class: 'cf-dash-dot cf-dash-dot-expense' }), '支出 ', h('strong', null, formatMoney(s.expense))),
      h('span', null, h('i', { class: 'cf-dash-dot cf-dash-dot-net' }), '結餘 ', h('strong', null, formatMoney(s.net))),
    );
  };
  showFocus(defaultIndex);

  const canvas = h('canvas', { role: 'img', 'aria-label': `收支長條圖（${ENUMS.dashboardPeriod[period]}）：收入往上、支出往下，黃線為結餘` });
  const chartBox = h('div', { class: 'cf-dash-chart' }, canvas);
  const hasData = series.some((s) => s.income || s.expense);

  const mtd = monthToDate(ds, today);
  const stats = h('div', { class: 'cf-dash-stats' },
    statBlock('本月收入', mtd.current.income, mtd.change.income, true),
    statBlock('本月支出', mtd.current.expense, mtd.change.expense, false),
    statBlock('本月結餘', mtd.current.net, mtd.change.net, true),
  );

  const card = h('section', { class: 'cf-dash-card cf-dash-main' },
    h('div', { class: 'cf-dash-main-chartside' },
      h('div', { class: 'cf-dash-main-head' },
        h('div', { class: 'cf-dash-networth' },
          h('span', { class: { 'cf-dash-networth-value': true, 'cf-dash-negative': net < 0 } }, formatMoney(net)),
          h('span', { class: 'cf-dash-networth-label' }, `家庭淨資產 · 資產 ${formatMoney(assets)} − 負債 ${formatMoney(liabilities)}`),
        ),
        h('div', { class: 'cf-dash-main-tools' },
          h('div', { class: 'cf-dash-legend' },
            h('span', null, h('i', { class: 'cf-dash-dot cf-dash-dot-net' }), '結餘'),
            h('span', null, h('i', { class: 'cf-dash-dot cf-dash-dot-income' }), '收入'),
            h('span', null, h('i', { class: 'cf-dash-dot cf-dash-dot-expense' }), '支出'),
          ),
          periodSel,
        ),
      ),
      focus,
      hasData ? chartBox : h('div', { class: 'cf-dash-chart cf-dash-chart-empty' }, icon('bi-bar-chart'), h('p', null, `${ENUMS.dashboardPeriod[period]}內還沒有收支紀錄`)),
    ),
    stats,
  );

  if (hasData) {
    // 等節點掛上畫面後再建立圖表，尺寸才正確
    requestAnimationFrame(async () => {
      if (!canvas.isConnected) return;
      const { createCashflowChart } = await import('../ui/charts.js');
      if (!canvas.isConnected) return;
      destroyChart();
      chart = createCashflowChart(canvas, {
        labels: buckets.map((b) => b.label),
        titles: buckets.map((b) => b.title),
        series,
        defaultIndex,
        onActiveChange: showFocus,
      });
    });
  }
  return card;
}

function statBlock(label, value, change, upIsGood) {
  let changeEl;
  if (change === null) changeEl = h('span', { class: 'cf-dash-change cf-dash-change-none' }, '上月同期無資料');
  else {
    const up = change >= 0;
    const good = up === upIsGood;
    changeEl = h('span', { class: { 'cf-dash-change': true, 'cf-dash-change-good': good, 'cf-dash-change-bad': !good } },
      icon(up ? 'bi-arrow-up-right' : 'bi-arrow-down-right'), ` ${Math.abs(change * 100).toFixed(1)}% `, h('span', { class: 'cf-dash-change-note' }, '較上月同期'));
  }
  return h('div', { class: 'cf-dash-stat' },
    h('span', { class: 'cf-dash-stat-label' }, label),
    h('span', { class: { 'cf-dash-stat-value': true, 'cf-dash-negative': value < 0 } }, formatMoney(value)),
    changeEl,
  );
}

// ---------------------------------------------------------------------------
// 本月預算
// ---------------------------------------------------------------------------
function progressBar(ratio, level, { label } = {}) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return h('div', { class: `cf-progress cf-progress-${level}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(ratio * 100), 'aria-label': label },
    h('span', { class: 'cf-progress-fill', style: { width: `${pct}%` } }),
  );
}

function budgetCard(ds, month) {
  const list = budgetStatuses(ds, month);
  const main = list[0];
  const others = list.slice(1, 4);
  return h('section', { class: 'cf-dash-card cf-dash-budget' },
    cardHead('本月預算', main ? `${list.length} 筆預算 · ${month.replace('-', ' 年 ')} 月` : '尚未設定', h('a', { class: 'cf-icon-btn', href: '#/budgets', title: '預算管理', 'aria-label': '前往預算管理' }, icon('bi-pencil'))),
    main
      ? [
          h('div', { class: 'cf-dash-budget-main' },
            h('div', { class: 'cf-dash-budget-main-head' },
              h('span', null, main.title),
              h('span', { class: `cf-dash-budget-level cf-dash-budget-level-${main.level}` }, `${LEVEL_TEXT[main.level]} · ${Math.round(main.ratio * 100)}%`),
            ),
            progressBar(main.ratio, main.level, { label: `${main.title}已用 ${Math.round(main.ratio * 100)}%` }),
            h('div', { class: 'cf-dash-budget-scale' }, h('span', null, `已用 ${formatMoney(main.spent)}`), h('span', null, formatMoney(main.budget.amount))),
          ),
          others.length
            ? h('ul', { class: 'cf-dash-budget-list' }, others.map((s) =>
                h('li', null,
                  h('div', { class: 'cf-dash-budget-row' }, h('span', { class: 'cf-dash-budget-name' }, s.title), h('span', { class: `cf-dash-budget-level cf-dash-budget-level-${s.level}` }, `${formatMoney(s.spent)} / ${formatMoney(s.budget.amount)}`)),
                  progressBar(s.ratio, s.level, { label: `${s.title}已用 ${Math.round(s.ratio * 100)}%` }),
                )))
            : null,
        ]
      : h('div', { class: 'cf-dash-empty' }, h('p', null, '設定每月預算後，這裡會顯示使用進度（80% 提醒、超過 100% 警告）。'), h('a', { class: 'btn cf-btn-ghost', href: '#/budgets' }, icon('bi-plus-lg'), ' 設定預算')),
  );
}

function cardHead(title, subtitle, action) {
  return h('div', { class: 'cf-dash-card-head' },
    h('div', { class: 'cf-dash-card-titles' }, h('h2', { class: 'cf-dash-card-title' }, title), subtitle ? h('span', { class: 'cf-dash-card-subtitle' }, subtitle) : null),
    action ?? null,
  );
}

// ---------------------------------------------------------------------------
// 財務提醒
// ---------------------------------------------------------------------------
function remindersCard(ds, today) {
  const list = buildReminders(ds, today);
  return h('section', { class: 'cf-dash-card cf-dash-reminders' },
    cardHead('財務提醒', list.length ? `${list.length} 則` : '一切正常'),
    list.length
      ? h('ul', { class: 'cf-dash-reminder-list' }, list.slice(0, 5).map((r) => {
          const inner = [h('span', { class: `cf-dash-reminder-icon cf-dash-reminder-${r.level}` }, icon(r.icon)), h('span', { class: 'cf-dash-reminder-text' }, r.text), icon('bi-chevron-right', 'cf-dash-reminder-go')];
          return h('li', null, r.action === 'backup'
            ? h('button', { type: 'button', class: 'cf-dash-reminder', onClick: () => exportBackupNow() }, inner)
            : h('a', { class: 'cf-dash-reminder', href: r.href }, inner));
        }))
      : h('div', { class: 'cf-dash-empty' }, icon('bi-check2-circle'), h('p', null, '目前沒有需要注意的事項')),
  );
}

// ---------------------------------------------------------------------------
// 支出分析
// ---------------------------------------------------------------------------
function spendingCard(ds, ctx) {
  const thisMonth = todayStr().slice(0, 7);
  const months = Array.from({ length: 12 }, (_, i) => addMonthsToMonth(thisMonth, -i));
  const sel = selectEl(months.map((m) => ({ value: m, label: `${Number(m.slice(5))} 月${m.slice(0, 4) !== thisMonth.slice(0, 4) ? `（${m.slice(0, 4)}）` : ''}` })), view.spendingMonth, {
    class: 'form-select cf-dash-period',
    'aria-label': '支出分析月份',
    onChange: (e) => { view.spendingMonth = e.target.value; ctx.rerender(); },
  });
  const [from, to] = monthRange(view.spendingMonth);
  const { total, items } = spendingByCategory(ds, from, to);
  const go = (item) => {
    if (!item.categoryId) {
      setTransactionFilter({ type: 'expense', from, to });
    } else {
      setTransactionFilter({ type: 'expense', from, to, categoryId: item.categoryId });
    }
    ctx.navigate('transactions');
  };
  return h('section', { class: 'cf-dash-card cf-dash-spending' },
    cardHead('支出分析', '依主分類', sel),
    h('span', { class: 'cf-dash-big' }, formatMoney(total)),
    total
      ? [
          h('div', { class: 'cf-dash-segbar', role: 'img', 'aria-label': `支出分布：${items.map((x) => `${x.name} ${Math.round(x.ratio * 100)}%`).join('、')}` },
            items.map((x) => h('span', { class: 'cf-dash-seg', style: { flex: `${Math.max(x.ratio, 0.02)} 1 0`, '--cf-swatch': x.color }, title: `${x.name} ${formatMoney(x.amount)}` }))),
          h('ul', { class: 'cf-dash-seg-legend' }, items.map((x) =>
            h('li', null,
              h('button', { type: 'button', class: 'cf-dash-seg-item', onClick: () => go(x), title: `查看「${x.name}」的交易` },
                h('i', { class: 'cf-dash-seg-swatch', style: { '--cf-swatch': x.color } }),
                h('span', { class: 'cf-dash-seg-name' }, x.name),
                h('span', { class: 'cf-dash-seg-pct' }, `${(x.ratio * 100).toFixed(0)}%`),
              )))),
        ]
      : h('div', { class: 'cf-dash-empty' }, h('p', null, '這個月還沒有支出')),
  );
}

// ---------------------------------------------------------------------------
// 財務健康：半圓儀表＝本月儲蓄率
// ---------------------------------------------------------------------------
function gauge(rate) {
  const id = uid('cf-gauge');
  const r = 80;
  const len = Math.PI * r;
  const value = rate === null ? 0 : Math.max(0, Math.min(1, rate));
  const arc = 'M 20 100 A 80 80 0 0 1 180 100';
  return svg('svg', { class: 'cf-dash-gauge-svg', viewBox: '0 0 200 112', 'aria-hidden': 'true' },
    svg('defs', null,
      svg('linearGradient', { id: `${id}-grad`, x1: '0', y1: '0', x2: '1', y2: '0' },
        svg('stop', { offset: '0%', 'stop-color': '#EDE35C' }),
        svg('stop', { offset: '100%', 'stop-color': '#8DBF35' })),
      svg('pattern', { id: `${id}-hatch`, width: '8', height: '8', patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        svg('rect', { width: '8', height: '8', fill: '#F1F2F0' }),
        svg('line', { x1: '0', y1: '0', x2: '0', y2: '8', stroke: '#E1E3DF', 'stroke-width': '3' })),
    ),
    svg('path', { d: arc, fill: 'none', stroke: `url(#${id}-hatch)`, 'stroke-width': '26', 'stroke-linecap': 'round' }),
    value > 0
      ? svg('path', { d: arc, fill: 'none', stroke: `url(#${id}-grad)`, 'stroke-width': '26', 'stroke-linecap': 'round', 'stroke-dasharray': `${len * value} ${len}` })
      : null,
  );
}

function healthCard(ds, today) {
  const { current } = monthToDate(ds, today);
  const rate = current.savingsRate;
  const pctText = rate === null ? '不適用' : `${Math.round(rate * 100)}%`;
  let comment;
  if (rate === null) comment = '本月還沒有收入，儲蓄率不適用。';
  else if (rate < 0) comment = '本月支出大於收入，結餘為負。';
  else if (rate < 0.1) comment = '儲蓄率偏低，可以檢查是否有可減少的支出。';
  else if (rate < 0.3) comment = '儲蓄率穩定，持續保持。';
  else comment = '儲蓄率很好，繼續加油！';
  return h('section', { class: 'cf-dash-card cf-dash-health' },
    cardHead('財務健康', '本月儲蓄率'),
    h('span', { class: { 'cf-dash-big': true, 'cf-dash-negative': current.net < 0 } }, formatMoney(current.net)),
    h('span', { class: 'cf-dash-card-subtitle' }, '本月至今結餘（收入 − 支出）'),
    h('div', { class: 'cf-dash-gauge', role: 'img', 'aria-label': `本月儲蓄率 ${pctText}` },
      gauge(rate),
      h('div', { class: 'cf-dash-gauge-label' }, h('strong', null, pctText), h('span', null, '本月儲蓄率')),
    ),
    h('p', { class: 'cf-dash-footnote' }, `儲蓄率＝結餘 ÷ 收入。${comment}`),
  );
}

// ---------------------------------------------------------------------------
// 儲蓄目標
// ---------------------------------------------------------------------------
function goalsCard(ds, today) {
  const list = activeGoalProgress(ds, today).slice(0, 4);
  return h('section', { class: 'cf-dash-card cf-dash-goals' },
    cardHead('儲蓄目標', list.length ? `${list.length} 個進行中` : '尚未建立', h('a', { class: 'btn cf-btn-ghost cf-dash-small-btn', href: '#/savings' }, icon('bi-plus-lg'), ' 目標')),
    list.length
      ? h('ul', { class: 'cf-dash-goal-list' }, list.map((g) =>
          h('li', { class: 'cf-dash-goal' },
            h('span', { class: 'cf-dash-goal-icon' }, icon(g.goal.icon || 'bi-piggy-bank')),
            h('div', { class: 'cf-dash-goal-body' },
              h('span', { class: 'cf-dash-goal-name' }, g.goal.name),
              h('span', { class: 'cf-dash-goal-amount' }, `${formatMoney(g.saved)} / ${formatMoney(g.goal.targetAmount)}`),
              progressBar(g.ratio, g.overdue ? 'warning' : 'goal', { label: `${g.goal.name}已達成 ${Math.round(g.ratio * 100)}%` }),
              h('span', { class: 'cf-dash-goal-note' },
                g.remaining === 0 ? '已達成目標'
                  : g.overdue ? `已過期限，還差 ${formatMoney(g.remaining)}`
                    : g.monthsLeft ? `剩 ${g.monthsLeft} 個月 · 每月建議 ${formatMoney(g.monthlySuggestion)}`
                      : `還差 ${formatMoney(g.remaining)}（未設定期限）`),
            ),
          )))
      : h('div', { class: 'cf-dash-empty' }, h('p', null, '建立購屋頭期款、蜜月旅行等目標，追蹤累積進度。')),
  );
}

// ---------------------------------------------------------------------------
// 右欄：帳戶卡片＋快速動作
// ---------------------------------------------------------------------------
function accountsCard(ds, ctx) {
  const { balances } = netWorth(ds);
  const accounts = sortedAccounts(ds).filter((a) => !a.archived);
  const actions = [
    ['bi-dash-circle', '記支出', () => openTransactionForm({ defaults: { type: 'expense' } })],
    ['bi-plus-circle', '記收入', () => openTransactionForm({ defaults: { type: 'income', ownershipType: 'personal' } })],
    ['bi-arrow-left-right', '轉帳', () => openTransactionForm({ defaults: { type: 'transfer' } })],
    ['bi-check2-all', '結算', () => ctx.navigate('couple')],
    ['bi-cloud-arrow-down', '備份', () => exportBackupNow()],
  ];
  return h('section', { class: 'cf-dash-card cf-dash-accounts' },
    cardHead('我們的帳戶', `${accounts.length} 個使用中`, h('a', { class: 'btn cf-btn-ghost cf-dash-small-btn', href: '#/accounts' }, icon('bi-plus-lg'), ' 帳戶')),
    accounts.length
      ? h('div', { class: 'cf-dash-acc-scroller', tabIndex: 0, 'aria-label': '帳戶卡片（可左右滑動）' },
          accounts.map((a, i) => {
            const bal = balances.get(a.id) ?? 0;
            return h('a', { class: `cf-dash-acc cf-dash-acc-${i === 0 ? 'primary' : i === 1 ? 'secondary' : 'plain'}`, href: '#/accounts', onClick: (e) => { e.preventDefault(); setTransactionFilter({ accountId: a.id }); ctx.navigate('transactions'); }, title: `查看「${a.name}」的交易` },
              h('span', { class: 'cf-dash-acc-top' }, h('span', null, accountTypeLabel(a.type)), icon(ACCOUNT_TYPE_ICON[a.type] ?? 'bi-wallet2')),
              h('span', { class: { 'cf-dash-acc-balance': true, 'cf-dash-negative': bal < 0 } }, formatMoney(bal)),
              h('span', { class: 'cf-dash-acc-bottom' }, h('span', { class: 'cf-dash-acc-name' }, a.name), h('span', null, a.ownershipType === 'shared' ? '共同' : memberName(ds, a.ownerMemberId))),
            );
          }))
      : h('div', { class: 'cf-dash-empty' }, h('p', null, '還沒有帳戶。'), h('a', { class: 'btn cf-btn-dark', href: '#/accounts' }, '新增第一個帳戶')),
    h('div', { class: 'cf-dash-quick' }, actions.map(([ic, label, fn]) =>
      h('button', { type: 'button', class: 'cf-dash-quick-btn', onClick: fn },
        h('span', { class: 'cf-dash-quick-icon' }, icon(ic)),
        h('span', { class: 'cf-dash-quick-label' }, label)))),
  );
}

function advanceCard(ds, ctx) {
  const adv = advanceSummary(ds);
  return h('section', { class: 'cf-dash-card cf-dash-advance' },
    cardHead('代墊狀況', adv.transactions.length ? `${adv.transactions.length} 筆未結算` : '沒有未結算'),
    adv.net.amount > 0
      ? h('div', { class: 'cf-dash-advance-body' },
          h('div', { class: 'cf-dash-advance-pair' },
            h('span', { class: 'cf-avatar cf-avatar-' + (adv.net.fromMemberId === 'member-self' ? 'self' : 'partner') }, [...memberName(ds, adv.net.fromMemberId)][0]),
            icon('bi-arrow-right'),
            h('span', { class: 'cf-avatar cf-avatar-' + (adv.net.toMemberId === 'member-self' ? 'self' : 'partner') }, [...memberName(ds, adv.net.toMemberId)][0]),
          ),
          h('div', { class: 'cf-dash-advance-text' },
            h('span', null, `${memberName(ds, adv.net.fromMemberId)}應付${memberName(ds, adv.net.toMemberId)}`),
            h('strong', null, formatMoney(adv.net.amount)),
          ),
          h('button', { type: 'button', class: 'btn cf-btn-lime cf-dash-small-btn', onClick: () => ctx.navigate('couple') }, '去結算'),
        )
      : h('p', { class: 'cf-dash-card-subtitle' }, adv.transactions.length ? '互相抵銷後剛好打平。' : '兩人之間目前沒有代墊。'),
  );
}

function recentCard(ds, ctx) {
  const list = [...ds.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  return h('section', { class: 'cf-dash-card cf-dash-recent' },
    cardHead('最近交易', '最新 10 筆', h('button', { type: 'button', class: 'btn cf-btn-ghost cf-dash-small-btn', onClick: () => { setTransactionFilter({}); ctx.navigate('transactions'); } }, '全部')),
    list.length
      ? h('ul', { class: 'cf-txrow-list' }, list.map((t) => txRow(ds, t, { compact: true })))
      : h('div', { class: 'cf-dash-empty' }, h('p', null, '還沒有交易，按右下角「＋」記第一筆。')),
  );
}
