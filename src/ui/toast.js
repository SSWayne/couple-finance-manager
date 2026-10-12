/** 成功／失敗提示。錯誤停留較久且使用 assertive 朗讀。 */
import { h, icon } from './h.js';
import { ValidationError, describeError } from '../data/validate.js';
import { ReferenceInUseError } from '../data/db.js';
import { UserError } from '../domain/errors.js';

let region;

function ensureRegion() {
  if (region && document.body.contains(region)) return region;
  region = h('div', { class: 'cf-toast-region', 'aria-live': 'polite' });
  document.body.appendChild(region);
  return region;
}

function show(kind, message, detail) {
  const r = ensureRegion();
  const close = () => {
    item.classList.add('cf-toast-item-leaving');
    setTimeout(() => item.remove(), 200);
  };
  const item = h(
    'div',
    { class: `cf-toast-item cf-toast-item-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'cf-toast-icon' }, icon(kind === 'error' ? 'bi-exclamation-octagon-fill' : kind === 'warning' ? 'bi-exclamation-triangle-fill' : 'bi-check-circle-fill')),
    h('div', { class: 'cf-toast-body' },
      h('div', { class: 'cf-toast-message' }, message),
      detail ? h('ul', { class: 'cf-toast-detail' }, detail.map((d) => h('li', d))) : null,
    ),
    h('button', { class: 'cf-toast-close', type: 'button', 'aria-label': '關閉提示', onClick: close }, icon('bi-x-lg')),
  );
  r.appendChild(item);
  setTimeout(close, kind === 'error' ? 9000 : 4000);
}

export const toast = {
  success: (msg) => show('success', msg),
  warning: (msg, detail) => show('warning', msg, detail),
  error: (msg, detail) => show('error', msg, detail),
};

/** 把各種錯誤轉成使用者看得懂的訊息。 */
export function explainError(err) {
  if (err instanceof ValidationError) {
    const detail = err.errors.slice(0, 5).map(describeError);
    if (err.errors.length > 5) detail.push(`……另有 ${err.errors.length - 5} 項`);
    return { message: '資料未儲存：驗證未通過', detail };
  }
  if (err instanceof ReferenceInUseError || err instanceof UserError) return { message: err.message };
  if (err?.name === 'QuotaExceededError' || err?.inner?.name === 'QuotaExceededError') {
    return { message: '儲存失敗：瀏覽器儲存空間不足。請先匯出備份並清理空間。' };
  }
  return { message: `儲存失敗：${err?.message || '未知錯誤'}（資料未變更）` };
}

/**
 * 執行一個寫入動作，成功與失敗都會明確提示。回傳 true / false。
 */
export async function runAction(fn, successMessage = '已儲存', { onError } = {}) {
  try {
    await fn();
    if (successMessage) toast.success(successMessage);
    return true;
  } catch (err) {
    const { message, detail } = explainError(err);
    toast.error(message, detail);
    onError?.(err);
    if (!(err instanceof ValidationError || err instanceof ReferenceInUseError || err instanceof UserError)) console.error(err);
    return false;
  }
}
