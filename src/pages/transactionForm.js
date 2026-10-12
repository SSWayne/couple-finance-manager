/**
 * 新增／修改交易的對話框（收入、支出、轉帳共用）。
 * 即時顯示分攤與代墊試算；已結算或由其他功能產生的交易會鎖定對應欄位。
 */
import { h, icon } from '../ui/h.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { field, moneyInput, segmented, selectEl, setOptions, textInput } from '../ui/form.js';
import { notice } from '../ui/components.js';
import { runAction, toast } from '../ui/toast.js';
import { ValidationError } from '../data/validate.js';
import { ENUMS } from '../data/schema.js';
import { app } from '../app/state.js';
import { createTransaction, deleteTransaction, findLinkOwner, normalizeTransactionInput, updateTransaction, SETTLED_LOCKED_FIELDS, LINKED_LOCKED_FIELDS } from '../domain/transactionService.js';
import { categoryTree, memberName, orderedMembers, sortedAccounts, accountTypeLabel } from '../domain/lookup.js';
import { computeAdvance, otherMember, MEMBER_SELF } from '../domain/split.js';
import { parseMoneyInput, formatMoney } from '../lib/money.js';
import { today } from '../lib/date.js';
import { saveRecurring, runRecurring } from '../domain/recurringService.js';
import { dueDates } from '../domain/recurring.js';

const TYPE_OPTIONS = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'transfer', label: '轉帳' },
];

/**
 * @param {{ tx?: object, defaults?: object, recurring?: { template: object|null } }} opts
 *   recurring：固定收支模式（範本與交易共用欄位與規則），額外有名稱、週期、開始日、結束日。
 */
