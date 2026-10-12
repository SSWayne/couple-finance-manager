/** 雙人財務：每月兩人收支與負擔、未結算代墊、結算與撤銷結算、結算紀錄。 */
import { h, icon, mount } from '../ui/h.js';
import { pageHeader, panel, notice, statusPill } from '../ui/components.js';
import { field, selectEl, textInput } from '../ui/form.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { runAction } from '../ui/toast.js';
import { app } from '../app/state.js';
import { accountName, categoryLabel, memberName, orderedMembers, sortedAccounts } from '../domain/lookup.js';
import { advanceSummary, createSettlement, revokeSettlement, unsettledTransactions } from '../domain/settlementService.js';
import { computeAdvance, memberBurden, netAdvances } from '../domain/split.js';
import { formatMoney } from '../lib/money.js';
import { currentMonth, today, daysInMonth } from '../lib/date.js';

const view = { month: currentMonth() };

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  return [`${month}-01`, `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`];
}

/** 某月兩人的收支摘要。家庭總支出每筆只算一次。 */
export function monthlyCoupleSummary(ds, month) {
  const [from, to] = monthRange(month);
  const members = orderedMembers(ds);
  const per = Object.fromEntries(members.map((m) => [m.id, { income: 0, paid: 0, burden: 0, advanced: 0 }]));
  let householdExpense = 0;
  let sharedExpense = 0;
  let sharedIncome = 0;
  for (const t of ds.transactions) {
    if (t.date < from || t.date > to) continue;
    if (t.type === 'income') {
      if (t.ownershipType === 'personal') per[t.ownerMemberId].income += t.amount;
      else sharedIncome += t.amount;
    } else if (t.type === 'expense') {
      householdExpense += t.amount;
      if (t.ownershipType === 'shared') sharedExpense += t.amount;
      per[t.memberId].paid += t.amount;
      for (const m of members) per[m.id].burden += memberBurden(t, m.id);
      const adv = computeAdvance(t);
      if (adv) per[adv.creditorId].advanced += adv.amount;
    }
  }
  return { per, householdExpense, sharedExpense, sharedIncome };
}

export function render(ctx) {
  const ds = ctx.dataset;
  const members = orderedMembers(ds);
  const sum = monthlyCoupleSummary(ds, view.month);
  const adv = advanceSummary(ds);

  const monthInput = h('input', { type: 'month', class: 'form-control cf-month-input', value: view.month, 'aria-label': '選擇月份', onChange: (e) => { if (e.target.value) { view.month = e.target.value; ctx.rerender(); } } });

  return h('div', { class: 'cf-page cf-couple-page' },
    pageHeader('雙人財務', '兩人各自的收支、負擔與代墊', monthInput),
    h('div', { class: 'cf-couple-grid' },
      members.map((m, i) => memberCard(m, sum.per[m.id], i)),
      h('section', { class: 'cf-couple-household' },
        h('span', { class: 'cf-couple-household-label' }, `${view.month.replace('-', ' 年 ')} 月家庭總支出`),
        h('span', { class: 'cf-couple-household-value' }, formatMoney(sum.householdExpense)),
        h('dl', { class: 'cf-kv-list cf-kv-list-compact' },
          h('div', null, h('dt', null, '其中共同支出'), h('dd', null, formatMoney(sum.sharedExpense))),
          h('div', null, h('dt', null, '共同收入'), h('dd', null, formatMoney(sum.sharedIncome))),
        ),
        h('p', { class: 'cf-help-text' }, '每筆支出只算一次；分攤只影響「實際負擔」。'),
      ),
    ),
    advancePanel(ds, adv),
    historyPanel(ds),
  );

  function memberCard(m, s, i) {
    return h('section', { class: 'cf-couple-member' },
      h('div', { class: 'cf-couple-member-head' },
        h('span', { class: `cf-avatar cf-avatar-${i === 0 ? 'self' : 'partner'}` }, [...m.name][0] ?? '?'),
        h('div', null, h('h2', { class: 'cf-couple-member-name' }, m.name), h('span', { class: 'cf-help-text' }, i === 0 ? '我' : '另一半')),
      ),
      h('dl', { class: 'cf-couple-member-stats' },
        stat('個人收入', s.income),
        stat('實際付款', s.paid, '從自己付的支出合計'),
        stat('實際負擔', s.burden, '個人支出＋共同支出分攤'),
        stat('替對方代墊', s.advanced, '本月新增（含已結算）'),
      ),
    );
  }
}

