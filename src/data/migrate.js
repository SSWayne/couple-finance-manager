/**
 * 備份格式升級。MIGRATIONS[n] 把 schemaVersion n 的備份轉成 n+1。
 * 目前只有 v1，因此清單為空；未來例如加入多幣別時：
 *   MIGRATIONS[1] = (b) => ({ ...b, transactions: b.transactions.map(t => ({ ...t, currency: 'TWD' })) })
 */
import { SCHEMA_VERSION } from './schema.js';

export const MIGRATIONS = {};

export function migrate(backup, migrations = MIGRATIONS, target = SCHEMA_VERSION) {
  let b = structuredClone(backup);
  for (let v = b.schemaVersion; v < target; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`缺少從第 ${v} 版升級到第 ${v + 1} 版的轉換程式`);
    b = step(b);
    b.schemaVersion = v + 1;
  }
  return b;
}
