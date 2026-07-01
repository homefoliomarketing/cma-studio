// Step 3 — the adjustment grid: subject vs. comps, auto +/- with overrides,
// deletable rows, custom lines, live totals.
import { el, money, signedMoney, parseMoney, flash } from '../ui.js';
import { ITEM_DEFS } from '../state.js';
import { itemDisplay, effectiveAdjustment, isLocked, setOverride, clearOverride, compTotal, adjustedPrice, estimate } from '../calc.js';

const uid = () => 'row_' + Math.random().toString(36).slice(2, 8);

export function renderAdjustments(root, ctx) {
  const cma = ctx.cma;
  if (!cma.comps.length) {
    root.append(el('div', { class: 'card card-pad', style: 'text-align:center;padding:50px' },
      el('div', { style: 'font-size:34px' }, '⚖️'),
      el('h2', { style: 'margin:12px 0 8px' }, 'Add comparables first'),
      el('p', { class: 'muted', style: 'margin-bottom:18px' }, 'The adjustment grid compares your subject to each sold comp.'),
      el('button', { class: 'btn btn-primary', onclick: () => ctx.go('comps') }, '← Back to comparables')));
    return;
  }

  const S = ctx.settings;
  const subject = cma.subject;
  const comps = cma.comps;
  const enabled = () => cma.enabledItems.map(k => ITEM_DEFS.find(d => d.key === k)).filter(Boolean);

  // live-updating cell refs
  const totalCells = {}, adjCells = {};
  const recalc = () => {
    const est = estimate(cma, S);
    est.rows.forEach(r => {
      if (totalCells[r.comp.id]) { totalCells[r.comp.id].textContent = signedMoney(r.total) === '—' ? '$0' : signedMoney(r.total); totalCells[r.comp.id].className = 'adj-total ' + sign(r.total); }
      if (adjCells[r.comp.id]) adjCells[r.comp.id].textContent = money(r.adjusted);
    });
    banner.update(est);
    ctx.save();
  };

  // ---------- table ----------
  const table = el('table', { class: 'grid' });

  // header
  const head = el('tr', {},
    el('th', { class: 'gi-corner' }, 'Adjustment'),
    el('th', { class: 'col-subject' }, el('div', { class: 'gh-title' }, 'Subject'), el('div', { class: 'gh-sub' }, subject.address || 'Your listing')),
    ...comps.map((c, i) => el('th', { class: 'col-comp' },
      el('div', { class: 'gh-title' }, 'Comparable ' + (i + 1)),
      el('div', { class: 'gh-sub' }, c.address || '—'),
      el('div', { class: 'gh-sold' }, c.salePrice ? 'Sold ' + money(c.salePrice) : '⚠ no sale price'))),
  );
  const body = el('tbody', {});

  // comparison rows
  enabled().forEach(item => body.append(itemRow(item)));
  // custom rows
  cma.customRows.forEach(row => body.append(customRow(row)));

  // summary rows
  body.append(sumRow('List price', c => c.listPrice ? money(c.listPrice) : '—', subject.listPrice ? money(subject.listPrice) : '—', 'sum-soft'));
  body.append(sumRow('Sale price', c => c.salePrice ? money(c.salePrice) : '—', '', 'sum-soft'));
  body.append(totalRow());
  body.append(adjustedRow());

  table.append(el('thead', {}, head), body);

  // ---------- builders ----------
  function itemRow(item) {
    const tr = el('tr', {});
    tr.append(el('td', { class: 'gi-label' },
      el('span', {}, item.label),
      el('button', { class: 'gi-del', title: 'Remove this line', onclick: () => { cma.enabledItems = cma.enabledItems.filter(k => k !== item.key); ctx.refresh(); } }, '✕')));
    tr.append(el('td', { class: 'col-subject val' }, itemDisplay(item, subject)));
    comps.forEach(c => {
      const cell = el('td', { class: 'col-comp' });
      cell.append(el('div', { class: 'cell-val' }, itemDisplay(item, c)));
      if (item.type !== 'info') cell.append(adjInput(item, c));
      tr.append(cell);
    });
    return tr;
  }

  function adjInput(item, comp) {
    const wrap = el('div', { class: 'adj-wrap' });
    const eff = effectiveAdjustment(cma, comp, item, S);
    const input = el('input', { class: 'adj-input ' + sign(eff), value: fmtSigned(eff), placeholder: '$0', inputmode: 'numeric' });
    const reset = el('button', { class: 'adj-reset' + (isLocked(cma, comp, item) ? ' show' : ''), title: 'Reset to suggested', onclick: () => { clearOverride(cma, comp, item); ctx.refresh(); } }, '↺');
    input.addEventListener('input', () => {
      const v = input.value.trim();
      if (v === '' || v === '-' || v === '+') clearOverride(cma, comp, item);
      else setOverride(cma, comp, item, parseMoney(v));
      input.className = 'adj-input ' + sign(parseMoney(v) || 0);
      reset.classList.add('show');
      recalc();
    });
    input.addEventListener('blur', () => { input.value = fmtSigned(effectiveAdjustment(cma, comp, item, S)); });
    wrap.append(input, reset);
    return wrap;
  }

  function customRow(row) {
    const tr = el('tr', { class: 'custom-row' });
    const label = el('input', { class: 'custom-label', value: row.label, placeholder: 'e.g. Rear wall' });
    label.addEventListener('input', () => { row.label = label.value; ctx.save(); });
    tr.append(el('td', { class: 'gi-label' }, label,
      el('button', { class: 'gi-del', title: 'Delete this line', onclick: () => { cma.customRows = cma.customRows.filter(r => r.id !== row.id); ctx.refresh(); } }, '✕')));
    tr.append(el('td', { class: 'col-subject val muted' }, '—'));
    comps.forEach(c => {
      const v = row.amounts?.[c.id];
      const input = el('input', { class: 'adj-input ' + sign(v || 0), value: fmtSigned(v || 0), placeholder: '$0', inputmode: 'numeric' });
      input.addEventListener('input', () => {
        if (!row.amounts) row.amounts = {};
        row.amounts[c.id] = parseMoney(input.value);
        input.className = 'adj-input ' + sign(parseMoney(input.value) || 0);
        recalc();
      });
      input.addEventListener('blur', () => { input.value = fmtSigned(row.amounts?.[c.id] || 0); });
      tr.append(el('td', { class: 'col-comp' }, el('div', { class: 'adj-wrap' }, input)));
    });
    return tr;
  }

  function sumRow(label, compFn, subjVal, cls) {
    return el('tr', { class: 'row-sum ' + (cls || '') },
      el('td', { class: 'gi-label' }, label),
      el('td', { class: 'col-subject val' }, subjVal || '—'),
      ...comps.map(c => el('td', { class: 'col-comp val' }, compFn(c))));
  }

  function totalRow() {
    return el('tr', { class: 'row-sum' },
      el('td', { class: 'gi-label' }, 'Total adjustments'),
      el('td', { class: 'col-subject val' }, '—'),
      ...comps.map(c => { const cell = el('td', { class: 'col-comp' }); totalCells[c.id] = el('span', { class: 'adj-total' }); cell.append(totalCells[c.id]); return cell; }));
  }
  function adjustedRow() {
    return el('tr', { class: 'row-sum row-adjusted' },
      el('td', { class: 'gi-label' }, 'Adjusted sale price'),
      el('td', { class: 'col-subject val' }, '—'),
      ...comps.map(c => { const cell = el('td', { class: 'col-comp' }); adjCells[c.id] = el('span', { class: 'adj-final' }); cell.append(adjCells[c.id]); return cell; }));
  }

  // ---------- below the table ----------
  const removed = ITEM_DEFS.filter(d => !cma.enabledItems.includes(d.key));
  const tools = el('div', { class: 'grid-tools' },
    el('button', { class: 'btn btn-sm', onclick: () => { cma.customRows.push({ id: uid(), label: '', amounts: {} }); ctx.refresh(); } }, '+ Add custom line'),
    ...removed.map(d => el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { cma.enabledItems.push(d.key); cma.enabledItems = ITEM_DEFS.filter(x => cma.enabledItems.includes(x.key)).map(x => x.key); ctx.refresh(); } }, '+ ' + d.label)),
  );

  const banner = makeBanner();

  const footer = el('div', { class: 'row spread', style: 'margin-top:22px' },
    el('div', { class: 'muted', style: 'max-width:560px;font-size:13px' },
      'Tip: amounts auto-fill from your presets (Settings). A comp better than your subject is docked (−); worse is credited (+). Edit any cell to override, or ↺ to restore the suggestion.'),
    el('button', { class: 'btn btn-primary', onclick: () => ctx.next() }, 'Continue to result  →'),
  );

  root.append(
    el('div', { class: 'card card-pad' },
      el('div', { class: 'section-label' }, 'Adjustment grid'),
      el('div', { class: 'grid-scroll' }, table),
      tools),
    banner.node,
    footer);

  recalc();
}

// ---------- helpers ----------
function makeBanner() {
  const avg = el('div', { class: 'banner-value' }, '—');
  const range = el('div', { class: 'banner-range muted' }, '');
  const node = el('div', { class: 'card est-banner' },
    el('div', {}, el('div', { class: 'section-label', style: 'margin:0 0 4px' }, 'Indicated value'),
      el('div', { class: 'muted', style: 'font-size:13px' }, 'Average of the adjusted comp prices — fine-tuned on the next step')),
    el('div', { style: 'text-align:right' }, avg, range));
  return {
    node,
    update(est) {
      avg.textContent = est.count ? money(est.average) : '—';
      range.textContent = est.count >= 2 ? `range ${money(est.low)} – ${money(est.high)} · ${est.count} comps` : (est.count === 1 ? '1 comp' : 'add a sold price');
    },
  };
}

function sign(n) { return n > 0 ? 'pos' : (n < 0 ? 'neg' : ''); }

function fmtSigned(n) {
  n = Math.round(Number(n) || 0);
  if (!n) return '';
  return (n > 0 ? '+' : '−') + Math.abs(n).toLocaleString('en-CA');
}

