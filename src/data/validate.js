/**
 * 驗證器：表單儲存與 JSON 匯入共用同一套檢查。
 * 全部規則由 schema.js 推導：欄位型別、拒絕未知欄位、必填、關聯存在、商業規則、資料集規則。
 *
 * 錯誤格式：{ collection, id, field, message }
 */
import { COLLECTIONS, COLLECTION_NAMES, datasetRules } from './schema.js';
import { isValidId } from '../lib/id.js';
import { isValidDateString, isValidMonthString, isValidIsoDateTime } from '../lib/date.js';
import { MEMBER_IDS } from '../domain/split.js';

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.length ? errors[0].message : '資料驗證失敗');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** 檢查單一欄位值的型別與範圍；回傳錯誤訊息或 null。 */
export function checkFieldValue(f, value) {
  if (value === undefined) return '缺少欄位';
  if (value === null) {
    if (f.nullable) return null;
    if (f.type === 'ref' && f.nullable !== false) return null;
    return '此欄位為必填';
  }
  switch (f.type) {
    case 'id':
      return isValidId(value) ? null : 'ID 格式不正確';
    case 'ref':
      return isValidId(value) ? null : '關聯 ID 格式不正確';
    case 'refList': {
      if (!Array.isArray(value)) return '必須是 ID 陣列';
      if (value.some((v) => !isValidId(v))) return '陣列中有不正確的 ID';
      if (new Set(value).size !== value.length) return '陣列中有重複的 ID';
      if (f.minItems && value.length < f.minItems) return `至少需要 ${f.minItems} 筆`;
      return null;
    }
    case 'string': {
      if (typeof value !== 'string') return '必須是文字';
      const len = [...value].length;
      if (len < (f.min ?? 0)) return f.min === 1 ? '不可空白' : `至少 ${f.min} 個字`;
      if (f.min >= 1 && value.trim() === '') return '不可空白';
      if (len > f.max) return `最多 ${f.max} 個字`;
      return null;
    }
    case 'int':
    case 'money': {
      if (!Number.isSafeInteger(value)) return f.type === 'money' ? '金額必須是整數新台幣元' : '必須是整數';
      if (f.min !== undefined && value < f.min) return f.min === 1 ? '必須大於 0' : `不可小於 ${f.min}`;
      if (f.max !== undefined && value > f.max) return `不可大於 ${f.max}`;
      return null;
    }
    case 'decimal': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '必須是數字';
      if (f.min !== undefined && value < f.min) return `不可小於 ${f.min}`;
      if (f.max !== undefined && value > f.max) return `不可大於 ${f.max}`;
      const decimals = (String(value).split('.')[1] || '').length;
      if (decimals > f.maxDecimals) return `最多 ${f.maxDecimals} 位小數`;
      return null;
    }
    case 'bool':
      return typeof value === 'boolean' ? null : '必須是是／否';
    case 'enum':
      return f.values.includes(value) ? null : '不是允許的選項';
    case 'date':
      return isValidDateString(value) ? null : '日期格式須為 YYYY-MM-DD';
    case 'month':
      return isValidMonthString(value) ? null : '月份格式須為 YYYY-MM';
    case 'datetime':
      return isValidIsoDateTime(value) ? null : '時間格式不正確';
    case 'tags': {
      if (!Array.isArray(value)) return '標籤必須是陣列';
      if (value.length > f.maxItems) return `最多 ${f.maxItems} 個標籤`;
      for (const t of value) {
        if (typeof t !== 'string' || t.trim() === '') return '標籤不可空白';
        if ([...t].length > f.maxLength) return `每個標籤最多 ${f.maxLength} 個字`;
      }
      if (new Set(value).size !== value.length) return '標籤重複';
      return null;
    }
    case 'shares': {
      if (!isPlainObject(value)) return '分攤必須是 { 成員ID: 金額 }';
      for (const [k, v] of Object.entries(value)) {
        if (!MEMBER_IDS.includes(k)) return `分攤中的成員 ${k} 不存在`;
        if (!Number.isSafeInteger(v) || v < 0) return '分攤金額必須是 0 以上的整數';
      }
      return null;
    }
    default:
      return `未知的欄位型別 ${f.type}`;
  }
}

/** 結構檢查：拒絕未知欄位、缺欄位、型別錯誤。 */
export function validateRecordShape(collection, record) {
  const def = COLLECTIONS[collection];
  const errors = [];
  const rid = record && typeof record === 'object' ? record.id ?? null : null;
  if (!isPlainObject(record)) {
    return [{ collection, id: null, field: null, message: `${def.label}資料必須是物件` }];
  }
  for (const key of Object.keys(record)) {
    // 用 Object.hasOwn：`in` 會把 __proto__、toString 等原型鏈名稱當成合法欄位
    if (!Object.hasOwn(def.fields, key)) errors.push({ collection, id: rid, field: key, message: `不明欄位「${key}」` });
  }
  for (const [field, f] of Object.entries(def.fields)) {
    const msg = checkFieldValue(f, record[field]);
    if (msg) errors.push({ collection, id: rid, field, message: msg });
  }
  if (def.fixedId && record.id !== def.fixedId) {
    errors.push({ collection, id: rid, field: 'id', message: `${def.label}的 ID 必須是 ${def.fixedId}` });
  }
  return errors;
}

