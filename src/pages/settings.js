/** 系統設定：備份還原、成員姓名、提醒天數、分類管理、跨裝置說明。 */
import { h, icon } from '../ui/h.js';
import { pageHeader, panel, notice, statusPill } from '../ui/components.js';
import { runAction, toast } from '../ui/toast.js';
import { confirmDialog, promptDialog } from '../ui/dialog.js';
import { app } from '../app/state.js';
import { exportBackupNow } from '../app/backupActions.js';
import { parseBackupText, restoreDataset, APP_VERSION } from '../data/backup.js';
import { SCHEMA_VERSION, ENUMS } from '../data/schema.js';
import { backupStatus } from '../domain/backupStatus.js';
import { formatDateTime } from '../lib/date.js';
import { createCategory, deleteCategory, renameMember, setCategoryArchived, updateCategory, updateSettings } from '../domain/settingsService.js';
import { MEMBER_SELF, MEMBER_PARTNER } from '../domain/split.js';

/** 匯入流程的暫存狀態（只在記憶體，切頁或取消即清除）。 */
const importState = { fileName: null, result: null, confirmed: false, busy: false };
const categoryView = { type: 'expense', showArchived: false };

function resetImport() {
  importState.fileName = null;
  importState.result = null;
  importState.confirmed = false;
  importState.busy = false;
}

export function render(ctx) {
  const ds = ctx.dataset;
  return h('div', { class: 'cf-page cf-settings-page' },
    pageHeader('系統設定', '備份還原、成員、分類與資料儲存說明'),
    h('div', { class: 'cf-settings-grid' },
      backupPanel(ds, ctx),
      importPanel(ctx),
    ),
    h('div', { class: 'cf-settings-grid' },
      membersPanel(ds),
      reminderPanel(ds),
    ),
    categoriesPanel(ds, ctx),
    storagePanel(),
    aboutPanel(),
  );
}

export function onLeave() {
  resetImport();
}

// ---------------------------------------------------------------------------
function backupPanel(ds) {
  const st = backupStatus(ds.settings);
  return panel(
    { title: '匯出備份', subtitle: '下載包含全部資料的 JSON 檔', className: 'cf-settings-backup' },
    h('dl', { class: 'cf-kv-list' },
      h('div', null, h('dt', null, '上次匯出'), h('dd', null, ds.settings.lastBackupAt ? formatDateTime(ds.settings.lastBackupAt) : '從未匯出')),
      h('div', null, h('dt', null, '狀態'), h('dd', null, statusPill(st.level === 'warning' ? 'warning' : 'ok', st.text))),
      h('div', null, h('dt', null, '檔名格式'), h('dd', { class: 'cf-text-mono' }, 'couple-finance-backup-YYYYMMDD-HHmmss.json')),
    ),
    notice('info',
      h('p', null, '「上次匯出」記錄的是觸發下載的時間。觸發下載不等於檔案已保存：瀏覽器可能詢問存放位置、被取消或被封鎖。'),
      h('p', null, '請到下載資料夾確認檔案存在，並另外存到雲端硬碟或隨身碟。備份檔含有完整財務資料，請妥善保管。'),
    ),
    h('button', { type: 'button', class: 'btn cf-btn-lime', onClick: () => exportBackupNow() }, icon('bi-download'), ' 下載完整備份（JSON）'),
  );
}

// ---------------------------------------------------------------------------
function importPanel(ctx) {
  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'form-control',
    id: 'cf-import-file',
    'aria-describedby': 'cf-import-help',
    onChange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      resetImport();
      importState.fileName = file.name;
      try {
        const text = await file.text();
        importState.result = parseBackupText(text);
      } catch (err) {
        importState.result = { ok: false, errors: [`無法讀取檔案：${err.message}`] };
      }
      if (!importState.result.ok) toast.error('備份檔驗證失敗，未匯入任何資料。');
      ctx.rerender();
    },
  });

  const body = [
    h('label', { class: 'form-label', htmlFor: 'cf-import-file' }, '選擇備份檔'),
    fileInput,
    h('p', { class: 'cf-help-text', id: 'cf-import-help' }, '會先驗證格式、版本、所有欄位與關聯，並顯示摘要；確認之前不會變更任何資料。'),
  ];

  const r = importState.result;
  if (r && !r.ok) {
    body.push(
      notice('danger',
        h('p', { class: 'cf-notice-title' }, `「${importState.fileName}」無法匯入，目前資料未變更：`),
        h('ul', { class: 'cf-error-list' }, r.errors.map((e) => h('li', null, e))),
      ),
    );
  } else if (r && r.ok) {
    body.push(importSummary(r, ctx));
  }

  return panel({ title: '匯入還原', subtitle: '以備份檔完整覆蓋目前資料', className: 'cf-settings-import' }, body);
}

