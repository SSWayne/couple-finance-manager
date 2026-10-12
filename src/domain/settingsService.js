/** 設定、成員、分類的寫入操作。全部經過 commit()，驗證失敗不寫入。 */
import { commit } from '../data/db.js';
import { makeRecord, SETTINGS_ID } from '../data/schema.js';
import { UserError } from './errors.js';

export { UserError };

export function renameMember(db, memberId, name) {
  const trimmed = String(name ?? '').trim();
  return commit(db, (ds) => {
    const m = ds.members.find((x) => x.id === memberId);
    if (!m) throw new UserError('找不到此成員');
    return [{ op: 'put', collection: 'members', record: { ...m, name: trimmed } }];
  });
}

export function updateSettings(db, patch) {
  return commit(db, (ds) => {
    const allowed = ['backupReminderDays', 'dashboardPeriod', 'lastBackupAt'];
    for (const k of Object.keys(patch)) if (!allowed.includes(k)) throw new UserError(`不可修改設定 ${k}`);
    return [{ op: 'put', collection: 'settings', record: { ...ds.settings, ...patch, id: SETTINGS_ID } }];
  });
}

/** 匯出觸發下載後呼叫：記錄最後備份時間（觸發下載不代表檔案已保存）。 */
export function markBackupExported(db, at = new Date().toISOString()) {
  return updateSettings(db, { lastBackupAt: at });
}

export function createCategory(db, { name, type, parentId = null, icon, color }) {
  return commit(db, (ds) => {
    const siblings = ds.categories.filter((c) => (c.parentId ?? null) === (parentId ?? null) && c.type === type);
    const parent = parentId ? ds.categories.find((c) => c.id === parentId) : null;
    const record = makeRecord('categories', {
      name: String(name ?? '').trim(),
      type,
      parentId: parentId || null,
      icon: icon || parent?.icon || 'bi-tag',
      color: color || parent?.color || '#A9D94F',
      sortOrder: siblings.reduce((m, c) => Math.max(m, c.sortOrder + 1), 0),
    });
    if (siblings.some((c) => c.name === record.name)) throw new UserError(`已有名為「${record.name}」的分類`);
    return [{ op: 'put', collection: 'categories', record }];
  });
}

/** 只允許改名稱、圖示、顏色；類型與上層分類建立後不可改（避免舊交易分類錯亂）。 */
export function updateCategory(db, id, patch) {
  return commit(db, (ds) => {
    const c = ds.categories.find((x) => x.id === id);
    if (!c) throw new UserError('找不到此分類');
    const next = { ...c };
    if ('name' in patch) next.name = String(patch.name ?? '').trim();
    if ('icon' in patch) next.icon = patch.icon;
    if ('color' in patch) next.color = patch.color;
    const dup = ds.categories.some(
      (x) => x.id !== id && x.type === c.type && (x.parentId ?? null) === (c.parentId ?? null) && x.name === next.name,
    );
    if (dup) throw new UserError(`已有名為「${next.name}」的分類`);
    return [{ op: 'put', collection: 'categories', record: next }];
  });
}

/** 封存主分類時一併封存其子分類；取消封存子分類時主分類必須是啟用的。 */
export function setCategoryArchived(db, id, archived) {
  return commit(db, (ds) => {
    const c = ds.categories.find((x) => x.id === id);
    if (!c) throw new UserError('找不到此分類');
    if (!archived && c.parentId) {
      const parent = ds.categories.find((x) => x.id === c.parentId);
      if (parent?.archived) throw new UserError('請先取消封存主分類');
    }
    const targets = archived ? ds.categories.filter((x) => x.id === id || x.parentId === id) : [c];
    return targets.map((x) => ({ op: 'put', collection: 'categories', record: { ...x, archived } }));
  });
}

export function deleteCategory(db, id) {
  return commit(db, (ds) => {
    const c = ds.categories.find((x) => x.id === id);
    if (!c) throw new UserError('找不到此分類');
    if (c.isSystem) throw new UserError(`「${c.name}」是系統分類，其他功能會用到，不能刪除（可以改名）。`);
    const children = ds.categories.filter((x) => x.parentId === id);
    if (children.length) throw new UserError(`「${c.name}」底下還有 ${children.length} 個子分類，請先刪除或封存子分類。`);
    // 交易、預算、固定收支的引用由 commit() 依 schema 自動檢查
    return [{ op: 'delete', collection: 'categories', id }];
  });
}
