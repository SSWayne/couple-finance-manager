/** 預算管理：月份切換、家庭總／個人／共同／分類預算、使用進度、複製上月。 */
import { h, icon } from '../ui/h.js';
import { pageHeader, panel, notice, statusPill } from '../ui/components.js';
import { field, moneyInput, selectEl, textInput } from '../ui/form.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { runAction, toast } from '../ui/toast.js';
import { ValidationError } from '../data/validate.js';
import { ENUMS } from '../data/schema.js';
import { app } from '../app/state.js';
import { budgetStatuses, LEVEL_TEXT, monthRange, BUDGET_WARN_RATIO } from '../domain/budgets.js';
import { copyPreviousMonth, createBudget, deleteBudget, updateBudget } from '../domain/budgetService.js';
import { categoryTree, orderedMembers } from '../domain/lookup.js';
import { setTransactionFilter } from './transactions.js';
import { formatMoney, parseMoneyInput } from '../lib/money.js';
import { addMonthsToMonth, currentMonth } from '../lib/date.js';

const view = { month: currentMonth() };
const LEVEL_PILL = { ok: 'ok', warning: 'warning', over: 'danger' };

export function render(ctx) {
  const ds = ctx.dataset;
  const list = budgetStatuses(ds, view.month);
  const monthInput = h('input', { type: 'month', class: 'form-control cf-month-input', value: view.month, 'aria-label': '選擇月份', onChange: (e) => { if (e.target.value) { view.month = e.target.value; ctx.rerender(); } } });
  const prev = addMonthsToMonth(view.month, -1);
  const prevCount = ds.budgets.filter((b) => b.month === prev).length;

  const copy = async () => {
    try {
      const r = await copyPreviousMonth(app.db, view.month);
      if (r.created) toast.success(`已從 ${r.prevMonth} 複製 ${r.created} 筆預算${r.skipped ? `，略過 ${r.skipped} 筆（本月已有相同範圍或分類已封存）` : ''}`);
      else toast.warning(`沒有複製任何預算：${r.skipped} 筆在本月都已存在或分類已封存`);
    } catch (err) {
      await runAction(() => Promise.reject(err));
    }
  };

  const over = list.filter((s) => s.level === 'over').length;
  const warn = list.filter((s) => s.level === 'warning').length;

  return h('div', { class: 'cf-page cf-budgets-page' },
    pageHeader('預算管理', `使用 ${Math.round(BUDGET_WARN_RATIO * 100)}% 以上提醒、超過 100% 警告`,
      monthInput,
      h('button', { type: 'button', class: 'btn cf-btn-ghost', disabled: !prevCount, title: prevCount ? `複製 ${prev} 的 ${prevCount} 筆預算` : `${prev} 沒有預算`, onClick: copy }, icon('bi-copy'), ' 複製上月'),
      h('button', { type: 'button', class: 'btn cf-btn-dark', onClick: () => openBudgetForm(null, view.month) }, icon('bi-plus-lg'), ' 新增預算'),
    ),
    over || warn
      ? notice(over ? 'danger' : 'warning', `${view.month} 有 ${over ? `${over} 筆已超支` : ''}${over && warn ? '、' : ''}${warn ? `${warn} 筆接近上限` : ''}。`)
      : null,
    list.length
      ? h('div', { class: 'cf-budget-grid' }, list.map((s) => budgetCard(ds, s, ctx)))
      : panel({},
          h('div', { class: 'cf-empty' }, icon('bi-pie-chart'), h('p', null, `${view.month} 還沒有預算。`),
            h('p', { class: 'cf-help-text' }, prevCount ? `可以按「複製上月」把 ${prev} 的 ${prevCount} 筆預算帶過來。` : '可以設定家庭總預算、共同支出、個人支出或某個分類的預算。')),
        ),
    panel({ title: '預算範圍說明' },
      h('ul', { class: 'cf-info-list' },
        h('li', null, '家庭總預算：這個月所有支出（每筆只算一次）。'),
        h('li', null, '個人預算：該成員的「個人」支出（不含共同支出的分攤）。'),
        h('li', null, '共同預算：所有標記為「共同」的支出。'),
        h('li', null, '分類預算：該主分類的支出，包含底下所有子分類。'),
        h('li', null, '同一個月同一個範圍只能有一筆預算；「複製上月」會略過本月已存在的範圍。'),
      ),
    ),
  );
}

