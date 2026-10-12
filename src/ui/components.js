/** 共用小元件。class 一律 cf- 前綴＋元件名，確保全域唯一。 */
import { h, icon } from './h.js';

export function pageHeader(title, subtitle, ...actions) {
  return h('div', { class: 'cf-page-head' },
    h('div', { class: 'cf-page-head-text' },
      h('h1', { class: 'cf-page-head-title' }, title),
      subtitle ? h('p', { class: 'cf-page-head-subtitle' }, subtitle) : null,
    ),
    actions.length ? h('div', { class: 'cf-page-head-actions' }, actions) : null,
  );
}

export function panel({ title, subtitle, actions, className = '' }, ...children) {
  return h('section', { class: `cf-panel ${className}`.trim() },
    title || actions
      ? h('div', { class: 'cf-panel-head' },
          h('div', { class: 'cf-panel-head-text' },
            title ? h('h2', { class: 'cf-panel-title' }, title) : null,
            subtitle ? h('p', { class: 'cf-panel-subtitle' }, subtitle) : null,
          ),
          actions ? h('div', { class: 'cf-panel-actions' }, actions) : null,
        )
      : null,
    children,
  );
}

export function notice(kind, ...children) {
  const icons = { info: 'bi-info-circle', warning: 'bi-exclamation-triangle', danger: 'bi-x-octagon', success: 'bi-check-circle' };
  return h('div', { class: `cf-notice cf-notice-${kind}`, role: kind === 'danger' ? 'alert' : null },
    h('span', { class: 'cf-notice-icon' }, icon(icons[kind] || icons.info)),
    h('div', { class: 'cf-notice-body' }, children),
  );
}

export function statusPill(kind, text) {
  return h('span', { class: `cf-pill cf-pill-${kind}` }, text);
}

/** 尚未實作的頁面：清楚說明會在哪個階段完成，不放假資料。 */
export function placeholderPage(title, stage, features) {
  return h('div', { class: 'cf-page' },
    pageHeader(title, `此頁面將於第 ${stage} 階段完成`),
    panel({ title: '規劃中的功能' },
      notice('info', `目前已完成：財務總覽、收支記帳、雙人財務、帳戶管理、預算管理、婚禮基金、購屋規劃、系統設定。「${title}」會在第 ${stage} 階段開發，現在還沒有可操作的功能。`),
      h('ul', { class: 'cf-placeholder-list' }, features.map((f) => h('li', null, icon('bi-check2'), h('span', null, f)))),
    ),
  );
}
