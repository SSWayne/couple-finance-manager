/**
 * IndexedDB（Dexie）存取層。
 *
 * 所有寫入都經過 commit()：
 *   1. 開一個涵蓋全部資料表的讀寫交易
 *   2. 讀出目前資料 → 在記憶體套用變更
 *   3. 以 validateDataset() 驗證整個資料集（含關聯與雙向一致）
 *   4. 通過才寫入；任何錯誤都會讓整個交易回滾，原資料不變
 */
import Dexie from 'dexie';
import { COLLECTIONS, COLLECTION_NAMES, DB_NAME, SCHEMA_VERSION, dexieStores, referencingFields } from './schema.js';
import { defaultDataset } from './seed.js';
import { ValidationError, validateDataset } from './validate.js';
import { newId } from '../lib/id.js';

export class FinanceDB extends Dexie {
  constructor(name = DB_NAME, options) {
    super(name, options);
    // Dexie 版本號與 SCHEMA_VERSION 同步；未來新增索引時在此加上 this.version(2)...
    this.version(SCHEMA_VERSION).stores(dexieStores());
    this.on('populate', (tx) => {
      const ds = defaultDataset();
      for (const name of COLLECTION_NAMES) {
        const rows = toRows(name, ds[name]);
        if (rows.length) tx.table(name).bulkAdd(rows);
      }
    });
  }
}

/** 單例／清單集合 → 資料表列。 */
export function toRows(name, value) {
  if (COLLECTIONS[name].kind === 'single') return value ? [value] : [];
  return value;
}

function fromRows(name, rows) {
  if (COLLECTIONS[name].kind === 'single') return rows[0] ?? null;
  return rows;
}

/** 在已開啟的交易中讀出整個資料集。 */
async function readAll(db) {
  const ds = {};
  for (const name of COLLECTION_NAMES) ds[name] = fromRows(name, await db.table(name).toArray());
  return ds;
}

/** 單一唯讀交易讀取全部集合（匯出與畫面使用）。 */
export function loadDataset(db) {
  return db.transaction('r', COLLECTION_NAMES, () => readAll(db));
}

export class ReferenceInUseError extends Error {
  constructor(message, references) {
    super(message);
    this.name = 'ReferenceInUseError';
    this.references = references;
  }
}

/** 由 schema 推導：找出哪些紀錄仍引用 collection/id。 */
export function findReferences(dataset, collection, id) {
  const out = [];
  for (const r of referencingFields(collection)) {
    const def = COLLECTIONS[r.collection];
    const list = def.kind === 'single' ? (dataset[r.collection] ? [dataset[r.collection]] : []) : dataset[r.collection];
    let count = 0;
    for (const rec of list) {
      if (r.collection === collection && rec.id === id) continue;
      const v = rec[r.field];
      if (r.list ? Array.isArray(v) && v.includes(id) : r.shares ? v && Object.hasOwn(v, id) : v === id) count++;
    }
    if (count) out.push({ collection: r.collection, field: r.field, count, label: def.label });
  }
  return out;
}

export function describeReferences(refs) {
  const byLabel = new Map();
  for (const r of refs) byLabel.set(r.label, (byLabel.get(r.label) ?? 0) + r.count);
  return [...byLabel].map(([label, n]) => `${n} 筆${label}`).join('、');
}

const listeners = new Set();
export function onDataChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emitChanged(info) {
  for (const fn of listeners) {
    try {
      fn(info);
    } catch (e) {
      console.error(e);
    }
  }
}

/**
 * 原子寫入。ops 可以是陣列或 (dataset) => ops 的函式（在同一交易中依最新資料計算）。
 * ops 函式必須是同步的（不可 async）。
 * op：{ op: 'put', collection, record } 或 { op: 'delete', collection, id }
 * 回傳 put 後的紀錄陣列（已補 id、createdAt、updatedAt）。
 */
export async function commit(db, ops, { now = new Date().toISOString() } = {}) {
  const result = await db.transaction('rw', COLLECTION_NAMES, async () => {
    const current = await readAll(db);
    // ops 函式必須是同步的：在 IndexedDB 交易中 await 非 Dexie 的 Promise 會讓交易提前結束
    const list = typeof ops === 'function' ? ops(structuredClone(current)) : ops;
    if (!Array.isArray(list)) throw new Error('commit() 需要變更清單');
    const next = { ...current };
    for (const name of COLLECTION_NAMES) if (Array.isArray(next[name])) next[name] = [...next[name]];

    const saved = [];
    const deleted = [];
    for (const op of list) {
      const def = COLLECTIONS[op.collection];
      if (!def) throw new Error(`未知的集合 ${op.collection}`);
      if (op.op === 'put') {
        const rec = { ...op.record };
        if (!rec.id) rec.id = def.fixedId ?? newId();
        const prev = def.kind === 'single' ? next[op.collection] : next[op.collection].find((r) => r.id === rec.id);
        rec.createdAt = prev?.id === rec.id ? prev.createdAt : rec.createdAt ?? now;
        rec.updatedAt = now;
        if (def.kind === 'single') next[op.collection] = rec;
        else {
          const idx = next[op.collection].findIndex((r) => r.id === rec.id);
          if (idx >= 0) next[op.collection][idx] = rec;
          else next[op.collection].push(rec);
        }
        saved.push({ collection: op.collection, record: rec });
      } else if (op.op === 'delete') {
        if (def.kind === 'single') {
          if (!def.nullable) throw new Error(`${def.label}不可刪除`);
          next[op.collection] = null;
        } else {
          next[op.collection] = next[op.collection].filter((r) => r.id !== op.id);
        }
        deleted.push({ collection: op.collection, id: op.id });
      } else {
        throw new Error(`未知的操作 ${op.op}`);
      }
    }

    // 刪除前引用檢查（由 schema 推導），給出比一般關聯錯誤更清楚的訊息
    for (const d of deleted) {
      const refs = findReferences(next, d.collection, d.id);
      if (refs.length) {
        throw new ReferenceInUseError(
          `無法刪除：此${COLLECTIONS[d.collection].label}仍被 ${describeReferences(refs)} 使用。`,
          refs,
        );
      }
    }

    const errors = validateDataset(next);
    if (errors.length) throw new ValidationError(errors);

    for (const d of deleted) await db.table(d.collection).delete(d.id);
    for (const s of saved) await db.table(s.collection).put(s.record);
    return saved.map((s) => s.record);
  });
  emitChanged({ type: 'commit' });
  return result;
}

/**
 * 以新資料集完整覆蓋資料庫：單一交易 clear + bulkAdd，失敗整批回滾。
 * 呼叫前必須已驗證；此處仍會再驗證一次作為最後防線。
 */
export async function replaceAll(db, dataset) {
  const errors = validateDataset(dataset);
  if (errors.length) throw new ValidationError(errors);
  await db.transaction('rw', COLLECTION_NAMES, async () => {
    for (const name of COLLECTION_NAMES) await db.table(name).clear();
    for (const name of COLLECTION_NAMES) {
      const rows = toRows(name, dataset[name]);
      if (rows.length) await db.table(name).bulkAdd(rows);
    }
  });
  emitChanged({ type: 'replace' });
}

export function notifyChanged() {
  emitChanged({ type: 'external' });
}