/** 建立查詢情境：每個集合 id → 紀錄 的 Map。 */
export function buildContext(dataset) {
  const maps = {};
  for (const name of COLLECTION_NAMES) {
    const def = COLLECTIONS[name];
    const list = def.kind === 'single' ? (dataset[name] ? [dataset[name]] : []) : dataset[name] || [];
    maps[name] = new Map();
    for (const r of list) if (r && typeof r === 'object' && typeof r.id === 'string') maps[name].set(r.id, r);
  }
  return {
    dataset,
    get: (collection, rid) => maps[collection].get(rid) ?? null,
    list: (collection) => {
      const def = COLLECTIONS[collection];
      if (def.kind === 'single') return dataset[collection] ? [dataset[collection]] : [];
      return dataset[collection];
    },
  };
}

/**
 * 驗證整個資料集。dataset 的形狀與備份檔中的集合相同：
 * 清單集合為陣列，weddingProject 為物件或 null，settings 為物件。
 */
export function validateDataset(dataset) {
  const errors = [];
  if (!isPlainObject(dataset)) return [{ collection: null, id: null, field: null, message: '資料集必須是物件' }];

  // 1. 集合存在與型別
  for (const name of COLLECTION_NAMES) {
    const def = COLLECTIONS[name];
    const value = dataset[name];
    if (def.kind === 'list') {
      if (!Array.isArray(value)) errors.push({ collection: name, id: null, field: null, message: `缺少「${def.label}」集合或格式不是陣列` });
    } else if (value === null) {
      if (!def.nullable) errors.push({ collection: name, id: null, field: null, message: `缺少「${def.label}」` });
    } else if (!isPlainObject(value)) {
      errors.push({ collection: name, id: null, field: null, message: `「${def.label}」必須是物件${def.nullable ? '或 null' : ''}` });
    }
  }
  if (errors.length) return errors;

  // 2. 單筆結構、ID 唯一
  let shapeOk = true;
  for (const name of COLLECTION_NAMES) {
    const def = COLLECTIONS[name];
    const list = def.kind === 'single' ? (dataset[name] ? [dataset[name]] : []) : dataset[name];
    const seen = new Set();
    for (const rec of list) {
      const shapeErrors = validateRecordShape(name, rec);
      if (shapeErrors.length) shapeOk = false;
      errors.push(...shapeErrors);
      if (rec && typeof rec.id === 'string') {
        if (seen.has(rec.id)) {
          errors.push({ collection: name, id: rec.id, field: 'id', message: `${def.label} ID 重複：${rec.id}` });
          shapeOk = false;
        }
        seen.add(rec.id);
      }
    }
  }
  // 結構錯誤時不往下跑商業規則，避免連鎖誤報
  if (!shapeOk) return errors;

  const ctx = buildContext(dataset);

  // 3. 關聯存在
  for (const name of COLLECTION_NAMES) {
    const def = COLLECTIONS[name];
    for (const rec of ctx.list(name)) {
      for (const [field, f] of Object.entries(def.fields)) {
        if (f.type === 'ref' && rec[field] !== null && !ctx.get(f.collection, rec[field])) {
          errors.push({ collection: name, id: rec.id, field, message: `關聯的${COLLECTIONS[f.collection].label}不存在（${rec[field]}）` });
        }
        if (f.type === 'refList') {
          for (const v of rec[field]) {
            if (!ctx.get(f.collection, v)) {
              errors.push({ collection: name, id: rec.id, field, message: `關聯的${COLLECTIONS[f.collection].label}不存在（${v}）` });
            }
          }
        }
      }
    }
  }

  // 4. 單筆商業規則
  for (const name of COLLECTION_NAMES) {
    const def = COLLECTIONS[name];
    if (!def.rules) continue;
    for (const rec of ctx.list(name)) {
      def.rules(rec, ctx, (field, message) => errors.push({ collection: name, id: rec.id, field, message }));
    }
  }

  // 5. 資料集規則
  for (const rule of datasetRules) {
    rule(ctx, (collection, rid, field, message) => errors.push({ collection, id: rid, field, message }));
  }
  return errors;
}

export function assertValidDataset(dataset) {
  const errors = validateDataset(dataset);
  if (errors.length) throw new ValidationError(errors);
}

/** 將錯誤轉為使用者可讀的一行文字。 */
export function describeError(e) {
  const def = e.collection && COLLECTIONS[e.collection];
  const parts = [];
  if (def) parts.push(def.label);
  // 可讀 ID 完整顯示；UUID 只顯示前 8 碼
  if (e.id) parts.push(`#${String(e.id).length > 24 ? String(e.id).slice(0, 8) : e.id}`);
  if (e.field) parts.push(`「${e.field}」`);
  return `${parts.join(' ')}：${e.message}`;
}