function budgetCard(ds, s, ctx) {
  const b = s.budget;
  const [from, to] = monthRange(b.month);
  const showTx = () => {
    const f = { type: 'expense', from, to };
    if (b.scope === 'category') f.categoryId = b.categoryId;
    setTransactionFilter(f);
    ctx.navigate('transactions');
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: '刪除預算', message: `確定要刪除 ${b.month}「${s.title}」的預算嗎？`, confirmLabel: '刪除', danger: true });
    if (ok) await runAction(() => deleteBudget(app.db, b.id), '已刪除預算');
  };
  const pct = Math.round(s.ratio * 100);
  const cat = b.scope === 'category' ? ds.categories.find((c) => c.id === b.categoryId) : null;
  return h('article', { class: `cf-budget-card cf-budget-card-${s.level}` },
    h('div', { class: 'cf-budget-card-head' },
      h('span', { class: 'cf-budget-card-icon', style: cat ? { '--cf-swatch': cat.color } : null }, icon(cat?.icon ?? { household: 'bi-house-heart', shared: 'bi-people', personal: 'bi-person' }[b.scope] ?? 'bi-pie-chart')),
      h('div', { class: 'cf-budget-card-titles' },
        h('h3', { class: 'cf-budget-card-title' }, s.title),
        h('span', { class: 'cf-budget-card-scope' }, ENUMS.budgetScope[b.scope]),
      ),
      statusPill(LEVEL_PILL[s.level], `${LEVEL_TEXT[s.level]} ${pct}%`),
    ),
    h('div', { class: `cf-progress cf-progress-${s.level}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': `${s.title}已用 ${pct}%` },
      h('span', { class: 'cf-progress-fill', style: { width: `${Math.min(100, pct)}%` } }),
    ),
    h('dl', { class: 'cf-budget-card-nums' },
      h('div', null, h('dt', null, '已用'), h('dd', null, formatMoney(s.spent))),
      h('div', null, h('dt', null, '預算'), h('dd', null, formatMoney(b.amount))),
      h('div', null, h('dt', null, s.remaining >= 0 ? '剩餘' : '超支'), h('dd', { class: { 'cf-budget-card-over': s.remaining < 0 } }, formatMoney(Math.abs(s.remaining)))),
    ),
    b.note ? h('p', { class: 'cf-budget-card-note' }, b.note) : null,
    h('div', { class: 'cf-budget-card-actions' },
      h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: showTx }, icon('bi-list-ul'), ' 明細'),
      h('button', { type: 'button', class: 'cf-icon-btn', title: '修改', 'aria-label': `修改「${s.title}」預算`, onClick: () => openBudgetForm(b, b.month) }, icon('bi-pencil')),
      h('button', { type: 'button', class: 'cf-icon-btn cf-icon-btn-danger', title: '刪除', 'aria-label': `刪除「${s.title}」預算`, onClick: remove }, icon('bi-trash')),
    ),
  );
}

function openBudgetForm(budget, month) {
  const ds = app.dataset;
  const editing = Boolean(budget);
  const monthInput = h('input', { type: 'month', class: 'form-control', value: budget?.month ?? month, disabled: editing });
  const scopeSel = selectEl(Object.entries(ENUMS.budgetScope).map(([value, label]) => ({ value, label })), budget?.scope ?? 'household', { disabled: editing });
  const memberSel = selectEl(orderedMembers(ds).map((m) => ({ value: m.id, label: m.name })), budget?.memberId ?? 'member-self', { disabled: editing });
  const catSel = selectEl(categoryTree(ds, 'expense', { keepIds: [budget?.categoryId] }).map((c) => ({ value: c.id, label: c.children.length ? `${c.name}（含 ${c.children.length} 個子分類）` : c.name })), budget?.categoryId ?? 'cat-exp-food', { disabled: editing });
  const amountInput = moneyInput(budget?.amount ?? '', { required: true });
  const noteInput = textInput(budget?.note ?? '', { maxlength: 100 });
  const f = {
    month: field('月份', monthInput),
    scope: field('範圍', scopeSel),
    memberId: field('成員', memberSel),
    categoryId: field('分類', catSel),
    amount: field('預算金額（元）', amountInput),
    note: field('備註', noteInput, { className: 'cf-field-wide' }),
  };
  const sync = () => {
    f.memberId.setVisible(scopeSel.value === 'personal');
    f.categoryId.setVisible(scopeSel.value === 'category');
  };
  scopeSel.addEventListener('change', sync);
  sync();
  const body = h('div', { class: 'cf-form-stack' },
    editing ? notice('info', '已建立的預算只能修改金額與備註；要改範圍請刪除後重新新增。') : null,
    h('div', { class: 'cf-form-grid' }, Object.values(f).map((x) => x.el)),
  );
  const save = async (close) => {
    for (const x of Object.values(f)) x.setError(null);
    const amount = parseMoneyInput(amountInput.value);
    if (!amount || amount <= 0) {
      f.amount.setError('請輸入大於 0 的整數金額');
      toast.error('資料未儲存：預算金額必須是大於 0 的整數');
      return;
    }
    const ok = await runAction(
      () => (editing
        ? updateBudget(app.db, budget.id, { amount, note: noteInput.value })
        : createBudget(app.db, { month: monthInput.value, scope: scopeSel.value, memberId: memberSel.value, categoryId: catSel.value, amount, note: noteInput.value })),
      editing ? '已更新預算' : `已新增 ${monthInput.value} 預算 ${formatMoney(amount)}`,
      { onError: (err) => { if (err instanceof ValidationError) for (const e of err.errors) f[e.field]?.setError(e.message); } },
    );
    if (ok) close();
  };
  const { el, close } = openDialog({
    title: editing ? '修改預算' : '新增預算',
    body,
    actions: [{ label: '取消', variant: 'secondary', onClick: (c) => c() }, { label: '儲存', variant: 'primary', onClick: save }],
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      save(close);
    }
  });
  amountInput.focus();
}
