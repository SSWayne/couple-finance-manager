/** 帳戶管理：資產／負債／淨資產、帳戶卡片、新增／編輯／停用／刪除。 */
import { h, icon } from '../ui/h.js';
import { pageHeader, panel, notice, statusPill } from '../ui/components.js';
import { field, moneyInput, segmented, selectEl, textInput } from '../ui/form.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { runAction, toast } from '../ui/toast.js';
import { ValidationError } from '../data/validate.js';
import { ENUMS } from '../data/schema.js';
import { app } from '../app/state.js';
import { netWorth } from '../domain/balances.js';
import { ACCOUNT_TYPE_ICON, accountTypeLabel, memberName, orderedMembers, sortedAccounts } from '../domain/lookup.js';
import { createAccount, deleteAccount, setAccountArchived, updateAccount } from '../domain/accountService.js';
import { setTransactionFilter } from './transactions.js';
import { formatMoney, parseMoneyInput } from '../lib/money.js';
import { MEMBER_SELF } from '../domain/split.js';

const view = { showArchived: false };

export function render(ctx) {
  const ds = ctx.dataset;
  const { assets, liabilities, net, balances } = netWorth(ds);
  const txCount = new Map();
  for (const t of ds.transactions) {
    txCount.set(t.accountId, (txCount.get(t.accountId) ?? 0) + 1);
    if (t.toAccountId) txCount.set(t.toAccountId, (txCount.get(t.toAccountId) ?? 0) + 1);
  }
  const accounts = sortedAccounts(ds).filter((a) => view.showArchived || !a.archived);
  const archivedCount = ds.accounts.filter((a) => a.archived).length;

  return h('div', { class: 'cf-page cf-accounts-page' },
    pageHeader('帳戶管理', '餘額＝期初餘額＋所有交易推算，不另外儲存',
      h('button', { type: 'button', class: 'btn cf-btn-dark', onClick: () => openAccountForm() }, icon('bi-plus-lg'), ' 新增帳戶'),
    ),
    h('div', { class: 'cf-networth-row' },
      statCard('家庭淨資產', net, 'bi-safe2', 'cf-networth-card-main'),
      statCard('資產', assets, 'bi-arrow-up-right'),
      statCard('負債', liabilities, 'bi-credit-card', '', '信用卡等負餘額'),
    ),
    panel(
      {
        title: '所有帳戶',
        subtitle: `${ds.accounts.length - archivedCount} 個使用中${archivedCount ? `、${archivedCount} 個已停用` : ''}`,
        actions: archivedCount
          ? h('div', { class: 'form-check form-switch cf-accounts-toggle' },
              h('input', { class: 'form-check-input', type: 'checkbox', id: 'cf-show-archived-accounts', checked: view.showArchived, onChange: (e) => { view.showArchived = e.target.checked; ctx.rerender(); } }),
              h('label', { class: 'form-check-label', htmlFor: 'cf-show-archived-accounts' }, '顯示已停用'))
          : null,
      },
      accounts.length
        ? h('div', { class: 'cf-account-grid' }, accounts.map((a) => accountCard(ds, a, balances.get(a.id) ?? 0, txCount.get(a.id) ?? 0, ctx)))
        : h('div', { class: 'cf-empty' }, icon('bi-wallet2'), h('p', null, '還沒有帳戶。新增一個銀行帳戶、現金或信用卡開始記帳。')),
      notice('info',
        h('p', null, '信用卡以負餘額表示欠款：刷卡記成「支出」，繳卡費請記成從銀行「轉帳」到信用卡（不會重複算支出）。'),
        h('p', null, '有交易的帳戶不能刪除，請改用「停用」：舊紀錄保留，新交易不能再選它。'),
      ),
    ),
  );
}

function statCard(label, value, ic, extra = '', note = '') {
  return h('div', { class: `cf-networth-card ${extra}`.trim() },
    h('span', { class: 'cf-networth-card-icon' }, icon(ic)),
    h('span', { class: 'cf-networth-card-label' }, label),
    h('span', { class: 'cf-networth-card-value' }, formatMoney(value)),
    note ? h('span', { class: 'cf-networth-card-note' }, note) : null,
  );
}

