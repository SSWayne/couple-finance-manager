/**
 * 設定環境變數 CF_FIXTURE_OUT=<路徑> 時，把測試資料集匯出成備份檔（供截圖檢查從 UI 匯入）。
 * 未設定時只驗證此備份可被解析。
 */
import { it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createTestDb } from './helpers.js';
import { replaceAll } from '../src/data/db.js';
import { buildBackup, parseBackupText, serializeBackup } from '../src/data/backup.js';
import { buildSampleDataset } from './fixtures/sampleData.js';

it('測試資料備份檔可匯出且可再匯入', async () => {
  const db = await createTestDb();
  await replaceAll(db, buildSampleDataset());
  const text = serializeBackup(await buildBackup(db));
  expect(parseBackupText(text).ok).toBe(true);
  const out = process.env.CF_FIXTURE_OUT;
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text, 'utf8');
  }
});
