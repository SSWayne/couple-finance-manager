/**
 * 安全的 DOM 建立工具：文字一律以 text node（textContent）加入，不解析 HTML。
 * 用法：h('button', { class: 'btn', onClick: fn }, '儲存')
 */

const FORBIDDEN_PROPS = new Set(['innerHTML', 'outerHTML', 'srcdoc', 'insertAdjacentHTML']);
const DOM_PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate', 'multiple', 'readOnly', 'required', 'htmlFor', 'tabIndex', 'hidden']);
const SVG_NS = 'http://www.w3.org/2000/svg';

function safeUrl(value) {
  const s = String(value).trim();
  if (s.startsWith('#') || s.startsWith('blob:') || s.startsWith('data:image/') || /^https?:\/\//i.test(s) || s.startsWith('./') || s.startsWith('/')) return s;
  throw new Error(`不允許的網址：${s.slice(0, 30)}`);
}

function classNames(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(' ');
  if (value && typeof value === 'object') return Object.entries(value).filter(([, on]) => on).map(([k]) => k).join(' ');
  return String(value);
}

function applyProps(el, props, isSvg) {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (FORBIDDEN_PROPS.has(key)) throw new Error(`h() 禁止使用 ${key}`);
    if (key === 'class' || key === 'className') {
      const cls = classNames(value);
      if (cls) el.setAttribute('class', cls);
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value)) if (dv !== null && dv !== undefined) el.dataset[dk] = String(dv);
    } else if (key === 'style') {
      // 以 CSSOM 設定（CSP 不需要 'unsafe-inline'）
      for (const [sk, sv] of Object.entries(value)) if (sv !== null && sv !== undefined) el.style.setProperty(sk, String(sv));
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') {
      el.textContent = String(value);
    } else if (key === 'ref' && typeof value === 'function') {
      value(el);
    } else if (!isSvg && DOM_PROPS.has(key)) {
      el[key] = value;
    } else if (key === 'href' || key === 'src' || key === 'action') {
      el.setAttribute(key, safeUrl(value));
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

function isProps(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Node);
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (isProps(props)) applyProps(el, props, false);
  else children.unshift(props);
  appendChildren(el, children);
  return el;
}

export function svg(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (isProps(props)) applyProps(el, props, true);
  else children.unshift(props);
  appendChildren(el, children);
  return el;
}

/** Bootstrap Icons 圖示（裝飾用，aria-hidden）。 */
export function icon(name, extraClass = '') {
  return h('i', { class: `bi ${name} ${extraClass}`.trim(), 'aria-hidden': 'true' });
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export function mount(el, ...children) {
  el.replaceChildren();
  appendChildren(el, children);
  return el;
}
