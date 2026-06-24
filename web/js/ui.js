// Small shared helpers used across the app.

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Build a DOM element: el('div', {class:'x', onclick:fn}, child, child...)
export function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

// Money formatting -------------------------------------------------
const CAD = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });

export function money(n) {
  if (n == null || n === '' || isNaN(n)) return '—';
  return CAD.format(Math.round(n));
}

// Signed money for adjustments: +$3,000 / −$5,000  (uses a real minus sign)
export function signedMoney(n) {
  if (!n || isNaN(n)) return '—';
  const v = Math.round(Math.abs(n));
  return (n > 0 ? '+' : '−') + CAD.format(v);
}

export function parseMoney(str) {
  if (typeof str === 'number') return str;
  if (!str) return null;
  const neg = /[-−(]/.test(String(str).trim()[0] || '');
  const num = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  if (isNaN(num)) return null;
  return neg ? -num : num;
}

// Toast / flash message
let flashTimer;
export function flash(msg) {
  const f = $('#flash');
  if (!f) return;
  f.textContent = msg;
  f.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => f.classList.remove('show'), 2400);
}

export const debounce = (fn, ms = 400) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
