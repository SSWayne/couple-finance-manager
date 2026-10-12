/** 婚禮基金：專案、婚禮項目（規劃層）、禮金（可入帳並與交易雙向連動）。 */
import { h, icon } from '../ui/h.js';
import { pageHeader, panel, notice, statusPill } from '../ui/components.js';
import { field, moneyInput, selectEl, textInput } from '../ui/form.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { runAction, toast } from '../ui/toast.js';
import { downloadText } from '../ui/download.js';
import { ValidationError } from '../data/validate.js';
import { ENUMS } from '../data/schema.js';
import { app } from '../app/state.js';
import { openTransactionForm } from './transactionForm.js';
import { setTransactionFilter } from './transactions.js';
import { weddingSummary, DEFAULT_WEDDING_ITEMS } from '../domain/wedding.js';
import { deleteWeddingGift, deleteWeddingItem, deleteWeddingProject, saveWeddingGift, saveWeddingItem, saveWeddingProject } from '../domain/weddingService.js';
import { accountName, sortedAccounts } from '../domain/lookup.js';
import { formatMoney, parseMoneyInput } from '../lib/money.js';
import { diffDays, fileTimestamp, today } from '../lib/date.js';
import { toCsv } from '../lib/csv.js';

const markErrors = (f) => (err) => {
  if (err instanceof ValidationError) for (const e of err.errors) f[e.field]?.setError(e.message);
};

function submitOnEnter(el, save, close) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      save(close);
    }
  });
}

/** 金額欄位：空白視為 null（allowEmpty）或 0。 */
function readMoney(input, { allowEmpty = false } = {}) {
  const v = input.value.trim();
  if (v === '') return allowEmpty ? null : 0;
  return parseMoneyInput(v);
}