function stat(label, value, hint) {
  return h('div', { class: 'cf-couple-stat' },
    h('dt', null, label),
    h('dd', null, formatMoney(value)),
    hint ? h('span', { class: 'cf-couple-stat-hint' }, hint) : null,
  );
}

function advancePanel(ds, adv) {
  const { net, transactions, paidFor } = adv;
  const members = orderedMembers(ds);
  const headline = transactions.length === 0
    ? h('p', { class: 'cf-advance-headline' }, icon('bi-check2-circle'), ' 目前沒有未結算的代墊')
    : net.amount === 0
      ? h('p', { class: 'cf-advance-headline' }, '互相抵銷後剛好打平，結算金額為 $0')
      : h('p', { class: 'cf-advance-headline' },
          h('strong', null, memberName(ds, net.fromMemberId)), ' 應付 ', h('strong', null, memberName(ds, net.toMemberId)), ' ',
          h('span', { class: 'cf-advance-amount' }, formatMoney(net.amount)));

  return panel(
    {
      title: '未結算代墊',
      subtitle: '所有未結算的代墊互相抵銷後，一次結清淨額',
      actions: transactions.length ? h('button', { type: 'button', class: 'btn cf-btn-lime', onClick: () => openSettleDialog() }, icon('bi-check2-all'), ' 結算') : null,
    },
    headline,
    transactions.length
      ? h('div', { class: 'cf-advance-split' }, members.map((m) => h('span', null, `${m.name}替對方墊了 `, h('strong', null, formatMoney(paidFor[m.id] ?? 0)))))
      : null,
    transactions.length
      ? h('ul', { class: 'cf-advance-list' },
          transactions.map((t) => {
            const a = computeAdvance(t);
            return h('li', { class: 'cf-advance-item' },
              h('span', { class: 'cf-advance-item-date' }, t.date.slice(5).replace('-', '/')),
              h('span', { class: 'cf-advance-item-title' }, t.description || categoryLabel(ds, t), h('span', { class: 'cf-help-text' }, ` · ${t.ownershipType === 'personal' ? '對方個人支出（全額代墊）' : '共同支出分攤'}`)),
              h('span', { class: 'cf-advance-item-dir' }, `${memberName(ds, a.debtorId)} 欠 ${memberName(ds, a.creditorId)}`),
              h('span', { class: 'cf-advance-item-amount' }, formatMoney(a.amount)),
            );
          }))
      : null,
  );
}

function historyPanel(ds) {
  const list = [...ds.settlements].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return panel({ title: '結算紀錄', subtitle: '撤銷結算會解除交易鎖定，並刪除當次建立的結算轉帳' },
    list.length
      ? h('ul', { class: 'cf-settle-list' }, list.map((s) => {
          const revoke = async () => {
            const ok = await confirmDialog({
              title: '撤銷結算',
              message: `撤銷 ${s.date} 的結算（${formatMoney(s.amount)}）？${s.transactionIds.length} 筆交易會回到未結算狀態${s.transferTransactionId ? '，並刪除這次建立的結算轉帳' : ''}。`,
              confirmLabel: '撤銷結算',
              danger: true,
            });
            if (ok) await runAction(() => revokeSettlement(app.db, s.id), '已撤銷結算');
          };
          return h('li', { class: 'cf-settle-item' },
            h('div', { class: 'cf-settle-item-main' },
              h('span', { class: 'cf-settle-item-title' }, s.amount ? `${memberName(ds, s.fromMemberId)} → ${memberName(ds, s.toMemberId)} ${formatMoney(s.amount)}` : '互相抵銷 $0'),
              h('span', { class: 'cf-help-text' }, `${s.date.replaceAll('-', '/')} · ${s.transactionIds.length} 筆交易${s.note ? ` · ${s.note}` : ''}`),
            ),
            s.transferTransactionId
              ? statusPill('ok', `已建立轉帳：${accountName(ds, ds.transactions.find((t) => t.id === s.transferTransactionId)?.accountId)} → ${accountName(ds, ds.transactions.find((t) => t.id === s.transferTransactionId)?.toAccountId)}`)
              : statusPill('muted', '未建立轉帳'),
            h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: revoke }, icon('bi-arrow-counterclockwise'), ' 撤銷'),
          );
        }))
      : h('div', { class: 'cf-empty' }, icon('bi-journal-check'), h('p', null, '還沒有結算紀錄')),
  );
}

