import { describe, it, expect, vi } from 'vitest';
import Dexie from 'dexie';
import { createTestDb } from './helpers.js';
import { FinanceDB, loadDataset, replaceAll } from '../src/data/db.js';
import { backupFileName, buildBackup, parseBackupText, restoreDataset, serializeBackup } from '../src/data/backup.js';
import { BACKUP_FORMAT, COLLECTION_NAMES, SCHEMA_VERSION } from '../src/data/schema.js';
import { migrate } from '../src/data/migrate.js';
import { buildSampleDataset } from './fixtures/sampleData.js';

async function sampleBackupText() {
  const db = await createTestDb();
  await replaceAll(db, buildSampleDataset());
  return { db, text: serializeBackup(await buildBackup(db)) };
}

describe('JSON 匯出', () => {
  it('檔名格式 couple-finance-backup-YYYYMMDD-HHmmss.json', () => {
    expect(backupFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe('couple-finance-backup-20260102-030405.json');
  });

  it('包含 format、schemaVersion、applicationVersion、exportedAt 與全部 14 個集合', async () => {
    const { text } = await sampleBackupText();
    const b = JSON.parse(text);
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.schemaVersion).toBe(SCHEMA_VERSION);
    expect(typeof b.applicationVersion).toBe('string');
    expect(Date.parse(b.exportedAt)).not.toBeNaN();
    expect(COLLECTION_NAMES).toHaveLength(14);
    for (const n of COLLECTION_NAMES) expect(b).toHaveProperty(n);
  });
});

describe('JSON 匯入', () => {
  it('匯出 → 刪除整個資料庫 → 匯入，所有集合完全一致', async () => {
    const { db, text } = await sampleBackupText();
    const before = await loadDataset(db);
    const name = db.name;
    db.close();
    await Dexie.delete(name);

    const fresh = new FinanceDB(name);
    await fresh.open();
    const parsed = parseBackupText(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.summary.counts.transactions).toBe(before.transactions.length);
    await restoreDataset(fresh, parsed.dataset);
    const after = await loadDataset(fresh);
    const sortById = (ds) => Object.fromEntries(COLLECTION_NAMES.map((n) => [n, Array.isArray(ds[n]) ? [...ds[n]].sort((a, b) => a.id.localeCompare(b.id)) : ds[n]]));
    expect(sortById(after)).toEqual(sortById(before));
    fresh.close();
    await Dexie.delete(name);
  });

  it('接受 UTF-8 BOM', async () => {
    const { text } = await sampleBackupText();
    expect(parseBackupText('﻿' + text).ok).toBe(true);
  });

  it('格式錯誤：非 JSON、非本系統、缺集合、未知欄位', async () => {
    expect(parseBackupText('not json').errors[0]).toContain('不是有效的 JSON');
    expect(parseBackupText('[]').errors[0]).toContain('物件');
    expect(parseBackupText(JSON.stringify({ format: 'other' })).errors[0]).toContain('不是「我們的小金庫」');
    const { text } = await sampleBackupText();
    const b = JSON.parse(text);
    delete b.budgets;
    expect(parseBackupText(JSON.stringify(b)).errors[0]).toContain('缺少集合');
    const c = JSON.parse(text);
    c.extra = 1;
    expect(parseBackupText(JSON.stringify(c)).errors[0]).toContain('不明的欄位');
  });

  it('拒絕較新版本的備份', async () => {
    const { text } = await sampleBackupText();
    const b = JSON.parse(text);
    b.schemaVersion = SCHEMA_VERSION + 1;
    expect(parseBackupText(JSON.stringify(b)).errors[0]).toContain('較新的版本');
  });

  it('關聯錯誤時拒絕並列出原因', async () => {
    const { text } = await sampleBackupText();
    const b = JSON.parse(text);
    b.transactions[0].accountId = 'acc-ghost';
    const r = parseBackupText(JSON.stringify(b));
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('關聯的帳戶不存在');
  });

  it('寫入中途失敗時整批回滾，原資料不變', async () => {
    const { db, text } = await sampleBackupText();
    const original = await loadDataset(db);
    const parsed = parseBackupText(text);
    parsed.dataset.accounts[0].name = '應該不會寫入';
    const spy = vi.spyOn(db.table('transactions'), 'bulkAdd').mockImplementation(() => Promise.reject(new Error('模擬寫入失敗')));
    await expect(restoreDataset(db, parsed.dataset)).rejects.toThrow('模擬寫入失敗');
    spy.mockRestore();
    const after = await loadDataset(db);
    expect(after).toEqual(original);
  });

  it('舊版備份經 migrate() 升級；缺少轉換程式時報錯', () => {
    const v1 = { schemaVersion: 1, a: 1 };
    const out = migrate(v1, { 1: (b) => ({ ...b, a: 2 }) }, 2);
    expect(out).toEqual({ schemaVersion: 2, a: 2 });
    expect(() => migrate(v1, {}, 2)).toThrow('缺少');
  });
});
