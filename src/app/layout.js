/**
 * App 外框（依參考圖）：浮動大圓角容器 + Sidebar（手機為抽屜、桌機可收合）+ 頂部列 + 內容區 + 手機「＋」快速記帳。
 * CSS class 一律以 cf- 開頭並帶元件名，避免與 Bootstrap 或其他元件同名。
 */
import { h, icon, mount } from '../ui/h.js';
import { ROUTES, routeHref } from './routes.js';
import { app } from './state.js';
import { backupStatus } from '../domain/backupStatus.js';
import { exportBackupNow } from './backupActions.js';
import { openTransactionForm } from '../pages/transactionForm.js';

/** Sidebar 分組：主要功能、分隔線、系統設定（對應參考圖的上下兩組）。 */
const NAV_GROUPS = [ROUTES.filter((r) => r.key !== 'settings'), ROUTES.filter((r) => r.key === 'settings')];

export function createShell() {
  const sidebarNav = h('nav', { class: 'cf-sidebar-nav', 'aria-label': '主選單' });
  const backupCard = h('div', { class: 'cf-sidebar-backup' });
  const memberChip = h('a', { class: 'cf-topbar-members', href: routeHref('settings'), title: '成員設定' });
  const bellBtn = h('a', { class: 'cf-topbar-iconbox', href: routeHref('dashboard'), title: '財務提醒', 'aria-label': '財務提醒' });
  const content = h('main', { class: 'cf-content', id: 'cf-main-content', tabIndex: -1 });
  const backdrop = h('div', { class: 'cf-drawer-backdrop', onClick: () => setDrawer(false) });

  const collapseBtn = h('button', { type: 'button', class: 'cf-sidebar-collapse', onClick: () => setCollapsed(!collapsed) });

  const sidebar = h('aside', { class: 'cf-sidebar', id: 'cf-sidebar', 'aria-label': '側邊選單' },
    h('div', { class: 'cf-sidebar-brand' },
      h('a', { class: 'cf-sidebar-wordmark', href: routeHref('dashboard'), 'aria-label': '我們的小金庫：回到財務總覽' },
        h('span', { class: 'cf-sidebar-wordmark-short', 'aria-hidden': 'true' }, '金'),
        h('span', { class: 'cf-sidebar-wordmark-full' }, '我們的', h('span', { class: 'cf-sidebar-wordmark-accent' }, '小金庫')),
      ),
      h('button', { type: 'button', class: 'cf-icon-btn cf-sidebar-close', 'aria-label': '關閉選單', onClick: () => setDrawer(false) }, icon('bi-x-lg')),
    ),
    sidebarNav,
    backupCard,
    collapseBtn,
  );

  const searchInput = h('input', {
    type: 'search',
    class: 'cf-topbar-search-input',
    placeholder: '快速搜尋交易',
    'aria-label': '快速搜尋交易（按 Enter 搜尋）',
    maxlength: 50,
    onKeydown: (e) => {
      if (e.key === 'Enter') {
        app.quickSearch = searchInput.value.trim();
        searchInput.value = '';
        if (location.hash === routeHref('transactions')) window.dispatchEvent(new HashChangeEvent('hashchange'));
        else location.hash = routeHref('transactions');
      }
    },
  });

  const menuBtn = h('button', { type: 'button', class: 'cf-icon-btn cf-topbar-menu', 'aria-label': '開啟選單', 'aria-controls': 'cf-sidebar', 'aria-expanded': 'false', onClick: () => setDrawer(true) }, icon('bi-list'));

  const topbar = h('header', { class: 'cf-topbar' },
    menuBtn,
    h('label', { class: 'cf-topbar-search' }, icon('bi-search'), searchInput),
    h('div', { class: 'cf-topbar-actions' },
      bellBtn,
      h('button', { type: 'button', class: 'cf-topbar-iconbox', onClick: () => exportBackupNow(), title: '匯出完整 JSON 備份', 'aria-label': '匯出完整 JSON 備份' }, icon('bi-cloud-arrow-down')),
      h('a', { class: 'cf-topbar-iconbox cf-topbar-iconbox-settings', href: routeHref('settings'), title: '系統設定', 'aria-label': '系統設定' }, icon('bi-gear')),
      memberChip,
      h('a', { class: 'cf-topbar-add', href: routeHref('transactions'), dataset: { action: 'quick-add' } },
        h('span', { class: 'cf-topbar-add-icon' }, icon('bi-plus-lg')), h('span', { class: 'cf-topbar-add-label' }, '新增記帳')),
    ),
  );

  const fab = h('a', { class: 'cf-fab', href: routeHref('transactions'), 'aria-label': '快速記帳', dataset: { action: 'quick-add' } }, icon('bi-plus-lg'));

  const windowEl = h('div', { class: 'cf-app-window' },
    sidebar,
    h('div', { class: 'cf-main' }, topbar, content),
  );
  const root = h('div', { class: 'cf-app-frame' },
    h('a', { class: 'cf-skip-link', href: '#cf-main-content', onClick: (e) => { e.preventDefault(); content.focus(); } }, '跳到主要內容'),
    windowEl,
    backdrop,
    fab,
  );

  // 「＋」與「新增記帳」在任何頁面都直接開啟記帳表單（不換頁）
  root.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-action="quick-add"]');
    if (!trigger) return;
    e.preventDefault();
    openTransactionForm();
  });

  // 收合狀態只存在記憶體（不使用 localStorage）
  let collapsed = false;
  function setCollapsed(value) {
    collapsed = value;
    windowEl.classList.toggle('cf-app-window-collapsed', collapsed);
    mount(collapseBtn, icon(collapsed ? 'bi-chevron-double-right' : 'bi-chevron-double-left'), h('span', { class: 'cf-sidebar-label' }, '收合選單'));
    collapseBtn.setAttribute('aria-label', collapsed ? '展開選單' : '收合選單');
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
  }
  setCollapsed(false);

  function setDrawer(open) {
    root.classList.toggle('cf-drawer-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) sidebar.querySelector('.cf-sidebar-link')?.focus();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('cf-drawer-open')) setDrawer(false);
  });

  function navLink(r, routeKey) {
    return h('li', null,
      h('a', {
        class: { 'cf-sidebar-link': true, 'cf-sidebar-link-active': r.key === routeKey },
        href: routeHref(r.key),
        title: r.label,
        'aria-current': r.key === routeKey ? 'page' : null,
        onClick: () => setDrawer(false),
      }, icon(r.icon), h('span', { class: 'cf-sidebar-label' }, r.label)),
    );
  }

  function update(routeKey) {
    const ds = app.dataset;
    mount(sidebarNav,
      NAV_GROUPS.map((group, i) => [
        i > 0 ? h('hr', { class: 'cf-sidebar-divider' }) : null,
        h('ul', { class: 'cf-sidebar-list' }, group.map((r) => navLink(r, routeKey))),
      ]),
    );

    const st = backupStatus(ds.settings);
    const warn = st.level === 'warning';
    mount(backupCard,
      h('div', { class: 'cf-backup-card' },
        h('span', { class: { 'cf-backup-card-icon': true, 'cf-backup-card-icon-warning': warn } }, icon(warn ? 'bi-exclamation-lg' : 'bi-shield-check')),
        h('p', { class: 'cf-backup-card-title' }, '定期備份'),
        h('p', { class: 'cf-backup-card-text' }, st.text),
        h('p', { class: 'cf-backup-card-note' }, '資料只存在這個瀏覽器'),
        h('button', { type: 'button', class: 'cf-backup-card-btn', onClick: () => exportBackupNow() }, '立即備份'),
      ),
      h('button', { type: 'button', class: { 'cf-backup-mini': true, 'cf-backup-mini-warning': warn }, title: `立即備份（${st.text}）`, 'aria-label': `立即備份：${st.text}`, onClick: () => exportBackupNow() }, icon('bi-cloud-arrow-down')),
    );

    mount(bellBtn, icon('bi-bell'), warn ? h('span', { class: 'cf-topbar-iconbox-dot', 'aria-hidden': 'true' }) : null);
    bellBtn.setAttribute('aria-label', warn ? `財務提醒：${st.text}` : '財務提醒');

    const members = ['member-self', 'member-partner'].map((mid) => ds.members.find((m) => m.id === mid)).filter(Boolean);
    mount(memberChip,
      h('span', { class: 'cf-topbar-members-avatars' },
        members.map((m, i) => h('span', { class: `cf-avatar cf-avatar-${i === 0 ? 'self' : 'partner'}`, 'aria-hidden': 'true' }, [...m.name][0] ?? '?')),
      ),
      h('span', { class: 'cf-topbar-members-text' },
        h('span', { class: 'cf-topbar-members-name' }, members.map((m) => m.name).join(' & ')),
        h('span', { class: 'cf-topbar-members-sub' }, '雙人共同帳本'),
      ),
    );
    memberChip.setAttribute('aria-label', `成員：${members.map((m) => m.name).join('、')}（前往設定）`);
  }

  return { root, content, update, setDrawer };
}
