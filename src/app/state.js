/** App 全域狀態（只在記憶體中，不寫入 localStorage）。 */
import { loadDataset } from '../data/db.js';

export const app = {
  db: null,
  dataset: null,
  /** 'granted' | 'denied' | 'unsupported' | 'unknown' */
  persist: 'unknown',
  /** 頂部快速搜尋文字：透過記憶體傳給收支記帳頁，不放進 URL。 */
  quickSearch: '',
};

export async function refreshDataset() {
  app.dataset = await loadDataset(app.db);
  return app.dataset;
}

/**
 * 要求持久化儲存。刻意「不 await」：Firefox 會跳出詢問視窗，
 * 若 await 會讓整站卡在載入中直到使用者回應。
 */
export function requestPersistentStorage(onChange) {
  try {
    const storage = navigator.storage;
    if (!storage?.persist) {
      app.persist = 'unsupported';
      return;
    }
    const ask = () =>
      storage.persist().then((granted) => {
        app.persist = granted ? 'granted' : 'denied';
        onChange?.();
      });
    (storage.persisted ? storage.persisted() : Promise.resolve(false))
      .then((already) => {
        if (already) {
          app.persist = 'granted';
          onChange?.();
          return undefined;
        }
        return ask();
      })
      .catch(() => {
        app.persist = 'unknown';
      });
  } catch {
    app.persist = 'unsupported';
  }
}
