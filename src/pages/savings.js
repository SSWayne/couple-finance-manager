/** 儲蓄目標：目標卡片、撥款／提回（可同時建立轉帳）、撥款紀錄、完成／封存。 */
import { h, icon } from '../ui/h.js';
import { pageHeader, panel, notice, statusPill } from '../ui/components.js';
import { field, moneyInput, segmented, selectEl, textInput } from '../ui/form.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { runAction, toast } from '../ui/toast.js';
import { ValidationError } from '../data/validate.js';
import { app } from '../app/state.js';
import { goalProgress } from '../domain/savings.js';
import { addContribution, deleteContribution, deleteGoal, saveGoal, setGoalStatus } from '../domain/savingsService.js';
import { accountName, memberName, orderedMembers, sortedAccounts } from '../domain/lookup.js';
import { formatMoney, parseMoneyInput } from '../lib/money.js';
import { today } from '../lib/date.js';
import { MEMBER_SELF } from '../domain/split.js';

const view = { showInactive: false };
const GOAL_ICONS = ['bi-piggy-bank', 'bi-house-heart', 'bi-airplane', 'bi-car-front', 'bi-heart', 'bi-mortarboard', 'bi-shield-check', 'bi-gift', 'bi-laptop', 'bi-bag-heart'];

export function render(ctx) {
  const ds = ctx.dataset;
  const t = today();
  const all = ds.savingsGoals.map((g) => goalProgress(ds, g, t));
  const active = all.filter((p) => p.goal.status === 'active');
  const inactive = all.filter((p) => p.goal.status !== 'active');
  const shown = (view.showInactive ? all : active).sort((a, b) => (a.goal.status === 'active' ? 0 : 1) - (b.goal.status === 'active' ? 0 : 1) || (a.goal.targetDate ?? '9999').localeCompare(b.goal.targetDate ?? '9999'));
  const totalSaved = active.reduce((s, p) => s + p.saved, 0);
  const totalTarget = active.reduce((s, p) => s + p.goal.targetAmount, 0);
  const totalMonthly = active.reduce((s, p) => s + p.monthlySuggestion, 0);

  return h('div', { class: 'cf-page cf-savings-page' },
    pageHeader('儲蓄目標', '撥款只是標記，不算支出、不增加資產',
      h('button', { type: 'button', class: 'btn cf-btn-dark', onClick: () => openGoalForm(null) }, icon('bi-plus-lg'), ' 新增目標'),
    ),
    h('div', { class: 'cf-wedding-stats cf-savings-stats' },
      sStat('進行中目標', `${active.length} 個`, 'bi-flag'),
      sStat('已累積', formatMoney(totalSaved), 'bi-piggy-bank'),
      sStat('目標合計', formatMoney(totalTarget), 'bi-bullseye'),
      sStat('每月建議合計', formatMoney(totalMonthly), 'bi-calendar-check', '有期限的目標', 'cf-wedding-stat-main'),
    ),
    panel(
      {
        title: '目標',
        subtitle: inactive.length ? `${inactive.length} 個已完成或已封存` : null,
        actions: inactive.length
          ? h('div', { class: 'form-check form-switch cf-accounts-toggle' },
              h('input', { class: 'form-check-input', type: 'checkbox', id: 'cf-show-inactive-goals', checked: view.showInactive, onChange: (e) => { view.showInactive = e.target.checked; ctx.rerender(); } }),
              h('label', { class: 'form-check-label', htmlFor: 'cf-show-inactive-goals' }, '顯示已完成／封存'))
          : null,
      },
      shown.length
        ? h('div', { class: 'cf-goal-grid' }, shown.map((p) => goalCard(ds, p)))
        : h('div', { class: 'cf-empty' }, icon('bi-piggy-bank'), h('p', null, '還沒有儲蓄目標。'), h('p', { class: 'cf-help-text' }, '例如：購屋頭期款、蜜月旅行、緊急預備金。')),
    ),
    panel({ title: '說明' },
      h('ul', { class: 'cf-info-list' },
        h('li', null, '撥款只是「標記」這筆錢預定給哪個目標用，本身不算支出，也不會讓資產增加。'),
        h('li', null, '撥款時若選擇轉出帳戶，會同時建立一筆實際轉帳（轉出帳戶 → 目標帳戶），帳戶餘額會跟著變動。'),
        h('li', null, '提回不能超過已累積的金額；提回不會建立轉帳。'),
        h('li', null, '每月建議＝⌈剩餘金額 ÷ 剩餘月數⌉（含本月）。'),
        h('li', null, '有撥款紀錄的目標不能刪除，請改用「封存」。'),
      ),
    ),
  );
}