function importSummary(r, ctx) {
  const s = r.summary;
  const c = s.counts;
  const confirmBox = h('input', {
    type: 'checkbox',
    class: 'form-check-input',
    id: 'cf-import-confirm',
    checked: importState.confirmed,
    onChange: (e) => {
      importState.confirmed = e.target.checked;
      restoreBtn.disabled = !importState.confirmed || importState.busy;
    },
  });
  const restoreBtn = h('button', {
    type: 'button',
    class: 'btn cf-btn-danger',
    disabled: !importState.confirmed || importState.busy,
    onClick: async () => {
      if (!importState.confirmed || importState.busy) return;
      importState.busy = true;
      restoreBtn.disabled = true;
      restoreBtn.textContent = '匯入中…';
      const ok = await runAction(() => restoreDataset(app.db, r.dataset), '匯入完成：已用備份檔完整覆蓋目前資料。');
      if (ok) resetImport();
      else {
        importState.busy = false;
        toast.warning('匯入失敗，已整批回滾，原本的資料沒有變更。');
      }
      ctx.rerender();
    },
  }, icon('bi-arrow-repeat'), ' 確認匯入並覆蓋');

  const row = (label, value) => h('div', null, h('dt', null, label), h('dd', null, value));
  return h('div', { class: 'cf-import-summary' },
    notice('success', h('p', null, `「${importState.fileName}」驗證通過。`)),
    h('dl', { class: 'cf-kv-list cf-kv-list-compact' },
      row('備份日期', formatDateTime(s.exportedAt)),
      row('資料格式版本', s.originalSchemaVersion !== s.schemaVersion ? `第 ${s.originalSchemaVersion} 版（已升級為第 ${s.schemaVersion} 版）` : `第 ${s.schemaVersion} 版`),
      row('程式版本', s.applicationVersion),
      row('成員', s.memberNames.join('、')),
      row('交易', `${c.transactions} 筆`),
      row('帳戶', `${c.accounts} 個`),
      row('預算', `${c.budgets} 筆`),
      row('儲蓄目標', `${c.savingsGoals} 個`),
      row('婚禮', s.hasWeddingProject ? `已建立（${c.weddingExpenses} 個項目、${c.weddingGifts} 筆禮金）` : '未建立'),
      row('其他', `分類 ${c.categories}、結算 ${c.settlements}、購屋 ${c.housingPlans}、固定收支 ${c.recurringTransactions}`),
    ),
    notice('warning',
      h('p', { class: 'cf-notice-title' }, '匯入會「完整覆蓋」這個瀏覽器中的所有資料，不會合併。'),
      h('p', null, '如果另一半在這台裝置上記過帳、而備份檔是在別的裝置匯出的，那些紀錄會被蓋掉。建議先下載目前資料的備份。'),
    ),
    h('div', { class: 'cf-import-actions' },
      h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: () => exportBackupNow() }, icon('bi-download'), ' 先下載目前備份'),
    ),
    h('div', { class: 'form-check cf-import-check' },
      confirmBox,
      h('label', { class: 'form-check-label', htmlFor: 'cf-import-confirm' }, '我了解目前資料會被備份檔完整覆蓋，且無法復原。'),
    ),
    h('div', { class: 'cf-import-actions' },
      restoreBtn,
      h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: () => { resetImport(); ctx.rerender(); } }, '取消'),
    ),
  );
}

// ---------------------------------------------------------------------------
function membersPanel(ds) {
  const roleLabel = { [MEMBER_SELF]: '我', [MEMBER_PARTNER]: '另一半' };
  const rows = [MEMBER_SELF, MEMBER_PARTNER].map((mid) => {
    const m = ds.members.find((x) => x.id === mid);
    const inputId = `cf-member-name-${mid}`;
    const input = h('input', { type: 'text', class: 'form-control', id: inputId, value: m.name, maxlength: 20, required: true });
    const save = () => runAction(() => renameMember(app.db, mid, input.value), `已更新「${roleLabel[mid]}」的名稱`);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
    return h('div', { class: 'cf-member-row' },
      h('span', { class: `cf-avatar cf-avatar-${mid === MEMBER_SELF ? 'self' : 'partner'}` }, [...m.name][0] ?? '?'),
      h('div', { class: 'cf-member-field' },
        h('label', { class: 'form-label', htmlFor: inputId }, roleLabel[mid]),
        h('div', { class: 'cf-inline-form' }, input, h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: save }, '儲存')),
      ),
    );
  });
  return panel({ title: '成員', subtitle: '固定兩位，只能修改顯示名稱' }, rows);
}