export function openTransactionForm({ tx = null, defaults = {}, recurring = null } = {}) {
  const ds = app.dataset;
  const template = recurring?.template ?? null;
  if (!tx && !template && !ds.accounts.some((a) => !a.archived)) {
    toast.warning('請先新增至少一個帳戶（例如銀行或現金），才能記帳。');
    location.hash = '#/accounts';
    return null;
  }
  const members = orderedMembers(ds);
  const editing = Boolean(tx) || Boolean(template);
  const isRecurring = Boolean(recurring);
  const generated = template ? ds.transactions.filter((t) => t.recurringId === template.id).length : 0;
  const init = tx ?? (template ? { ...template, date: template.startDate } : null) ?? {
    type: 'expense',
    date: today(),
    amount: null,
    accountId: null,
    toAccountId: null,
    categoryId: null,
    subcategoryId: null,
    memberId: MEMBER_SELF,
    ownershipType: 'shared',
    ownerMemberId: null,
    splitMode: 'equal',
    shares: null,
    paymentMethod: null,
    description: '',
    weddingExpenseId: null,
    tags: [],
    ...defaults,
  };

  const settled = Boolean(tx?.settlementId);
  const linkOwner = tx ? findLinkOwner(ds, tx.id) : null;
  const locked = new Set([...(settled ? SETTLED_LOCKED_FIELDS : []), ...(linkOwner ? LINKED_LOCKED_FIELDS : [])]);

  // ---------- 控制項 ----------
  const typeSeg = segmented(TYPE_OPTIONS, init.type, { label: '交易類型', onChange: () => sync({ typeChanged: true }) });
  const dateInput = h('input', { type: 'date', class: 'form-control', value: init.date, required: true });
  const amountInput = moneyInput(init.amount, { required: true, 'aria-label': '金額（新台幣元）' });

  const accountOptions = (keepId) =>
    sortedAccounts(ds)
      .filter((a) => !a.archived || a.id === keepId)
      .map((a) => ({ value: a.id, label: `${a.name}（${accountTypeLabel(a.type)}${a.archived ? '，已停用' : ''}）` }));
  const accountSel = selectEl([{ value: '', label: '請選擇帳戶' }, ...accountOptions(init.accountId)], init.accountId ?? '');
  const toAccountSel = selectEl([{ value: '', label: '請選擇轉入帳戶' }, ...accountOptions(init.toAccountId)], init.toAccountId ?? '');

  const categorySel = selectEl([], init.categoryId ?? '');
  const subcategorySel = selectEl([], init.subcategoryId ?? '');

  const memberOptions = members.map((m) => ({ value: m.id, label: m.name }));
  const memberSel = selectEl(memberOptions, init.memberId);
  const paymentSel = selectEl([{ value: '', label: '未指定' }, ...Object.entries(ENUMS.paymentMethod).map(([value, label]) => ({ value, label }))], init.paymentMethod ?? '');

  const ownershipSeg = segmented(
    [{ value: 'shared', label: '共同' }, { value: 'personal', label: '個人' }],
    init.ownershipType ?? 'shared',
    { label: '歸屬', onChange: () => sync() },
  );
  const ownerSel = selectEl(memberOptions, init.ownerMemberId ?? init.memberId);

  const splitSel = selectEl(
    ['equal', 'ratio', 'amount'].map((v) => ({ value: v, label: ENUMS.splitMode[v] })),
    init.splitMode === 'none' ? 'equal' : init.splitMode,
  );
  const initShares = init.shares ?? {};
  const initRatio = (mid) => (init.amount && init.shares ? Math.round((initShares[mid] / init.amount) * 10000) / 100 : 50);
  const ratioInputs = Object.fromEntries(members.map((m) => [m.id, h('input', { type: 'number', class: 'form-control', min: 0, max: 100, step: 'any', value: String(initRatio(m.id)), inputmode: 'decimal', 'aria-label': `${m.name} 負擔比例（%）` })]));
  const shareInputs = Object.fromEntries(members.map((m) => [m.id, moneyInput(initShares[m.id] ?? '', { 'aria-label': `${m.name} 負擔金額` })]));

  const descInput = textInput(init.description, { maxlength: 200, placeholder: '例如：全聯採買' });
  const tagsInput = textInput((init.tags ?? []).join(', '), { maxlength: 220, placeholder: '以逗號分隔，例如：日常, 週末' });
  const weddingItems = [...ds.weddingExpenses].sort((a, b) => a.sortOrder - b.sortOrder);
  const weddingSel = selectEl([{ value: '', label: '不關聯' }, ...weddingItems.map((i) => ({ value: i.id, label: i.name }))], init.weddingExpenseId ?? '');

  // 固定收支模式的額外欄位
  const nameInput = textInput(template?.name ?? '', { maxlength: 40, placeholder: '例如：房租、網路費、薪資' });
  const freqSel = selectEl(Object.entries(ENUMS.frequency).map(([value, label]) => ({ value, label })), template?.frequency ?? 'monthly', { disabled: generated > 0 });
  const endDateInput = h('input', { type: 'date', class: 'form-control', value: template?.endDate ?? '' });
  if (generated > 0) dateInput.disabled = true;
  const rf = isRecurring
    ? {
        name: field('名稱', nameInput, { className: 'cf-field-wide' }),
        frequency: field('週期', freqSel, { help: generated ? `已產生 ${generated} 筆，週期與開始日不能修改` : '每月 31 日遇到較短的月份會用月底' }),
        endDate: field('結束日期（選填）', endDateInput),
      }
    : null;
  const recurringHint = h('div', { class: 'cf-help-text cf-field-wide', 'aria-live': 'polite' });

  // ---------- 欄位 ----------
  const f = {
    date: field(isRecurring ? '開始日期' : '日期', dateInput),
    amount: field('金額（元）', amountInput),
    accountId: field('付款帳戶', accountSel),
    toAccountId: field('轉入帳戶', toAccountSel),
    categoryId: field('分類', categorySel),
    subcategoryId: field('子分類', subcategorySel),
    memberId: field('付款人', memberSel),
    paymentMethod: field('付款方式', paymentSel),
    ownerMemberId: field('這是誰的', ownerSel),
    splitMode: field('分攤方式', splitSel),
    description: field('說明', descInput, { className: 'cf-field-wide' }),
    tags: field('標籤', tagsInput, { className: 'cf-field-wide' }),
    weddingExpenseId: field('婚禮項目（選填）', weddingSel, { className: 'cf-field-wide', help: '關聯後，這筆支出會計入該婚禮項目的「已付款」。' }),
  };
  const ownershipField = h('div', { class: 'cf-field' }, h('span', { class: 'form-label', id: 'cf-ownership-label' }, '歸屬'), ownershipSeg.el);
  ownershipSeg.el.setAttribute('aria-labelledby', 'cf-ownership-label');

  const ratioRow = h('div', { class: 'cf-split-inputs' },
    members.map((m) => h('label', { class: 'cf-split-input' }, h('span', null, m.name), ratioInputs[m.id], h('span', { class: 'cf-split-unit' }, '%'))),
  );
  const amountRow = h('div', { class: 'cf-split-inputs' },
    members.map((m) => h('label', { class: 'cf-split-input' }, h('span', null, m.name), shareInputs[m.id], h('span', { class: 'cf-split-unit' }, '元'))),
  );
  const preview = h('div', { class: 'cf-split-preview', 'aria-live': 'polite' });
  const splitBox = h('div', { class: 'cf-split-box cf-field-wide' }, f.splitMode.el, ratioRow, amountRow, preview);

  const lockNotice = settled
    ? notice('warning', '這筆交易已結算：類型、金額、付款人、歸屬與分攤已鎖定。如需修改，請先到「雙人財務」撤銷結算。')
    : linkOwner
      ? notice('info', `這筆交易由「${linkOwner.label}」產生：金額、日期、帳戶與分類請到「${linkOwner.page}」修改，這裡只能改說明、標籤與付款方式。`)
      : null;

  const body = h('div', { class: 'cf-txform' },
    lockNotice,
    isRecurring ? notice('info', '固定收支只在「開啟網站時」自動補入帳到期的項目；網站關閉期間不會執行，下次開啟時會補上。暫停後恢復，不會補產生暫停期間的項目。') : null,
    h('div', { class: 'cf-txform-type' }, typeSeg.el),
    h('div', { class: 'cf-form-grid' },
      rf ? [rf.name.el, rf.frequency.el, rf.endDate.el] : null,
      f.date.el, f.amount.el,
      rf ? recurringHint : null,
      f.accountId.el, f.toAccountId.el,
      f.categoryId.el, f.subcategoryId.el,
      f.memberId.el, f.paymentMethod.el,
      ownershipField, f.ownerMemberId.el,
      splitBox,
      f.description.el, f.tags.el, f.weddingExpenseId.el,
    ),
  );

  // ---------- 動態同步 ----------
  function fillCategories(type) {
    const keep = [init.categoryId, init.subcategoryId];
    const tree = categoryTree(ds, type === 'income' ? 'income' : 'expense', { keepIds: keep });
    const current = categorySel.value || init.categoryId || '';
    setOptions(categorySel, [{ value: '', label: '請選擇分類' }, ...tree.map((c) => ({ value: c.id, label: c.archived ? `${c.name}（已封存）` : c.name }))], current);
    fillSubcategories(tree);
  }
  function fillSubcategories(tree = categoryTree(ds, typeSeg.value === 'income' ? 'income' : 'expense', { keepIds: [init.categoryId, init.subcategoryId] })) {
    const parent = tree.find((c) => c.id === categorySel.value);
    const subs = parent?.children ?? [];
    const current = subcategorySel.value || init.subcategoryId || '';
    setOptions(subcategorySel, [{ value: '', label: subs.length ? '不指定' : '（無子分類）' }, ...subs.map((c) => ({ value: c.id, label: c.archived ? `${c.name}（已封存）` : c.name }))], current);
    subcategorySel.disabled = !subs.length || locked.has('subcategoryId');
  }

  function readAmount() {
    return parseMoneyInput(amountInput.value);
  }

  function updatePreview() {
    const type = typeSeg.value;
    const amount = readAmount();
    preview.replaceChildren();
    if (type !== 'expense' || !amount || amount <= 0) return;
    let fields;
    try {
      fields = normalizeTransactionInput(collect());
    } catch (err) {
      preview.append(h('span', { class: 'cf-split-preview-error' }, err.message));
      return;
    }
    const payer = fields.memberId;
    if (fields.ownershipType === 'shared' && fields.shares) {
      preview.append(
        h('div', null, members.map((m, i) => [i ? '、' : '', `${m.name}負擔 `, h('strong', null, formatMoney(fields.shares[m.id]))])),
      );
    }
    const adv = computeAdvance({ ...fields, type: 'expense' });
    if (adv) {
      preview.append(h('div', { class: 'cf-split-preview-advance' }, icon('bi-arrow-left-right'), ` ${memberName(ds, payer)}代墊 `, h('strong', null, formatMoney(adv.amount)), `，${memberName(ds, adv.debtorId)}之後需償還（可在「雙人財務」結算）`));
    } else if (fields.ownershipType === 'personal') {
      preview.append(h('div', null, `${memberName(ds, fields.ownerMemberId)}的個人支出，沒有代墊。`));
    }
  }

  function sync({ typeChanged = false } = {}) {
    const type = typeSeg.value;
    const isTransfer = type === 'transfer';
    if (typeChanged) {
      categorySel.value = '';
      subcategorySel.value = '';
    }
    f.accountId.control.previousElementSibling.textContent = isTransfer ? '轉出帳戶' : type === 'income' ? '入帳帳戶' : '付款帳戶';
    f.memberId.control.previousElementSibling.textContent = isTransfer ? '操作人' : type === 'income' ? '收款人' : '付款人';
    f.toAccountId.setVisible(isTransfer);
    f.categoryId.setVisible(!isTransfer);
    f.subcategoryId.setVisible(!isTransfer);
    ownershipField.hidden = isTransfer;
    const personal = ownershipSeg.value === 'personal';
    f.ownerMemberId.setVisible(!isTransfer && personal);
    f.ownerMemberId.control.previousElementSibling.textContent = type === 'income' ? '這是誰的收入' : '這是誰的支出';
    const showSplit = type === 'expense' && !personal;
    splitBox.hidden = !(type === 'expense');
    f.weddingExpenseId.setVisible(!isRecurring && type === 'expense' && weddingItems.length > 0);
    f.splitMode.setVisible(showSplit);
    ratioRow.hidden = !(showSplit && splitSel.value === 'ratio');
    amountRow.hidden = !(showSplit && splitSel.value === 'amount');
    if (!isTransfer) fillCategories(type);
    updatePreview();
    updateRecurringHint();
  }

  /** 固定收支：開始日在今天以前時，提示儲存後會立即補產生幾筆。 */
  function updateRecurringHint() {
    if (!isRecurring) return;
    const start = dateInput.value;
    if (!start || generated) {
      recurringHint.textContent = template?.lastGeneratedDate ? `最近一次產生：${template.lastGeneratedDate.replaceAll('-', '/')}` : '';
      return;
    }
    const n = dueDates({ startDate: start, frequency: freqSel.value, endDate: endDateInput.value || null, skipBefore: null }, today()).length;
    recurringHint.textContent = n ? `開始日在今天以前：儲存後會立即補產生 ${n} 筆（從開始日到今天）。` : '開始日在未來：到期後開啟網站時才會產生。';
  }
  for (const el of [dateInput, freqSel, endDateInput]) el.addEventListener('change', updateRecurringHint);

  // 自訂比例：改一邊自動補另一邊
  for (const m of members) {
    ratioInputs[m.id].addEventListener('input', () => {
      const v = Number(ratioInputs[m.id].value);
      if (Number.isFinite(v) && v >= 0 && v <= 100) ratioInputs[otherMember(m.id)].value = String(Math.round((100 - v) * 100) / 100);
      updatePreview();
    });
    shareInputs[m.id].addEventListener('input', () => {
      const amount = readAmount();
      const v = parseMoneyInput(shareInputs[m.id].value);
      if (amount && v !== null && v >= 0 && v <= amount) shareInputs[otherMember(m.id)].value = String(amount - v);
      updatePreview();
    });
  }
  for (const el of [amountInput, memberSel, ownerSel, splitSel]) el.addEventListener('input', () => sync());
  categorySel.addEventListener('change', () => {
    subcategorySel.value = '';
    fillSubcategories();
  });

  // 鎖定欄位
  const lockMap = { type: typeSeg, amount: amountInput, date: dateInput, accountId: accountSel, toAccountId: toAccountSel, memberId: memberSel, categoryId: categorySel, subcategoryId: subcategorySel, ownerMemberId: ownerSel, splitMode: splitSel };
  for (const [k, ctl] of Object.entries(lockMap)) {
    if (!locked.has(k)) continue;
    if (ctl.setDisabled) ctl.setDisabled(true);
    else ctl.disabled = true;
  }
  if (locked.has('ownershipType')) ownershipSeg.setDisabled(true);
  if (locked.has('shares')) for (const m of members) ratioInputs[m.id].disabled = shareInputs[m.id].disabled = true;

  function collect() {
    const amount = readAmount();
    return {
      type: typeSeg.value,
      date: dateInput.value,
      amount: amount ?? NaN,
      accountId: accountSel.value,
      toAccountId: toAccountSel.value,
      categoryId: categorySel.value,
      subcategoryId: subcategorySel.value,
      memberId: memberSel.value,
      paymentMethod: paymentSel.value,
      ownershipType: ownershipSeg.value,
      ownerMemberId: ownerSel.value,
      splitMode: splitSel.value,
      ratio: Object.fromEntries(members.map((m) => [m.id, Number(ratioInputs[m.id].value)])),
      shareAmounts: Object.fromEntries(members.map((m) => [m.id, parseMoneyInput(shareInputs[m.id].value)])),
      description: descInput.value,
      tags: tagsInput.value,
      weddingExpenseId: weddingItems.length ? weddingSel.value : (init.weddingExpenseId ?? null),
    };
  }

  function clearErrors() {
    for (const x of Object.values(f)) x.setError(null);
  }

  function showErrors(err) {
    if (!(err instanceof ValidationError)) return;
    for (const e of err.errors) {
      const key = e.field === 'shares' ? 'splitMode' : e.field;
      if (f[key] && !f[key].el.hidden) f[key].setError(e.message);
    }
  }

  let saving = false;
  async function save(close, { again = false } = {}) {
    if (saving) return;
    clearErrors();
    const input = collect();
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      f.amount.setError('請輸入大於 0 的整數金額（新台幣元）');
      amountInput.focus();
      toast.error('資料未儲存：金額必須是大於 0 的整數');
      return;
    }
    if (!input.date) {
      f.date.setError('請選擇日期');
      return;
    }
    if (isRecurring && !nameInput.value.trim()) {
      rf.name.setError('請輸入名稱');
      toast.error('資料未儲存：請輸入固定收支名稱');
      return;
    }
    saving = true;
    if (isRecurring) {
      const recInput = { ...input, name: nameInput.value, frequency: freqSel.value, startDate: input.date, endDate: endDateInput.value };
      let result = null;
      const okRec = await runAction(async () => {
        await saveRecurring(app.db, template?.id ?? null, recInput);
        result = await runRecurring(app.db, today());
      }, null, { onError: showErrors });
      saving = false;
      if (!okRec) return;
      const made = result?.count ? `，並補產生 ${result.count} 筆到期交易` : '';
      toast.success(`已${template ? '更新' : '新增'}固定收支「${recInput.name.trim()}」${made}`);
      if (result?.skipped.length) toast.warning('部分固定收支未產生', result.skipped.map((s) => `「${s.name}」：${s.reason}`));
      close();
      return;
    }
    const ok = await runAction(
      () => (editing ? updateTransaction(app.db, tx.id, input) : createTransaction(app.db, input)),
      editing ? '已更新交易' : `已新增${ENUMS.transactionType[input.type]} ${formatMoney(input.amount)}`,
      { onError: showErrors },
    );
    saving = false;
    if (!ok) return;
    if (again) {
      amountInput.value = '';
      descInput.value = '';
      tagsInput.value = '';
      updatePreview();
      amountInput.focus();
    } else {
      close();
    }
  }

  const actions = [];
  if (editing && !isRecurring && !settled && !linkOwner) {
    actions.push({
      label: '刪除',
      variant: 'dangerGhost',
      onClick: async (close) => {
        const title = tx.description || '這筆交易';
        const yes = await confirmDialog({ title: '刪除交易', message: `確定要刪除「${title}」${formatMoney(tx.amount)}嗎？刪除後無法復原。`, confirmLabel: '刪除', danger: true });
        if (yes && (await runAction(() => deleteTransaction(app.db, tx.id), '已刪除交易'))) close();
      },
    });
  }
  actions.push({ label: '取消', variant: 'secondary', onClick: (close) => close() });
  if (!editing && !isRecurring) actions.push({ label: '儲存並再記一筆', variant: 'secondary', onClick: (close) => save(close, { again: true }) });
  actions.push({ label: editing ? '儲存修改' : '儲存', variant: 'primary', onClick: (close) => save(close) });

  const title = isRecurring ? (template ? `修改固定收支：${template.name}` : '新增固定收支') : editing ? '修改交易' : '新增記帳';
  const { el, close } = openDialog({ title, body, actions, size: 'lg' });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
      e.preventDefault();
      save(close);
    }
  });
  sync();
  if (isRecurring && !template) nameInput.focus();
  else if (!locked.has('amount')) amountInput.focus();
  return { close };
}