function sStat(label, value, ic, note, extra = '') {
  return h('div', { class: `cf-wedding-stat ${extra}`.trim() },
    h('span', { class: 'cf-wedding-stat-icon' }, icon(ic)),
    h('span', { class: 'cf-wedding-stat-label' }, label),
    h('span', { class: 'cf-wedding-stat-value' }, value),
    note ? h('span', { class: 'cf-wedding-stat-note' }, note) : null,
  );
}

function goalCard(ds, p) {
  const g = p.goal;
  const done = p.remaining === 0;
  const owner = g.ownershipType === 'shared' ? '共同' : `${memberName(ds, g.ownerMemberId)}個人`;
  const statusText = g.status === 'archived' ? statusPill('muted', '已封存') : g.status === 'completed' ? statusPill('ok', '已完成') : done ? statusPill('ok', '已達成') : p.overdue ? statusPill('warning', '已過期限') : null;
  const count = ds.savingsContributions.filter((c) => c.goalId === g.id).length;
  const remove = async () => {
    const ok = await confirmDialog({ title: '刪除儲蓄目標', message: `確定要刪除「${g.name}」嗎？`, confirmLabel: '刪除', danger: true });
    if (ok) await runAction(() => deleteGoal(app.db, g.id), `已刪除「${g.name}」`);
  };
  const setStatus = (status, msg) => runAction(() => setGoalStatus(app.db, g.id, status), msg);
  return h('article', { class: { 'cf-goal-card': true, 'cf-goal-card-inactive': g.status !== 'active' } },
    h('div', { class: 'cf-goal-card-head' },
      h('span', { class: 'cf-goal-card-icon' }, icon(g.icon || 'bi-piggy-bank')),
      h('div', { class: 'cf-goal-card-titles' },
        h('h3', { class: 'cf-goal-card-name' }, g.name),
        h('span', { class: 'cf-help-text' }, [owner, g.accountId ? `目標帳戶：${accountName(ds, g.accountId)}` : '未設定目標帳戶'].join(' · ')),
      ),
      statusText,
    ),
    h('div', { class: 'cf-goal-card-amounts' },
      h('span', { class: 'cf-goal-card-saved' }, formatMoney(p.saved)),
      h('span', { class: 'cf-help-text' }, ` / ${formatMoney(g.targetAmount)}（${Math.round(p.ratio * 100)}%）`),
    ),
    h('div', { class: `cf-progress cf-progress-${p.overdue ? 'warning' : 'goal'}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(p.ratio * 100), 'aria-label': `${g.name}已達成 ${Math.round(p.ratio * 100)}%` },
      h('span', { class: 'cf-progress-fill', style: { width: `${p.ratio * 100}%` } })),
    h('dl', { class: 'cf-budget-card-nums' },
      h('div', null, h('dt', null, '還差'), h('dd', null, formatMoney(p.remaining))),
      h('div', null, h('dt', null, '期限'), h('dd', null, g.targetDate ? `${g.targetDate.replaceAll('-', '/')}` : '未設定')),
      h('div', null, h('dt', null, '每月建議'), h('dd', null, p.monthsLeft && p.remaining ? formatMoney(p.monthlySuggestion) : '—')),
    ),
    p.monthsLeft && p.remaining ? h('span', { class: 'cf-help-text' }, `剩 ${p.monthsLeft} 個月（含本月）${p.overdue ? '，已過期限' : ''}`) : null,
    h('div', { class: 'cf-goal-card-actions' },
      g.status === 'active'
        ? [
            h('button', { type: 'button', class: 'btn cf-btn-lime', onClick: () => openContributionForm(g, 'in') }, icon('bi-plus-lg'), ' 撥款'),
            h('button', { type: 'button', class: 'btn cf-btn-ghost', disabled: p.saved <= 0, onClick: () => openContributionForm(g, 'out') }, icon('bi-dash-lg'), ' 提回'),
          ]
        : h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: () => setStatus('active', `已恢復「${g.name}」為進行中`) }, icon('bi-arrow-counterclockwise'), ' 恢復'),
      h('button', { type: 'button', class: 'cf-icon-btn', title: `撥款紀錄（${count} 筆）`, 'aria-label': `「${g.name}」撥款紀錄`, onClick: () => openHistory(g) }, icon('bi-clock-history')),
      h('button', { type: 'button', class: 'cf-icon-btn', title: '編輯', 'aria-label': `編輯「${g.name}」`, onClick: () => openGoalForm(g) }, icon('bi-pencil')),
      g.status === 'active'
        ? [
            h('button', { type: 'button', class: 'cf-icon-btn', title: '標記為已完成', 'aria-label': `把「${g.name}」標記為已完成`, onClick: () => setStatus('completed', `已將「${g.name}」標記為已完成`) }, icon('bi-check2-circle')),
            h('button', { type: 'button', class: 'cf-icon-btn', title: '封存', 'aria-label': `封存「${g.name}」`, onClick: () => setStatus('archived', `已封存「${g.name}」`) }, icon('bi-archive')),
          ]
        : null,
      count === 0 ? h('button', { type: 'button', class: 'cf-icon-btn cf-icon-btn-danger', title: '刪除', 'aria-label': `刪除「${g.name}」`, onClick: remove }, icon('bi-trash')) : null,
    ),
  );
}

function openGoalForm(goal) {
  const ds = app.dataset;
  const name = textInput(goal?.name ?? '', { maxlength: 40, placeholder: '例如：購屋頭期款' });
  const target = moneyInput(goal?.targetAmount ?? '');
  const date = h('input', { type: 'date', class: 'form-control', value: goal?.targetDate ?? '' });
  const accounts = sortedAccounts(ds).filter((a) => !a.archived || a.id === goal?.accountId);
  const account = selectEl([{ value: '', label: '不指定' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))], goal?.accountId ?? '');
  const own = segmented([{ value: 'shared', label: '共同' }, { value: 'personal', label: '個人' }], goal?.ownershipType ?? 'shared', { label: '歸屬', onChange: () => sync() });
  const owner = selectEl(orderedMembers(ds).map((m) => ({ value: m.id, label: m.name })), goal?.ownerMemberId ?? MEMBER_SELF);
  let iconValue = goal?.icon ?? GOAL_ICONS[0];
  const iconButtons = GOAL_ICONS.map((ic) => h('button', { type: 'button', class: { 'cf-icon-pick': true, 'cf-icon-pick-active': ic === iconValue }, 'aria-label': `圖示 ${ic.replace('bi-', '')}`, 'aria-pressed': String(ic === iconValue), onClick: (e) => {
    iconValue = ic;
    for (const b of iconButtons) {
      b.classList.toggle('cf-icon-pick-active', b === e.currentTarget);
      b.setAttribute('aria-pressed', String(b === e.currentTarget));
    }
  } }, icon(ic)));
  const note = textInput(goal?.note ?? '', { maxlength: 200 });
  const f = {
    name: field('目標名稱', name),
    targetAmount: field('目標金額（元）', target),
    targetDate: field('目標日期（選填）', date, { help: '有期限才會計算每月建議' }),
    accountId: field('目標帳戶（選填）', account, { help: '設定後，撥款時可同時建立轉帳到這個帳戶' }),
    ownerMemberId: field('屬於誰', owner),
    note: field('備註', note, { className: 'cf-field-wide' }),
  };
  const ownField = h('div', { class: 'cf-field' }, h('span', { class: 'form-label' }, '歸屬'), own.el);
  const iconField = h('div', { class: 'cf-field cf-field-wide' }, h('span', { class: 'form-label' }, '圖示'), h('div', { class: 'cf-icon-picker' }, iconButtons));
  const sync = () => f.ownerMemberId.setVisible(own.value === 'personal');
  sync();
  const save = async (close) => {
    for (const x of Object.values(f)) x.setError(null);
    const amt = parseMoneyInput(target.value);
    if (!amt || amt <= 0) {
      f.targetAmount.setError('請輸入大於 0 的整數');
      toast.error('資料未儲存：目標金額必須是大於 0 的整數');
      return;
    }
    const ok = await runAction(
      () => saveGoal(app.db, goal?.id ?? null, { name: name.value, targetAmount: amt, targetDate: date.value, accountId: account.value, ownershipType: own.value, ownerMemberId: owner.value, icon: iconValue, note: note.value }),
      goal ? `已更新「${name.value.trim()}」` : `已新增儲蓄目標「${name.value.trim()}」`,
      { onError: (err) => { if (err instanceof ValidationError) for (const e of err.errors) f[e.field]?.setError(e.message); } },
    );
    if (ok) close();
  };
  const { el, close } = openDialog({
    title: goal ? `編輯：${goal.name}` : '新增儲蓄目標',
    body: h('div', { class: 'cf-form-grid' }, f.name.el, f.targetAmount.el, f.targetDate.el, f.accountId.el, ownField, f.ownerMemberId.el, iconField, f.note.el),
    actions: [{ label: '取消', variant: 'secondary', onClick: (c) => c() }, { label: '儲存', variant: 'primary', onClick: save }],
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      save(close);
    }
  });
  name.focus();
}

function openContributionForm(goal, direction) {
  const ds = app.dataset;
  const p = goalProgress(ds, goal, today());
  const amount = moneyInput(direction === 'in' && p.monthlySuggestion ? p.monthlySuggestion : '');
  const date = h('input', { type: 'date', class: 'form-control', value: today() });
  const member = selectEl(orderedMembers(ds).map((m) => ({ value: m.id, label: m.name })), goal.ownerMemberId ?? MEMBER_SELF);
  const accounts = sortedAccounts(ds).filter((a) => !a.archived && a.id !== goal.accountId);
  const withTransfer = h('input', { type: 'checkbox', class: 'form-check-input', id: 'cf-contrib-transfer', checked: Boolean(goal.accountId), disabled: !goal.accountId });
  const from = selectEl(accounts.map((a) => ({ value: a.id, label: a.name })), accounts[0]?.id ?? '');
  const note = textInput('', { maxlength: 200 });
  const f = {
    amount: field(direction === 'in' ? '撥入金額（元）' : `提回金額（元，最多 ${formatMoney(p.saved)}）`, amount),
    date: field('日期', date),
    memberId: field('操作人', member),
    fromAccountId: field('轉出帳戶', from),
    note: field('備註', note, { className: 'cf-field-wide' }),
  };
  const sync = () => f.fromAccountId.setVisible(direction === 'in' && withTransfer.checked);
  withTransfer.addEventListener('change', sync);
  const body = h('div', { class: 'cf-form-stack' },
    h('p', { class: 'cf-help-text' }, `「${goal.name}」已累積 ${formatMoney(p.saved)}，還差 ${formatMoney(p.remaining)}${p.monthlySuggestion ? `，每月建議 ${formatMoney(p.monthlySuggestion)}` : ''}。`),
    direction === 'in'
      ? h('div', { class: 'form-check cf-settle-transfer' }, withTransfer,
          h('label', { class: 'form-check-label', htmlFor: 'cf-contrib-transfer' }, goal.accountId ? `同時建立轉帳到「${accountName(ds, goal.accountId)}」（實際把錢轉過去時勾選）` : '這個目標沒有設定目標帳戶，只會記錄撥款標記'))
      : notice('info', '提回只會減少這個目標的累積金額，不會建立轉帳。'),
    h('div', { class: 'cf-form-grid' }, Object.values(f).map((x) => x.el)),
  );
  sync();
  const save = async (close) => {
    for (const x of Object.values(f)) x.setError(null);
    const amt = parseMoneyInput(amount.value);
    if (!amt || amt <= 0) {
      f.amount.setError('請輸入大於 0 的整數');
      toast.error('資料未儲存：金額必須是大於 0 的整數');
      return;
    }
    const transfer = direction === 'in' && withTransfer.checked;
    const ok = await runAction(
      () => addContribution(app.db, { goalId: goal.id, date: date.value, amount: amt, direction, memberId: member.value, fromAccountId: transfer ? from.value : null, note: note.value }),
      direction === 'in' ? `已撥入 ${formatMoney(amt)}${transfer ? '，並建立轉帳' : '（只記錄標記）'}` : `已提回 ${formatMoney(amt)}`,
    );
    if (ok) close();
  };
  const { el, close } = openDialog({
    title: `${direction === 'in' ? '撥款到' : '從目標提回'}：${goal.name}`,
    body,
    actions: [{ label: '取消', variant: 'secondary', onClick: (c) => c() }, { label: direction === 'in' ? '撥款' : '提回', variant: 'primary', onClick: save }],
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
      e.preventDefault();
      save(close);
    }
  });
  amount.focus();
}

function openHistory(goal) {
  const ds = app.dataset;
  const list = ds.savingsContributions.filter((c) => c.goalId === goal.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const body = list.length
    ? h('ul', { class: 'cf-contrib-list' }, list.map((c) => {
        const remove = async () => {
          const ok = await confirmDialog({ title: '刪除撥款紀錄', message: `確定要刪除 ${c.date} 的${c.amount > 0 ? '撥入' : '提回'} ${formatMoney(Math.abs(c.amount))}嗎？${c.transferTransactionId ? '當時建立的轉帳也會一併刪除。' : ''}`, confirmLabel: '刪除', danger: true });
          if (ok && (await runAction(() => deleteContribution(app.db, c.id), '已刪除撥款紀錄'))) close();
        };
        return h('li', { class: 'cf-contrib-item' },
          h('span', { class: { 'cf-contrib-amount': true, 'cf-contrib-out': c.amount < 0 } }, `${c.amount > 0 ? '+' : '−'}${formatMoney(Math.abs(c.amount))}`),
          h('span', { class: 'cf-contrib-main' },
            h('span', null, `${c.date.replaceAll('-', '/')} · ${memberName(ds, c.memberId)}`),
            h('span', { class: 'cf-help-text' }, [c.transferTransactionId ? `已轉帳：${accountName(ds, c.fromAccountId)} → ${accountName(ds, goal.accountId)}` : c.amount > 0 ? '只記錄標記' : '提回', c.note].filter(Boolean).join(' · ')),
          ),
          h('button', { type: 'button', class: 'cf-icon-btn cf-icon-btn-danger', title: '刪除', 'aria-label': `刪除 ${c.date} 撥款紀錄`, onClick: remove }, icon('bi-trash')),
        );
      }))
    : h('div', { class: 'cf-empty' }, h('p', null, '還沒有撥款紀錄'));
  const { close } = openDialog({ title: `撥款紀錄：${goal.name}`, body, actions: [{ label: '關閉', variant: 'secondary', onClick: (c) => c() }] });
}