export function render(ctx) {
  const ds = ctx.dataset;
  if (!ds.weddingProject) return emptyState();
  const s = weddingSummary(ds);
  const p = s.project;
  const days = p.weddingDate ? diffDays(today(), p.weddingDate) : null;
  const countdown = days === null ? '尚未設定婚禮日期' : days > 0 ? `${p.weddingDate.replaceAll('-', '/')} · 還有 ${days} 天` : days === 0 ? '就是今天！' : `${p.weddingDate.replaceAll('-', '/')} · 已過 ${-days} 天`;

  const removeProject = async () => {
    const ok = await confirmDialog({ title: '刪除婚禮專案', message: `刪除「${p.name}」會一併刪除所有婚禮項目與禮金紀錄（無法復原）。已入帳的禮金或有關聯交易時會被擋下，不會刪到家庭帳本。確定要刪除嗎？`, confirmLabel: '刪除專案', danger: true });
    if (ok) await runAction(() => deleteWeddingProject(app.db), '已刪除婚禮專案');
  };

  const ratio = s.budget ? s.totalCost / s.budget : 0;
  const level = !s.budget ? 'ok' : ratio > 1 ? 'over' : ratio >= 0.8 ? 'warning' : 'ok';

  return h('div', { class: 'cf-page cf-wedding-page' },
    pageHeader(p.name, countdown,
      h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: () => openProjectForm(p) }, icon('bi-pencil'), ' 編輯專案'),
      h('button', { type: 'button', class: 'btn cf-btn-ghost cf-btn-danger-ghost', onClick: removeProject }, icon('bi-trash'), ' 刪除'),
    ),
    h('div', { class: 'cf-wedding-stats' },
      stat('總預算', s.budget, 'bi-bullseye', s.budget ? `剩餘 ${formatMoney(s.budgetRemaining)}` : '未設定'),
      stat('總費用', s.totalCost, 'bi-receipt', '實際金額，無則用預估'),
      stat('已付款', s.totalPaid, 'bi-check2-circle', `含未入帳 ${formatMoney(s.totalManual)}`),
      stat('尚未付款', s.totalUnpaid, 'bi-hourglass-split'),
      stat('禮金', s.totalGifts, 'bi-gift', `${s.gifts.length} 筆`),
      stat('淨支出', s.netExpense, 'bi-calculator', '總費用 − 禮金', 'cf-wedding-stat-main'),
    ),
    s.budget
      ? panel({ title: '預算使用', subtitle: `總費用 ${formatMoney(s.totalCost)} / 總預算 ${formatMoney(s.budget)}` },
          h('div', { class: `cf-progress cf-progress-${level}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(ratio * 100), 'aria-label': '婚禮預算使用率' },
            h('span', { class: 'cf-progress-fill', style: { width: `${Math.min(100, ratio * 100)}%` } })),
          level !== 'ok' ? notice(level === 'over' ? 'danger' : 'warning', level === 'over' ? `總費用已超過預算 ${formatMoney(-s.budgetRemaining)}` : `總費用已達預算的 ${Math.round(ratio * 100)}%`) : null,
        )
      : null,
    itemsPanel(s, ctx),
    giftsPanel(s, ds),
    panel({ title: '說明' },
      h('ul', { class: 'cf-info-list' },
        h('li', null, '婚禮項目是「規劃」，不是交易：只有你實際記帳的支出才會進入家庭帳本與收支統計。'),
        h('li', null, '已付款＝手動記錄的金額（未入家庭帳本，例如長輩代付）＋關聯到此項目的交易。'),
        h('li', null, '費用以「實際金額」為準，沒有填就用「預估金額」；淨支出＝總費用 − 禮金。'),
        h('li', null, '禮金選擇入帳帳戶時，會自動建立一筆「禮金」收入交易；修改或刪除禮金會同步更新那筆交易。'),
      ),
    ),
  );
}

function stat(label, value, ic, note, extra = '') {
  return h('div', { class: `cf-wedding-stat ${extra}`.trim() },
    h('span', { class: 'cf-wedding-stat-icon' }, icon(ic)),
    h('span', { class: 'cf-wedding-stat-label' }, label),
    h('span', { class: { 'cf-wedding-stat-value': true, 'cf-dash-negative': value < 0 } }, formatMoney(value)),
    note ? h('span', { class: 'cf-wedding-stat-note' }, note) : null,
  );
}

function emptyState() {
  return h('div', { class: 'cf-page cf-wedding-page' },
    pageHeader('婚禮基金', '規劃婚禮預算、追蹤付款與禮金'),
    panel({ title: '建立婚禮專案' },
      h('p', null, `建立後會自動產生 ${DEFAULT_WEDDING_ITEMS.length} 個常見項目（${DEFAULT_WEDDING_ITEMS.join('、')}），金額都是 0，可以再修改、刪除或新增。`),
      h('button', { type: 'button', class: 'btn cf-btn-dark cf-wedding-create', onClick: () => openProjectForm(null) }, icon('bi-heart'), ' 建立婚禮專案'),
    ),
  );
}

function openProjectForm(project) {
  const nameInput = textInput(project?.name ?? '我們的婚禮', { maxlength: 40 });
  const dateInput = h('input', { type: 'date', class: 'form-control', value: project?.weddingDate ?? '' });
  const budgetInput = moneyInput(project?.totalBudget ?? '');
  const noteInput = textInput(project?.note ?? '', { maxlength: 500 });
  const f = {
    name: field('專案名稱', nameInput),
    weddingDate: field('婚禮日期（選填）', dateInput),
    totalBudget: field('總預算（元）', budgetInput, { help: '可先填 0，之後再調整' }),
    note: field('備註', noteInput, { className: 'cf-field-wide' }),
  };
  const save = async (close) => {
    for (const x of Object.values(f)) x.setError(null);
    const totalBudget = readMoney(budgetInput);
    if (totalBudget === null || totalBudget < 0) {
      f.totalBudget.setError('請輸入 0 以上的整數');
      toast.error('資料未儲存：總預算必須是 0 以上的整數');
      return;
    }
    const ok = await runAction(
      () => saveWeddingProject(app.db, { name: nameInput.value, weddingDate: dateInput.value, totalBudget, note: noteInput.value }),
      project ? '已更新婚禮專案' : `已建立婚禮專案，並新增 ${DEFAULT_WEDDING_ITEMS.length} 個預設項目`,
      { onError: markErrors(f) },
    );
    if (ok) close();
  };
  const { el, close } = openDialog({
    title: project ? '編輯婚禮專案' : '建立婚禮專案',
    body: h('div', { class: 'cf-form-grid' }, Object.values(f).map((x) => x.el)),
    actions: [{ label: '取消', variant: 'secondary', onClick: (c) => c() }, { label: project ? '儲存' : '建立', variant: 'primary', onClick: save }],
  });
  submitOnEnter(el, save, close);
  nameInput.focus();
}

// ---------------------------------------------------------------------------
// 婚禮項目
// ---------------------------------------------------------------------------
function itemsPanel(s, ctx) {
  return panel(
    {
      title: '婚禮項目',
      subtitle: `${s.items.length} 項 · 預估合計 ${formatMoney(s.totalEstimated)}`,
      actions: h('button', { type: 'button', class: 'btn cf-btn-lime', onClick: () => openItemForm(null) }, icon('bi-plus-lg'), ' 新增項目'),
    },
    s.items.length
      ? h('ul', { class: 'cf-wedding-items' }, s.items.map((x) => itemRow(x, ctx)))
      : h('div', { class: 'cf-empty' }, icon('bi-list-check'), h('p', null, '還沒有婚禮項目')),
  );
}

function itemRow(x, ctx) {
  const it = x.item;
  const ratio = x.cost ? Math.min(1, x.paid / x.cost) : x.paid ? 1 : 0;
  const pay = () => openTransactionForm({ defaults: { type: 'expense', categoryId: 'cat-exp-wedding', weddingExpenseId: it.id, amount: x.unpaid || null, description: `婚禮：${it.name}` } });
  const showTx = () => {
    setTransactionFilter({ weddingExpenseId: it.id });
    ctx.navigate('transactions');
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: '刪除婚禮項目', message: `確定要刪除「${it.name}」嗎？`, confirmLabel: '刪除', danger: true });
    if (ok) await runAction(() => deleteWeddingItem(app.db, it.id), `已刪除「${it.name}」`);
  };
  const meta = [it.vendor, it.dueDate ? `付款期限 ${it.dueDate.replaceAll('-', '/')}` : null].filter(Boolean).join(' · ');
  return h('li', { class: 'cf-wedding-item' },
    h('div', { class: 'cf-wedding-item-main' },
      h('button', { type: 'button', class: 'cf-wedding-item-name', onClick: () => openItemForm(it), title: '編輯' }, it.name),
      meta ? h('span', { class: 'cf-help-text' }, meta) : null,
      h('div', { class: `cf-progress cf-progress-${x.overpaid ? 'warning' : 'ok'} cf-wedding-item-bar`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(ratio * 100), 'aria-label': `${it.name}已付 ${Math.round(ratio * 100)}%` },
        h('span', { class: 'cf-progress-fill', style: { width: `${ratio * 100}%` } })),
    ),
    h('dl', { class: 'cf-wedding-item-nums' },
      h('div', null, h('dt', null, x.usesActual ? '實際' : '預估'), h('dd', null, formatMoney(x.cost))),
      h('div', null, h('dt', null, '已付'), h('dd', null, formatMoney(x.paid)),
        x.item.manualPaidAmount || x.txs.length
          ? h('span', { class: 'cf-wedding-item-split' }, [x.item.manualPaidAmount ? `未入帳 ${formatMoney(x.item.manualPaidAmount)}` : null, x.txs.length ? `交易 ${x.txs.length} 筆 ${formatMoney(x.linkedPaid)}` : null].filter(Boolean).join(' · '))
          : null),
      h('div', null, h('dt', null, x.overpaid ? '多付' : '未付'), h('dd', { class: { 'cf-wedding-item-overpaid': x.overpaid > 0 } }, formatMoney(x.overpaid || x.unpaid))),
    ),
    h('div', { class: 'cf-wedding-item-actions' },
      h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: pay, title: '新增一筆關聯到此項目的支出' }, icon('bi-plus-lg'), ' 記一筆付款'),
      x.txs.length ? h('button', { type: 'button', class: 'cf-icon-btn', title: '查看交易', 'aria-label': `查看「${it.name}」相關交易`, onClick: showTx }, icon('bi-list-ul')) : null,
      h('button', { type: 'button', class: 'cf-icon-btn', title: '編輯', 'aria-label': `編輯「${it.name}」`, onClick: () => openItemForm(it) }, icon('bi-pencil')),
      h('button', { type: 'button', class: 'cf-icon-btn cf-icon-btn-danger', title: '刪除', 'aria-label': `刪除「${it.name}」`, onClick: remove }, icon('bi-trash')),
    ),
  );
}

function openItemForm(item) {
  const nameInput = textInput(item?.name ?? '', { maxlength: 40 });
  const est = moneyInput(item?.estimatedAmount ?? '');
  const act = moneyInput(item?.actualAmount ?? '', { placeholder: '未確定可留空' });
  const manual = moneyInput(item?.manualPaidAmount || '');
  const manualNote = textInput(item?.manualPaidNote ?? '', { maxlength: 200, placeholder: '例如：媽媽代付' });
  const vendor = textInput(item?.vendor ?? '', { maxlength: 60 });
  const due = h('input', { type: 'date', class: 'form-control', value: item?.dueDate ?? '' });
  const note = textInput(item?.note ?? '', { maxlength: 500 });
  const f = {
    name: field('項目名稱', nameInput),
    vendor: field('廠商（選填）', vendor),
    estimatedAmount: field('預估金額（元）', est),
    actualAmount: field('實際金額（元，選填）', act, { help: '填了實際金額就以實際為準' }),
    manualPaidAmount: field('未入帳的已付款（元）', manual, { help: '不在家庭帳本的付款，例如長輩代付' }),
    manualPaidNote: field('未入帳說明', manualNote),
    dueDate: field('付款期限（選填）', due),
    note: field('備註', note),
  };
  const save = async (close) => {
    for (const x of Object.values(f)) x.setError(null);
    const values = { estimatedAmount: readMoney(est), actualAmount: readMoney(act, { allowEmpty: true }), manualPaidAmount: readMoney(manual) };
    const bad = Object.entries({ estimatedAmount: values.estimatedAmount, manualPaidAmount: values.manualPaidAmount }).find(([, v]) => v === null || v < 0);
    if (bad || (act.value.trim() && (values.actualAmount === null || values.actualAmount < 0))) {
      (bad ? f[bad[0]] : f.actualAmount).setError('請輸入 0 以上的整數');
      toast.error('資料未儲存：金額必須是 0 以上的整數');
      return;
    }
    const ok = await runAction(
      () => saveWeddingItem(app.db, item?.id ?? null, { name: nameInput.value, ...values, manualPaidNote: manualNote.value, vendor: vendor.value, dueDate: due.value, note: note.value }),
      item ? `已更新「${nameInput.value.trim()}」` : `已新增婚禮項目「${nameInput.value.trim()}」`,
      { onError: markErrors(f) },
    );
    if (ok) close();
  };
  const { el, close } = openDialog({
    title: item ? `編輯：${item.name}` : '新增婚禮項目',
    size: 'lg',
    body: h('div', { class: 'cf-form-grid' }, Object.values(f).map((x) => x.el)),
    actions: [{ label: '取消', variant: 'secondary', onClick: (c) => c() }, { label: '儲存', variant: 'primary', onClick: save }],
  });
  submitOnEnter(el, save, close);
  (item ? est : nameInput).focus();
}

// ---------------------------------------------------------------------------
// 禮金
// ---------------------------------------------------------------------------
function giftsPanel(s, ds) {
  const exportCsv = () => {
    if (!s.gifts.length) return toast.warning('沒有禮金紀錄可以匯出');
    const csv = toCsv(s.gifts, [
      { header: '日期', value: (g) => g.date },
      { header: '姓名', value: (g) => g.giverName },
      { header: '關係', value: (g) => g.relation },
      { header: '哪一方', value: (g) => ENUMS.giftSide[g.side] },
      { header: '金額', value: (g) => g.amount },
      { header: '入帳帳戶', value: (g) => (g.accountId ? accountName(ds, g.accountId) : '') },
      { header: '備註', value: (g) => g.note },
    ]);
    downloadText(`couple-finance-wedding-gifts-${fileTimestamp()}.csv`, csv, 'text/csv');
    toast.success(`已觸發下載禮金 CSV（${s.gifts.length} 筆）`);
  };
  return panel(
    {
      title: '禮金',
      subtitle: `合計 ${formatMoney(s.totalGifts)} · 我方 ${formatMoney(s.giftsBySide.self)} · 對方 ${formatMoney(s.giftsBySide.partner)} · 共同 ${formatMoney(s.giftsBySide.both)}`,
      actions: [
        h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: exportCsv }, icon('bi-filetype-csv'), ' CSV'),
        h('button', { type: 'button', class: 'btn cf-btn-lime', onClick: () => openGiftForm(null) }, icon('bi-plus-lg'), ' 新增禮金'),
      ],
    },
    s.gifts.length
      ? h('ul', { class: 'cf-gift-list' }, s.gifts.map((g) => {
          const remove = async () => {
            const ok = await confirmDialog({ title: '刪除禮金', message: `確定要刪除「${g.giverName}」${formatMoney(g.amount)}嗎？${g.transactionId ? '已入帳的禮金收入交易也會一併刪除。' : ''}`, confirmLabel: '刪除', danger: true });
            if (ok) await runAction(() => deleteWeddingGift(app.db, g.id), '已刪除禮金');
          };
          return h('li', { class: 'cf-gift-item' },
            h('span', { class: 'cf-gift-icon' }, icon('bi-envelope-heart')),
            h('button', { type: 'button', class: 'cf-gift-main', onClick: () => openGiftForm(g), 'aria-label': `編輯：${g.giverName}` },
              h('span', { class: 'cf-gift-name' }, g.giverName, g.relation ? h('span', { class: 'cf-help-text' }, ` · ${g.relation}`) : null),
              h('span', { class: 'cf-help-text' }, `${g.date.replaceAll('-', '/')} · ${ENUMS.giftSide[g.side]}${g.note ? ` · ${g.note}` : ''}`),
            ),
            g.accountId ? statusPill('ok', `已入帳：${accountName(ds, g.accountId)}`) : statusPill('muted', '未入帳'),
            h('span', { class: 'cf-gift-amount' }, formatMoney(g.amount)),
            h('button', { type: 'button', class: 'cf-icon-btn cf-icon-btn-danger', title: '刪除', 'aria-label': `刪除：${g.giverName}`, onClick: remove }, icon('bi-trash')),
          );
        }))
      : h('div', { class: 'cf-empty' }, icon('bi-gift'), h('p', null, '還沒有禮金紀錄')),
  );
}

function openGiftForm(gift) {
  const ds = app.dataset;
  const nameInput = textInput(gift?.giverName ?? '', { maxlength: 40 });
  const relation = textInput(gift?.relation ?? '', { maxlength: 40, placeholder: '例如：同事、親戚' });
  const side = selectEl(Object.entries(ENUMS.giftSide).map(([value, label]) => ({ value, label })), gift?.side ?? 'self');
  const amount = moneyInput(gift?.amount ?? '');
  const date = h('input', { type: 'date', class: 'form-control', value: gift?.date ?? ds.weddingProject?.weddingDate ?? today() });
  const accounts = sortedAccounts(ds).filter((a) => !a.archived || a.id === gift?.accountId);
  const account = selectEl([{ value: '', label: '不入帳（只記錄）' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))], gift?.accountId ?? '');
  const note = textInput(gift?.note ?? '', { maxlength: 200 });
  const f = {
    giverName: field('送禮人', nameInput),
    relation: field('關係（選填）', relation),
    side: field('哪一方的賓客', side),
    amount: field('金額（元）', amount),
    date: field('日期', date),
    accountId: field('入帳帳戶', account, { help: '選擇帳戶會自動建立一筆「禮金」收入交易，之後修改會同步' }),
    note: field('備註', note, { className: 'cf-field-wide' }),
  };
  const save = async (close) => {
    for (const x of Object.values(f)) x.setError(null);
    const amt = readMoney(amount);
    if (!amt || amt <= 0) {
      f.amount.setError('請輸入大於 0 的整數');
      toast.error('資料未儲存：禮金金額必須是大於 0 的整數');
      return;
    }
    const willLink = Boolean(account.value);
    const ok = await runAction(
      () => saveWeddingGift(app.db, gift?.id ?? null, { giverName: nameInput.value, relation: relation.value, side: side.value, amount: amt, date: date.value, accountId: account.value, note: note.value }),
      `${gift ? '已更新' : '已新增'}禮金 ${formatMoney(amt)}${willLink ? '，並同步禮金收入交易' : gift?.accountId ? '，並刪除原本的禮金收入交易' : ''}`,
      { onError: markErrors(f) },
    );
    if (ok) close();
  };
  const { el, close } = openDialog({
    title: gift ? '編輯禮金' : '新增禮金',
    body: h('div', { class: 'cf-form-grid' }, Object.values(f).map((x) => x.el)),
    actions: [{ label: '取消', variant: 'secondary', onClick: (c) => c() }, { label: '儲存', variant: 'primary', onClick: save }],
  });
  submitOnEnter(el, save, close);
  nameInput.focus();
}
