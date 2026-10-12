/** 以原生 <dialog> 實作的對話框（內建焦點管理與 Esc 關閉）。 */
import { h, icon } from './h.js';

/**
 * openDialog({ title, body, actions, size }) → { el, close }
 * actions: [{ label, variant: 'primary'|'danger'|'secondary', onClick(close) }]
 */
export function openDialog({ title, body, actions = [], size = 'md', onClose }) {
  const dlg = h('dialog', { class: `cf-dialog cf-dialog-${size}`, 'aria-label': title });
  const close = () => {
    if (dlg.open) dlg.close();
  };
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });
  const variantClass = { primary: 'cf-btn-lime', danger: 'cf-btn-danger', dangerGhost: 'cf-btn-danger-ghost cf-dialog-action-start', secondary: 'cf-btn-ghost', dark: 'cf-btn-dark' };
  dlg.append(
    h('div', { class: 'cf-dialog-head' },
      h('h2', { class: 'cf-dialog-title' }, title),
      h('button', { type: 'button', class: 'cf-icon-btn', 'aria-label': '關閉', onClick: close }, icon('bi-x-lg')),
    ),
    h('div', { class: 'cf-dialog-body' }, body),
    actions.length
      ? h('div', { class: 'cf-dialog-actions' },
          actions.map((a) =>
            h('button', {
              type: 'button',
              class: `btn ${variantClass[a.variant || 'secondary']}`,
              onClick: () => a.onClick?.(close),
              ref: (el) => a.ref?.(el),
            }, a.label),
          ),
        )
      : null,
  );
  document.body.appendChild(dlg);
  dlg.showModal();
  return { el: dlg, close };
}

export function confirmDialog({ title = '請確認', message, confirmLabel = '確定', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    openDialog({
      title,
      body: h('p', { class: 'cf-dialog-text' }, message),
      actions: [
        { label: '取消', variant: 'secondary', onClick: (close) => close() },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: (close) => { result = true; close(); } },
      ],
      onClose: () => resolve(result),
    });
  });
}

export function promptDialog({ title, label, value = '', maxLength = 40, confirmLabel = '儲存' }) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input', { class: 'form-control', type: 'text', value, maxlength: maxLength, id: 'cf-prompt-input' });
    const submit = (close) => {
      result = input.value;
      close();
    };
    const { close } = openDialog({
      title,
      body: h('div', null, h('label', { class: 'form-label', htmlFor: 'cf-prompt-input' }, label), input),
      actions: [
        { label: '取消', variant: 'secondary', onClick: (c) => c() },
        { label: confirmLabel, variant: 'primary', onClick: submit },
      ],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit(close);
    });
    input.select();
  });
}
