/**
 * JSON 備份與還原。
 *
 * 匯出：單一唯讀交易讀取全部 14 個集合。
 * 匯入：解析 → 驗證 format / schemaVersion（新版拒絕、舊版 migrate）→ 驗證欄位／ID／關聯
 *       → 產生摘要給使用者確認 → 單一交易 clear + bulkAdd（失敗整批回滾）。
 */
import { BACKUP_FORMAT, COLLECTION_NAMES, SCHEMA_VERSION, COLLECTIONS } from './schema.js';
import { loadDataset, replaceAll } from './db.js';
import { validateDataset, describeError } from './validate.js';
import { migrate } from './migrate.js';
import { fileTimestamp, isValidIsoDateTime } from '../lib/date.js';

// __APP_VERSION__ 由 vite.config.js 的 define 注入（版本來自 package.json）
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

const META_KEYS = ['format', 'schemaVersion', 'applicationVersion', 'exportedAt'];
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export function backupFileName(date = new Date()) {
  return `couple-finance-backup-${fileTimestamp(date)}.json`;
}

export async function buildBackup(db, now = new Date()) {
  const dataset = await loadDataset(db);
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    applicationVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    ...Object.fromEntries(COLLECTION_NAMES.map((n) => [n, dataset[n]])),
  };
}

export function serializeBackup(backup) {
  return JSON.stringify(backup, null, 2);
}

export function datasetFromBackup(backup) {
  return Object.fromEntries(COLLECTION_NAMES.map((n) => [n, backup[n]]));
}

export function summarizeBackup(backup) {
  return {
    exportedAt: backup.exportedAt,
    schemaVersion: backup.schemaVersion,
    originalSchemaVersion: backup.originalSchemaVersion ?? backup.schemaVersion,
    applicationVersion: backup.applicationVersion,
    counts: {
      transactions: backup.transactions.length,
      accounts: backup.accounts.length,
      budgets: backup.budgets.length,
      savingsGoals: backup.savingsGoals.length,
      weddingExpenses: backup.weddingExpenses.length,
      weddingGifts: backup.weddingGifts.length,
      categories: backup.categories.length,
      settlements: backup.settlements.length,
      housingPlans: backup.housingPlans.length,
      recurringTransactions: backup.recurringTransactions.length,
    },
    hasWeddingProject: Boolean(backup.weddingProject),
    memberNames: [...backup.members].sort((a, b) => (a.role === 'self' ? 0 : 1) - (b.role === 'self' ? 0 : 1)).map((m) => m.name),
  };
}

/**
 * 解析並驗證備份文字。
 * 回傳 { ok: true, dataset, summary } 或 { ok: false, errors: string[] }。
 */
export function parseBackupText(text) {
  const fail = (...errors) => ({ ok: false, errors });
  if (typeof text !== 'string' || text.length === 0) return fail('檔案是空的。');
  if (text.length > MAX_BACKUP_BYTES) return fail('檔案過大（超過 50MB），不像是本系統的備份檔。');

  let raw;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return fail('檔案不是有效的 JSON 格式，可能已損毀或不是備份檔。');
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fail('備份檔內容必須是 JSON 物件。');
  if (raw.format !== BACKUP_FORMAT) return fail(`這不是「我們的小金庫」的備份檔（format 應為 ${BACKUP_FORMAT}）。`);
  if (!Number.isSafeInteger(raw.schemaVersion) || raw.schemaVersion < 1) return fail('備份檔的 schemaVersion 不正確。');
  if (raw.schemaVersion > SCHEMA_VERSION) {
    return fail(`備份檔來自較新的版本（資料格式第 ${raw.schemaVersion} 版，本程式只支援到第 ${SCHEMA_VERSION} 版）。請先更新程式再匯入。`);
  }
  if (typeof raw.applicationVersion !== 'string') return fail('備份檔缺少 applicationVersion。');
  if (!isValidIsoDateTime(raw.exportedAt)) return fail('備份檔的 exportedAt（匯出時間）不正確。');

  let backup = raw;
  if (raw.schemaVersion < SCHEMA_VERSION) {
    try {
      backup = { ...migrate(raw), originalSchemaVersion: raw.schemaVersion };
    } catch (e) {
      return fail(`舊版備份升級失敗：${e.message}`);
    }
  }

  const allowed = new Set([...META_KEYS, ...COLLECTION_NAMES, 'originalSchemaVersion']);
  const unknown = Object.keys(backup).filter((k) => !allowed.has(k));
  if (unknown.length) return fail(`備份檔含有不明的欄位：${unknown.join('、')}`);
  const missing = COLLECTION_NAMES.filter((n) => !Object.hasOwn(backup, n));
  if (missing.length) return fail(`備份檔缺少集合：${missing.map((n) => COLLECTIONS[n].label).join('、')}`);

  const dataset = datasetFromBackup(backup);
  const errors = validateDataset(dataset);
  if (errors.length) {
    const shown = errors.slice(0, 20).map(describeError);
    if (errors.length > 20) shown.push(`……另有 ${errors.length - 20} 項錯誤`);
    return fail(...shown);
  }
  return { ok: true, dataset, summary: summarizeBackup(backup) };
}

/** 完整覆蓋還原。dataset 必須來自 parseBackupText 的成功結果。 */
export function restoreDataset(db, dataset) {
  return replaceAll(db, dataset);
}
