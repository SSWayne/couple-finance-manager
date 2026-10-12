import { afterEach } from 'vitest';
import Dexie from 'dexie';
import { FinanceDB } from '../src/data/db.js';

const opened = [];

/** 每個測試一個獨立、唯一名稱的資料庫；測試結束後刪除。 */
export async function createTestDb() {
  const name = `test-${crypto.randomUUID()}`;
  const db = new FinanceDB(name);
  await db.open();
  opened.push(db);
  return db;
}

afterEach(async () => {
  while (opened.length) {
    const db = opened.pop();
    db.close();
    await Dexie.delete(db.name);
  }
});

export function reopen(db) {
  db.close();
  const again = new FinanceDB(db.name);
  opened.push(again);
  return again.open().then(() => again);
}
