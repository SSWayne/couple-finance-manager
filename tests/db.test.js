import { describe, it, expect } from 'vitest';
import { createTestDb, reopen } from './helpers.js';
import { commit, loadDataset, replaceAll, ReferenceInUseError } from '../src/data/db.js';
import { makeRecord } from '../src/data/schema.js';
import { ValidationError } from '../src/data/validate.js';
import { buildSampleDataset } from './fixtures/sampleData.js';
import { createCategory, deleteCategory, renameMember, setCategoryArchived, updateSettings, UserError } from '../src/domain/settingsService.js';

const account = (overrides = {}) => makeRecord('accounts', { name: '測試帳戶', type: 'bank', ownershipType: 'shared', ...overrides });

describe('資料庫', () => {
  it('首次開啟寫入預設資料（2 位成員、分類、設定）', async () => {
    const db = await createTestDb();
    const ds = await loadDataset(db);
    expect(ds.members.map((m) => m.id).sort()).toEqual(['member-partner', 'member-self']);
    expect(ds.categories.find((c) => c.id === 'cat-exp-food')).toBeTruthy();
    expect(ds.settings.backupReminderDays).toBe(7);
    expect(ds.weddingProject).toBeNull();
  });

  it('新增、修改、刪除並自動補 id 與時間戳', async () => {
    const db = await createTestDb();
    const [saved] = await commit(db, [{ op: 'put', collection: 'accounts', record: account() }]);
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.createdAt).toBeTruthy();
    await commit(db, [{ op: 'put', collection: 'accounts', record: { ...saved, name: '改名' } }], { now: '2030-01-01T00:00:00.000Z' });
    let ds = await loadDataset(db);
    const updated = ds.accounts.find((a) => a.id === saved.id);
    expect(updated.name).toBe('改名');
    expect(updated.createdAt).toBe(saved.createdAt);
    expect(updated.updatedAt).toBe('2030-01-01T00:00:00.000Z');
    await commit(db, [{ op: 'delete', collection: 'accounts', id: saved.id }]);
    ds = await loadDataset(db);
    expect(ds.accounts).toHaveLength(0);
  });

  it('驗證失敗時整批不寫入', async () => {
    const db = await createTestDb();
    const ok = account({ name: '正常' });
    const bad = account({ name: '' });
    await expect(commit(db, [{ op: 'put', collection: 'accounts', record: ok }, { op: 'put', collection: 'accounts', record: bad }])).rejects.toBeInstanceOf(ValidationError);
    expect((await loadDataset(db)).accounts).toHaveLength(0);
  });

  it('有引用的帳戶不可刪除', async () => {
    const db = await createTestDb();
    await replaceAll(db, buildSampleDataset());
    const err = await commit(db, [{ op: 'delete', collection: 'accounts', id: 'acc-joint' }]).catch((e) => e);
    expect(err).toBeInstanceOf(ReferenceInUseError);
    expect(err.message).toContain('交易');
    expect((await loadDataset(db)).accounts.find((a) => a.id === 'acc-joint')).toBeTruthy();
  });

  it('關閉並重新開啟資料庫後資料仍在', async () => {
    const db = await createTestDb();
    await commit(db, [{ op: 'put', collection: 'accounts', record: account({ id: 'acc-persist', name: '持久' }) }]);
    const again = await reopen(db);
    const ds = await loadDataset(again);
    expect(ds.accounts.find((a) => a.id === 'acc-persist')?.name).toBe('持久');
  });
});

describe('設定服務', () => {
  it('成員只能改名，名稱不可空白', async () => {
    const db = await createTestDb();
    await renameMember(db, 'member-partner', '  小雯 ');
    expect((await loadDataset(db)).members.find((m) => m.id === 'member-partner').name).toBe('小雯');
    await expect(renameMember(db, 'member-self', '   ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('提醒天數範圍 1–365', async () => {
    const db = await createTestDb();
    await updateSettings(db, { backupReminderDays: 14 });
    expect((await loadDataset(db)).settings.backupReminderDays).toBe(14);
    await expect(updateSettings(db, { backupReminderDays: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateSettings(db, { currency: 'USD' })).rejects.toBeInstanceOf(UserError);
  });

  it('分類：新增子分類、重名拒絕、系統分類不可刪除、有引用不可刪除、封存連帶子分類', async () => {
    const db = await createTestDb();
    await createCategory(db, { name: '宵夜', type: 'expense', parentId: 'cat-exp-food' });
    await expect(createCategory(db, { name: '宵夜', type: 'expense', parentId: 'cat-exp-food' })).rejects.toBeInstanceOf(UserError);
    await expect(deleteCategory(db, 'cat-inc-gift')).rejects.toBeInstanceOf(UserError);
    await expect(deleteCategory(db, 'cat-exp-food')).rejects.toThrow('子分類');

    await replaceAll(db, buildSampleDataset());
    await expect(deleteCategory(db, 'cat-exp-daily')).rejects.toBeInstanceOf(ReferenceInUseError);
    await setCategoryArchived(db, 'cat-exp-food', true);
    const ds = await loadDataset(db);
    expect(ds.categories.filter((c) => c.id.startsWith('cat-exp-food')).every((c) => c.archived)).toBe(true);
    await expect(setCategoryArchived(db, 'cat-exp-food-lunch', false)).rejects.toThrow('主分類');
  });
});
