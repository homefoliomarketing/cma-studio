// Step 4 — the result: adjusted comp prices, averaged value, and the
// realtor's final opinion of value (editable).
import { el, money, signedMoney, parseMoney } from '../ui.js';
import { estimate } from '../calc.js';

export function renderResult(root, ctx) {
  const cma = ctx.cma;
  const est = estimate(cma, ctx.settings);

  if (!est.count) {
    root.append(el('div', { class: 'card card-pad', style: 'text-align:center;padding:50px' },
      el('div', { style: 'font-size:34px' }, '📊'),
      el('h2', { style: 'margin:12px 0 8px' }, 'No sold comps yet'),
      el('p', { class: 'muted', style: 'margin-bottom:18px' }, 'Add at least one sold comparable (with a sale price) to calculate a value.'),
      el('button', { class: 'btn btn-primary', onclick: () => ctx.go('comps') }, '← Back to comparables')));
    return;
  }

  if (cma.finalValue == null) cma.finalValue = est.average;

  // ---- hero: final opinion of value ----
  const valueInput = el('input', { class: 'hero-value-input', value: Number(cma.finalValue).toLocaleString('en-CA'), inputmode: 'numeric' });
  valueInput.addEventListener('input', () => { cma.finalValue = parseMoney(valueInput.value); ctx.save(); });
  valueInput.addEventListener('blur', () => { valueInput.value = (Number(cma.finalValue) || 0).toLocaleString('en-CA'); });

  const hero = el('div', { class: 'card result-hero' },
    // Reference: the calculated average of the adjusted comps
    el('div', { class: 'result-indicated' },
      el('span', { class: 'ri-label' }, 'Indicated value'),
      el('span', { class: 'ri-value' }, money(est.average)),
      el('span', { class: 'ri-note' },
        est.count >= 2 ? `average of ${est.count} adjusted comps · range ${money(est.low)} – ${money(est.high)}` : 'based on 1 adjusted comp'),
    ),
    // Main figure: the realtor's suggested list price (shown on the report)
    el('div', { class: 'section-label', style: 'color:var(--accent-soft);margin:4px 0 8px' }, 'Suggested list price'),
    el('div', { class: 'hero-value-row' }, el('span', { class: 'hero-dollar' }, '$'), valueInput),
    el('div', { class: 'hero-sub' },
      'This is the headline figure on your report. Start from the indicated value and set the price you’ll recommend.'),
    el('div', { class: 'hero-tools' },
      el('button', { class: 'pill-btn', onclick: () => { cma.finalValue = est.average; ctx.refresh(); } }, '↺ Use average ' + money(est.average)),
      el('button', { class: 'pill-btn', onclick: () => { cma.finalValue = Math.round(est.average / 1000) * 1000; ctx.refresh(); } }, 'Round to ' + money(Math.round(est.average / 1000) * 1000)),
      el('button', { class: 'pill-btn', onclick: () => { cma.finalValue = Math.round(est.average / 5000) * 5000; ctx.refresh(); } }, 'Round to ' + money(Math.round(est.average / 5000) * 5000)),
    ),
  );

  // ---- per-comp breakdown with bars ----
  const maxAdj = Math.max(...est.rows.map(r => r.adjusted), 1);
  const rows = est.rows.map((r, i) => {
    const pct = Math.max(8, Math.round((r.adjusted / maxAdj) * 100));
    return el('div', { class: 'breakdown-row' },
      el('div', { class: 'bd-photo', style: r.comp.photo ? `background-image:url(${r.comp.photo})` : '' }, r.comp.photo ? '' : '🏠'),
      el('div', { class: 'bd-main' },
        el('div', { class: 'bd-head' },
          el('div', {}, el('strong', {}, 'Comparable ' + (i + 1)), el('span', { class: 'muted' }, '  ' + (r.comp.address || ''))),
          el('div', { class: 'bd-adjusted' }, money(r.adjusted)),
        ),
        el('div', { class: 'bd-bar' }, el('div', { class: 'bd-fill', style: `width:${pct}%` })),
        el('div', { class: 'bd-detail muted' },
          'Sold ', money(r.comp.salePrice),
          el('span', { class: 'bd-adj ' + (r.total > 0 ? 'pos' : r.total < 0 ? 'neg' : '') }, '  ' + (r.total ? signedMoney(r.total) + ' adjustments' : 'no adjustments')),
        ),
      ),
    );
  });

  const breakdown = el('div', { class: 'card card-pad' },
    el('div', { class: 'section-label' }, 'How we got here'),
    el('div', { class: 'panel-sub' }, 'Each comp’s sale price, adjusted to what your subject would have sold for. The estimate is the average.'),
    ...rows,
    el('div', { class: 'avg-line' },
      el('span', {}, 'Average of adjusted prices'),
      el('strong', {}, money(est.average))),
  );

  const footer = el('div', { class: 'row spread', style: 'margin-top:22px' },
    el('button', { class: 'btn btn-ghost', onclick: () => ctx.go('adjustments') }, '← Back to adjustments'),
    el('button', { class: 'btn btn-primary', onclick: () => ctx.next() }, 'Continue to report  →'),
  );

  root.append(el('div', { class: 'stagger' }, hero, breakdown, footer));
}