function reminderPanel(ds) {
  const input = h('input', { type: 'number', class: 'form-control', id: 'cf-reminder-days', min: 1, max: 365, step: 1, value: String(ds.settings.backupReminderDays), inputmode: 'numeric' });
  const save = () => {
    const n = Number(input.value);
    return runAction(() => updateSettings(app.db, { backupReminderDays: Number.isInteger(n) ? n : NaN }), '已更新備份提醒天數');
  };
  return panel({ title: '備份提醒', subtitle: '超過天數未匯出時，Sidebar 與財務總覽會提醒' },
    h('label', { class: 'form-label', htmlFor: 'cf-reminder-days' }, '提醒天數（1–365 天）'),
    h('div', { class: 'cf-inline-form' }, input, h('button', { type: 'button', class: 'btn cf-btn-ghost', onClick: save }, '儲存')),
  );
}

// ---------------------------------------------------------------------------
function categoriesPanel(ds, ctx) {
  const type = categoryView.type;
  const all = ds.categories.filter((c) => c.type === type);
  const visible = (c) => categoryView.showArchived || !c.archived;
  const parents = all.filter((c) => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenOf = (pid) => all.filter((c) => c.parentId === pid).sort((a, b) => a.sortOrder - b.sortOrder);

  const tabs = h('div', { class: 'cf-segmented', role: 'tablist', 'aria-label': '分類類型' },
    Object.entries(ENUMS.categoryType).map(([k, label]) =>
      h('button', {
        type: 'button',
        role: 'tab',
        class: { 'cf-segmented-btn': true, 'cf-segmented-btn-active': k === type },
        'aria-selected': String(k === type),
        onClick: () => { categoryView.type = k; ctx.rerender(); },
      }, `${label}分類`),
    ),
  );

  const archivedToggle = h('div', { class: 'form-check form-switch cf-category-toggle' },
    h('input', { class: 'form-check-input', type: 'checkbox', id: 'cf-show-archived', checked: categoryView.showArchived, onChange: (e) => { categoryView.showArchived = e.target.checked; ctx.rerender(); } }),
    h('label', { class: 'form-check-label', htmlFor: 'cf-show-archived' }, '顯示已封存'),
  );

  const newName = h('input', { type: 'text', class: 'form-control', maxlength: 20, placeholder: `新增${ENUMS.categoryType[type]}主分類`, 'aria-label': '新主分類名稱' });
  const addParent = async () => {
    const ok = await runAction(() => createCategory(app.db, { name: newName.value, type }), `已新增分類「${newName.value.trim()}」`);
    if (ok) newName.value = '';
  };
  newName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addParent();
  });

  const list = h('ul', { class: 'cf-category-list' },
    parents.filter(visible).map((p) =>
      h('li', { class: 'cf-category-item' },
        categoryRow(p, false),
        type === 'expense' || childrenOf(p.id).length
          ? h('ul', { class: 'cf-category-children' }, childrenOf(p.id).filter(visible).map((c) => h('li', null, categoryRow(c, true))))
          : null,
      ),
    ),
  );

  return panel(
    { title: '分類管理', subtitle: '已被交易、預算或固定收支使用的分類不能刪除，請改用封存', actions: tabs },
    archivedToggle,
    list,
    h('div', { class: 'cf-inline-form cf-category-add' }, newName, h('button', { type: 'button', class: 'btn cf-btn-lime', onClick: addParent }, icon('bi-plus-lg'), ' 新增')),
  );
}