function accountCard(ds, a, balance, count, ctx) {
  const owner = a.ownershipType === 'shared' ? '共同' : `${memberName(ds, a.ownerMemberId)}個人`;
  const showTx = () => {
    setTransactionFilter({ accountId: a.id });
    ctx.navigate('transactions');
  };
  const toggle = () => runAction(() => setAccountArchived(app.db, a.id, !a.archived), a.archived ? `已重新啟用「${a.name}」` : `已停用「${a.name}」`);
  const remove = async () => {
    const ok = await confirmDialog({ title: '刪除帳戶', message: `確定要刪除「${a.name}」嗎？刪除後無法復原。`, confirmLabel: '刪除', danger: true });
    if (ok) await runAction(() => deleteAccount(app.db, a.id), `已刪除帳戶「${a.name}」`);
  };
  return h('article', { class: { 'cf-account-card': true, 'cf-account-card-archived': a.archived, 'cf-account-card-credit': a.type === 'credit_card' } },
    h('div', { class: 'cf-account-card-head' },
      h('span', { class: 'cf-account-card-icon' }, icon(ACCOUNT_TYPE_ICON[a.type] ?? 'bi-wallet2')),
      h('div', { class: 'cf-account-card-titles' },
        h('h3', { class: 'cf-account-card-name' }, a.name),
        h('span', { class: 'cf-account-card-type' }, `${accountTypeLabel(a.type)} · ${owner}`),
      ),
      a.archived ? statusPill('muted', '已停用') : null,
    ),
    h('div', { class: 'cf-account-card-balance' },
      h('span', { class: { 'cf-account-card-amount': true, 'cf-amount-expense': balance < 0 } }, formatMoney(balance)),
      balance < 0 ? h('span', { class: 'cf-account-card-debt' }, a.type === 'credit_card' ? '尚未繳的卡費' : '負餘額（負債）') : null,
    ),
    h('div', { class: 'cf-account-card-meta' }, `期初 ${formatMoney(a.openingBalance)} · ${count} 筆交易`),
    a.note ? h('p', { class: 'cf-account-card-note' }, a.note) : null,
    h('div', { class: 'cf-account-card-actions' },
      h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: showTx }, icon('bi-list-ul'), ' 明細'),
      h('button', { type: 'button', class: 'cf-icon-btn', title: '編輯', 'aria-label': `編輯「${a.name}」`, onClick: () => openAccountForm(a) }, icon('bi-pencil')),
      h('button', { type: 'button', class: 'cf-icon-btn', title: a.archived ? '重新啟用' : '停用', 'aria-label': `${a.archived ? '重新啟用' : '停用'}「${a.name}」`, onClick: toggle }, icon(a.archived ? 'bi-arrow-counterclockwise' : 'bi-pause-circle')),
      count === 0
        ? h('button', { type: 'button', class: 'cf-icon-btn cf-icon-btn-danger', title: '刪除', 'aria-label': `刪除「${a.name}」`, onClick: remove }, icon('bi-trash'))
        : null,
    ),
  );
}

export function openAccountForm(account = null) {
  const ds = app.dataset;
  const members = orderedMembers(ds);
  const a = account ?? { name: '', type: 'bank', ownershipType: 'shared', ownerMemberId: MEMBER_SELF, openingBalance: 0, openingDate: null, note: '' };
  const nameInput = textInput(a.name, { maxlength: 40, placeholder: '例如：共同生活帳戶', required: true });
  const typeSel = selectEl(Object.entries(ENUMS.accountType).map(([value, label]) => ({ value, label })), a.type);
  const ownSeg = segmented([{ value: 'shared', label: '共同' }, { value: 'personal', label: '個人' }], a.ownershipType, { label: '歸屬', onChange: () => sync() });
  const ownerSel = selectEl(members.map((m) => ({ value: m.id, label: m.name })), a.ownerMemberId ?? MEMBER_SELF);
  const openingInput = moneyInput(a.openingBalance, { 'aria-describedby': 'cf-opening-help' });
  const openingDate = h('input', { type: 'date', class: 'form-control', value: a.openingDate ?? '' });
  const noteInput = textInput(a.note, { maxlength: 200 });

  const f = {
    name: field('帳戶名稱', nameInput),
    type: field('類型', typeSel),
    ownerMemberId: field('擁有者', ownerSel),
    openingBalance: field('期初餘額（元）', openingInput, { help: '開始記帳前的餘額。信用卡若已有未繳卡費，請輸入負數（例如 -3500）。' }),
    openingDate: field('期初日期（選填）', openingDate),
    note: field('備註', noteInput, { className: 'cf-field-wide' }),
  };
  const ownField = h('div', { class: 'cf-field' }, h('span', { class: 'form-label' }, '歸屬'), ownSeg.el);
  const sync = () => f.ownerMemberId.setVisible(ownSeg.value === 'personal');

  const body = h('div', { class: 'cf-form-grid' }, f.name.el, f.type.el, ownField, f.ownerMemberId.el, f.openingBalance.el, f.openingDate.el, f.note.el);
  sync();

  const save = async (close) => {
    for (const x of Object.values(f)) x.setError(null);
    const openingBalance = parseMoneyInput(openingInput.value.trim() === '' ? '0' : openingInput.value);
    if (openingBalance === null) {
      f.openingBalance.setError('請輸入整數金額（可為負數）');
      toast.error('資料未儲存：期初餘額必須是整數');
      return;
    }
    const input = { name: nameInput.value, type: typeSel.value, ownershipType: ownSeg.value, ownerMemberId: ownerSel.value, openingBalance, openingDate: openingDate.value, note: noteInput.value };
    const ok = await runAction(
      () => (account ? updateAccount(app.db, account.id, input) : createAccount(app.db, input)),
      account ? `已更新帳戶「${input.name.trim()}」` : `已新增帳戶「${input.name.trim()}」`,
      {
        onError: (err) => {
          if (err instanceof ValidationError) for (const e of err.errors) f[e.field]?.setError(e.message);
        },
      },
    );
    if (ok) close();
  };
  const { el, close } = openDialog({
    title: account ? '編輯帳戶' : '新增帳戶',
    body,
    actions: [
      { label: '取消', variant: 'secondary', onClick: (c) => c() },
      { label: '儲存', variant: 'primary', onClick: save },
    ],
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      save(close);
    }
  });
  nameInput.focus();
}
