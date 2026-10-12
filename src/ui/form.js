/** 表單小工具（全部以 h() 建立）。 */
import { h } from './h.js';

let seq = 0;
export function uid(prefix = 'cf-field') {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** 標籤＋控制項＋說明／錯誤訊息。回傳 { el, control, setError, setVisible }。 */
export function field(label, control, { help, className = '' } = {}) {
  if (!control.id) control.id = uid();
  const errorEl = h('div', { class: 'cf-field-error', id: `${control.id}-error`, hidden: true });
  const el = h('div', { class: `cf-field ${className}`.trim() },
    h('label', { class: 'form-label', htmlFor: control.id }, label),
    control,
    help ? h('div', { class: 'cf-help-text' }, help) : null,
    errorEl,
  );
  return {
    el,
    control,
    setError(message) {
      errorEl.textContent = message || '';
      errorEl.hidden = !message;
      control.classList.toggle('is-invalid', Boolean(message));
      if (message) control.setAttribute('aria-describedby', errorEl.id);
      else control.removeAttribute('aria-describedby');
    },
    setVisible(visible) {
      el.hidden = !visible;
    },
  };
}

/** options: [{ value, label, disabled }] 或 [{ group, options: [...] }] */
export function selectEl(options, value, attrs = {}) {
  const sel = h('select', { class: 'form-select', ...attrs });
  setOptions(sel, options, value);
  return sel;
}

export function setOptions(sel, options, value) {
  const build = (o) => h('option', { value: o.value, disabled: o.disabled, selected: o.value === value }, o.label);
  sel.replaceChildren(
    ...options.map((o) => (o.group ? h('optgroup', { label: o.group }, o.options.map(build)) : build(o))),
  );
  if (value !== undefined && [...sel.options].some((o) => o.value === value)) sel.value = value;
}

export function textInput(value = '', attrs = {}) {
  return h('input', { type: 'text', class: 'form-control', value: value ?? '', ...attrs });
}

/** 金額輸入：數字鍵盤、整數。 */
export function moneyInput(value, attrs = {}) {
  return h('input', {
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    class: 'form-control cf-money-input',
    value: value === null || value === undefined ? '' : String(value),
    placeholder: '0',
    ...attrs,
  });
}

/** 分段選擇（radio 群組外觀）。回傳 { el, get value, set value, onChange }。 */
export function segmented(options, value, { label, onChange } = {}) {
  let current = value;
  const buttons = options.map((o) =>
    h('button', {
      type: 'button',
      class: 'cf-segmented-btn',
      role: 'radio',
      dataset: { value: o.value },
      onClick: () => {
        if (current === o.value) return;
        api.value = o.value;
        onChange?.(o.value);
      },
    }, o.label),
  );
  const el = h('div', { class: 'cf-segmented', role: 'radiogroup', 'aria-label': label }, buttons);
  const api = {
    el,
    get value() {
      return current;
    },
    set value(v) {
      current = v;
      for (const b of buttons) {
        const on = b.dataset.value === v;
        b.classList.toggle('cf-segmented-btn-active', on);
        b.setAttribute('aria-checked', String(on));
      }
    },
    setDisabled(disabled) {
      for (const b of buttons) b.disabled = disabled;
    },
  };
  api.value = value;
  return api;
}
