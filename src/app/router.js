/** Hash 路由與畫面重繪。資料變更（commit / 匯入）後自動重繪目前頁面並保留捲動位置。 */
import { h } from '../ui/h.js';
import { notice } from '../ui/components.js';
import { app, refreshDataset } from './state.js';
import { parseHash, ROUTES } from './routes.js';
import { onDataChanged } from '../data/db.js';
import { PAGES } from '../pages/index.js';

export function startRouter(shell) {
  let currentKey = null;
  let pending = null;

  async function render({ keepScroll = false } = {}) {
    const key = parseHash();
    if (currentKey && currentKey !== key) PAGES[currentKey]?.onLeave?.();
    const routeChanged = currentKey !== key;
    currentKey = key;
    const scrollY = window.scrollY;
    try {
      await refreshDataset();
      shell.update(key);
      const page = PAGES[key];
      const ctx = {
        db: app.db,
        dataset: app.dataset,
        rerender: () => schedule({ keepScroll: true }),
        navigate: (k) => { location.hash = `#/${k}`; },
      };
      const node = await page.render(ctx);
      shell.content.replaceChildren(node);
      document.title = `${ROUTES.find((r) => r.key === key).label}｜我們的小金庫`;
      if (routeChanged) window.scrollTo(0, 0);
      else if (keepScroll) window.scrollTo(0, scrollY);
    } catch (err) {
      console.error(err);
      shell.content.replaceChildren(
        h('div', { class: 'cf-page' }, notice('danger', h('p', { class: 'cf-notice-title' }, '畫面載入失敗'), h('p', null, String(err?.message || err)))),
      );
    }
  }

  /** 合併同一時間的多次重繪請求。 */
  function schedule(opts) {
    if (pending) return pending;
    pending = Promise.resolve().then(() => {
      pending = null;
      return render(opts);
    });
    return pending;
  }

  window.addEventListener('hashchange', () => schedule({ keepScroll: false }));
  onDataChanged(() => schedule({ keepScroll: true }));
  return schedule({ keepScroll: false });
}