function openSettleDialog() {
  const ds = app.dataset;
  const dateInput = h('input', { type: 'date', class: 'form-control', value: today(), max: '2200-12-31' });
  const createTransfer = h('input', { type: 'checkbox', class: 'form-check-input', id: 'cf-settle-transfer', checked: true });
  const accounts = sortedAccounts(ds).filter((a) => !a.archived);
  const fromSel = selectEl([], '');
  const toSel = selectEl([], '');
  const noteInput = textInput('', { maxlength: 200, placeholder: '例如：十月結算' });
  const info = h('div', { class: 'cf-settle-preview', 'aria-live': 'polite' });
  const fromField = field('轉出帳戶（付款方）', fromSel);
  const toField = field('轉入帳戶（收款方）', toSel);
  let current = null;

  const accountOpts = (memberId) => {
    const own = accounts.filter((a) => a.ownershipType === 'personal' && a.ownerMemberId === memberId);
    const shared = accounts.filter((a) => a.ownershipType === 'shared');
    const others = accounts.filter((a) => !own.includes(a) && !shared.includes(a));
    return [
      own.length ? { group: `${memberName(ds, memberId)}的帳戶`, options: own.map((a) => ({ value: a.id, label: a.name })) } : null,
      shared.length ? { group: '共同帳戶', options: shared.map((a) => ({ value: a.id, label: a.name })) } : null,
      others.length ? { group: '其他帳戶', options: others.map((a) => ({ value: a.id, label: a.name })) } : null,
    ].filter(Boolean);
  };

  function update() {
    const txs = unsettledTransactions(ds, dateInput.value || null);
    current = { txs, net: netAdvances(txs) };
    const { net } = current;
    mount(info,
      txs.length
        ? h('p', null, `將結算 ${dateInput.value || '—'} 以前的 ${txs.length} 筆代墊：`, net.amount
            ? h('strong', null, `${memberName(ds, net.fromMemberId)} 付給 ${memberName(ds, net.toMemberId)} ${formatMoney(net.amount)}`)
            : h('strong', null, '互相抵銷為 $0'))
        : notice('warning', '這個日期以前沒有未結算的代墊。'),
    );
    const needTransfer = net.amount > 0 && txs.length;
    createTransfer.disabled = !needTransfer;
    const wrap = createTransfer.closest('.cf-settle-transfer');
    if (wrap) wrap.hidden = !needTransfer;
    const showAccounts = needTransfer && createTransfer.checked;
    fromField.setVisible(showAccounts);
    toField.setVisible(showAccounts);
    if (needTransfer) {
      const fromOpts = accountOpts(net.fromMemberId);
      const toOpts = accountOpts(net.toMemberId);
      const prevFrom = fromSel.value;
      const prevTo = toSel.value;
      mount(fromSel, ...fromOpts.map((g) => h('optgroup', { label: g.group }, g.options.map((o) => h('option', { value: o.value }, o.label)))));
      mount(toSel, ...toOpts.map((g) => h('optgroup', { label: g.group }, g.options.map((o) => h('option', { value: o.value }, o.label)))));
      if ([...fromSel.options].some((o) => o.value === prevFrom)) fromSel.value = prevFrom;
      if ([...toSel.options].some((o) => o.value === prevTo)) toSel.value = prevTo;
      else if (toSel.options.length > 1 && toSel.value === fromSel.value) toSel.selectedIndex = 1;
    }
  }

  dateInput.addEventListener('change', update);
  createTransfer.addEventListener('change', update);

  const body = h('div', { class: 'cf-form-stack' },
    field('結算日期', dateInput).el,
    info,
    h('div', { class: 'form-check cf-settle-transfer' },
      createTransfer,
      h('label', { class: 'form-check-label', htmlFor: 'cf-settle-transfer' }, '同時建立結算轉帳（實際把錢轉給對方時勾選）'),
    ),
    h('div', { class: 'cf-form-grid' }, fromField.el, toField.el),
    field('備註', noteInput).el,
    h('p', { class: 'cf-help-text' }, '結算後這些交易的類型、金額、付款人、歸屬與分攤會鎖定；之後若要修改，請先撤銷結算。'),
  );

  openDialog({
    title: '結算代墊',
    body,
    actions: [
      { label: '取消', variant: 'secondary', onClick: (c) => c() },
      {
        label: '確認結算',
        variant: 'primary',
        onClick: async (close) => {
          const transfer = createTransfer.checked && !createTransfer.disabled;
          const ok = await runAction(
            () => createSettlement(app.db, { date: dateInput.value, createTransfer: transfer, fromAccountId: fromSel.value, toAccountId: toSel.value, note: noteInput.value }),
            current?.net.amount ? `已結算 ${formatMoney(current.net.amount)}${transfer ? '，並建立結算轉帳' : ''}` : '已結算（互相抵銷為 $0）',
          );
          if (ok) close();
        },
      },
    ],
  });
  update();
}