function categoryRow(c, isChild) {
  const rename = async () => {
    const name = await promptDialog({ title: '修改分類名稱', label: '分類名稱', value: c.name, maxLength: 20 });
    if (name !== null && name.trim() !== c.name) await runAction(() => updateCategory(app.db, c.id, { name }), '已更新分類名稱');
  };
  const addChild = async () => {
    const name = await promptDialog({ title: `新增「${c.name}」的子分類`, label: '子分類名稱', maxLength: 20, confirmLabel: '新增' });
    if (name !== null) await runAction(() => createCategory(app.db, { name, type: c.type, parentId: c.id }), `已新增子分類「${name.trim()}」`);
  };
  const toggleArchive = () =>
    runAction(() => setCategoryArchived(app.db, c.id, !c.archived), c.archived ? `已取消封存「${c.name}」` : `已封存「${c.name}」${isChild ? '' : '及其子分類'}`);
  const remove = async () => {
    const ok = await confirmDialog({ title: '刪除分類', message: `確定要刪除「${c.name}」嗎？刪除後無法復原。`, confirmLabel: '刪除', danger: true });
    if (ok) await runAction(() => deleteCategory(app.db, c.id), `已刪除分類「${c.name}」`);
  };

  return h('div', { class: { 'cf-category-row': true, 'cf-category-row-child': isChild, 'cf-category-row-archived': c.archived } },
    h('span', { class: 'cf-category-swatch', style: { '--cf-swatch': c.color } }, icon(c.icon)),
    h('span', { class: 'cf-category-name' }, c.name),
    c.isSystem ? statusPill('neutral', '系統') : null,
    c.archived ? statusPill('muted', '已封存') : null,
    h('span', { class: 'cf-category-actions' },
      !isChild && c.type === 'expense' && !c.archived
        ? h('button', { type: 'button', class: 'cf-icon-btn', title: '新增子分類', 'aria-label': `新增「${c.name}」的子分類`, onClick: addChild }, icon('bi-plus-circle'))
        : null,
      h('button', { type: 'button', class: 'cf-icon-btn', title: '改名', 'aria-label': `修改「${c.name}」名稱`, onClick: rename }, icon('bi-pencil')),
      h('button', { type: 'button', class: 'cf-icon-btn', title: c.archived ? '取消封存' : '封存', 'aria-label': `${c.archived ? '取消封存' : '封存'}「${c.name}」`, onClick: toggleArchive }, icon(c.archived ? 'bi-arrow-counterclockwise' : 'bi-archive')),
      c.isSystem
        ? null
        : h('button', { type: 'button', class: 'cf-icon-btn cf-icon-btn-danger', title: '刪除', 'aria-label': `刪除「${c.name}」`, onClick: remove }, icon('bi-trash')),
    ),
  );
}

// ---------------------------------------------------------------------------
function storagePanel() {
  const persistText = {
    granted: ['ok', '已取得持久儲存：瀏覽器空間不足時不會自動清除本站資料'],
    denied: ['warning', '未取得持久儲存：瀏覽器空間不足時可能清除資料，請更頻繁備份'],
    unsupported: ['warning', '此瀏覽器不支援持久儲存設定'],
    unknown: ['muted', '持久儲存狀態確認中'],
  }[app.persist];
  return panel({ title: '資料儲存與跨裝置說明', subtitle: '純前端、無雲端、無同步' },
    h('p', null, statusPill(persistText[0], persistText[1])),
    h('ul', { class: 'cf-info-list' },
      h('li', null, '所有資料只存在「這台裝置的這個瀏覽器」的 IndexedDB 中，不會上傳到任何伺服器，也沒有第三方分析。'),
      h('li', null, '每次新增、修改、刪除都會立即自動儲存，並顯示成功或失敗提示。'),
      h('li', null, '不同裝置、不同瀏覽器（甚至同一瀏覽器的無痕視窗）之間「不會同步」。'),
      h('li', null, '清除瀏覽資料、移除網站資料或重灌系統，會一併刪除這裡的資料，請定期匯出備份。'),
      h('li', null, '要換到另一台裝置：在原裝置「匯出備份」→ 在新裝置「匯入還原」。匯入是完整覆蓋，不會自動合併。'),
      h('li', null, '兩人各自在不同裝置記帳時，後匯入的一方會蓋掉另一方的資料。建議指定一台主要記帳裝置，或約定輪流匯出／匯入。'),
    ),
  );
}

function aboutPanel() {
  return panel({ title: '關於' },
    h('dl', { class: 'cf-kv-list cf-kv-list-compact' },
      h('div', null, h('dt', null, '程式版本'), h('dd', null, APP_VERSION)),
      h('div', null, h('dt', null, '資料格式版本'), h('dd', null, `第 ${SCHEMA_VERSION} 版`)),
      h('div', null, h('dt', null, '金額格式'), h('dd', null, '整數新台幣元（TWD）')),
    ),
  );
}
