import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
// 只打包 Inter 的 latin 子集（中文由系統字型顯示）
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/shell.css';
import './styles/pages.css';
import './styles/dashboard.css';
import './styles/plans.css';
import './styles/stage5.css';

import { FinanceDB, notifyChanged } from './data/db.js';
import { app, requestPersistentStorage } from './app/state.js';
import { createShell } from './app/layout.js';
import { startRouter } from './app/router.js';
import { h, mount } from './ui/h.js';
import { runRecurring } from './domain/recurringService.js';
import { toast, explainError } from './ui/toast.js';
import { today } from './lib/date.js';

async function boot() {
  const root = document.getElementById('app');
  try {
    if (!('indexedDB' in window)) throw new Error('此瀏覽器不支援 IndexedDB');
    app.db = new FinanceDB();
    await app.db.open();
  } catch (err) {
    console.error(err);
    mount(root,
      h('div', { class: 'cf-boot cf-boot-error', role: 'alert' },
        h('h1', null, '無法開啟本機資料庫'),
        h('p', null, '可能是瀏覽器封鎖了網站資料（例如無痕模式或隱私設定），或此瀏覽器不支援 IndexedDB。'),
        h('p', { class: 'cf-text-mono' }, String(err?.message || err)),
      ),
    );
    return;
  }

  // 固定收支：只在開啟網站時補入帳到期項目（網站關閉期間不會執行）。失敗不阻擋網站啟動。
  let recurringResult = null;
  let recurringError = null;
  try {
    recurringResult = await runRecurring(app.db, today());
  } catch (err) {
    recurringError = err;
    console.error(err);
  }

  const shell = createShell();
  mount(root, shell.root);
  await startRouter(shell);

  if (recurringResult?.count) {
    toast.success(`已自動補入帳 ${recurringResult.count} 筆到期的固定收支（${recurringResult.created.map((c) => `${c.name} ${c.dates.length} 筆`).join('、')}）`);
  }
  if (recurringResult?.skipped.length) toast.warning('部分固定收支未自動產生', recurringResult.skipped.map((s) => `「${s.name}」：${s.reason}`));
  if (recurringError) toast.error(`固定收支自動入帳失敗（資料未變更）：${explainError(recurringError).message}`);

  // 不可 await：Firefox 會詢問使用者，await 會讓整站卡在載入中
  requestPersistentStorage(() => {
    if (location.hash.startsWith('#/settings')) notifyChanged();
  });
}

boot();
