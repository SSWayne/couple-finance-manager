/** Sidebar 11 項與對應的 hash 路由（#/key）。URL 不放任何財務資料。 */
export const ROUTES = [
  { key: 'dashboard', label: '財務總覽', icon: 'bi-grid-1x2' },
  { key: 'transactions', label: '收支記帳', icon: 'bi-arrow-left-right' },
  { key: 'couple', label: '雙人財務', icon: 'bi-people' },
  { key: 'accounts', label: '帳戶管理', icon: 'bi-wallet2' },
  { key: 'budgets', label: '預算管理', icon: 'bi-pie-chart' },
  { key: 'wedding', label: '婚禮基金', icon: 'bi-heart' },
  { key: 'housing', label: '購屋規劃', icon: 'bi-house-door' },
  { key: 'savings', label: '儲蓄目標', icon: 'bi-piggy-bank' },
  { key: 'recurring', label: '固定收支', icon: 'bi-arrow-repeat' },
  { key: 'reports', label: '財務報表', icon: 'bi-bar-chart-line' },
  { key: 'settings', label: '系統設定', icon: 'bi-gear' },
];

export const DEFAULT_ROUTE = 'dashboard';

export function parseHash(hash = location.hash) {
  const key = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return ROUTES.some((r) => r.key === key) ? key : DEFAULT_ROUTE;
}

export function routeHref(key) {
  return `#/${key}`;
}
