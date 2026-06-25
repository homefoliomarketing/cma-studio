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

// ---- Safe-value sanitizers (XSS / CSS-injection defence) ------------------
// el() escapes text children, but values interpolated into a style string or an
// image URL are not. These guard the few places that do that — chiefly the
// shared, admin-set company branding (colours + logo) that renders in EVERY
// agent's report, and image URLs replayed from saved CMAs.

// A brand colour is only ever a #rgb / #rrggbb hex. Anything else (e.g. a value
// like "#000;background:url(//evil)") is rejected back to the fallback so it
// can't inject extra declarations into an inline style.
export function safeHexColor(v, fallback = '') {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(v == null ? '' : v).trim())
    ? String(v).trim() : fallback;
}

// Allow only image URLs the app actually produces: https:, our own data:image/
// URIs, blob:, or a same-origin relative path — and never anything containing
// characters that could break out of a CSS url() or an attribute. Blocks
// javascript:, data:text/html, and protocol-relative //host URLs.
export function safeImageUrl(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || /["'()\\\s<>]/.test(s)) return '';
  if (/^https:\/\//i.test(s)) return s;
  if (/^data:image\//i.test(s)) return s;
  if (/^blob:/i.test(s)) return s;
  if (/^\/[^/]/.test(s)) return s;          // /path (not //protocol-relative)
  return '';
}

// Build a CSS `url("…")` from a vetted image URL, or '' if it doesn't pass.
export function cssUrl(v) {
  const s = safeImageUrl(v);
  return s ? `url("${s}")` : '';
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
